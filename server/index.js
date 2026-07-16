import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import {
  PROJECTS_DIR, listProjects, createProject, loadProject, updateProject,
  newScene, assetDir, projectDir,
} from './store.js';
import { generateStoryboard, regenerateScene } from './storyboard.js';
import {
  generateAllFrames, generateFrame, generateAllVideos, generateVideo,
  generateCharacterImage, resumePending,
} from './pipeline.js';
import { uploadFile } from './kie.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/files', express.static(PROJECTS_DIR));

const upload = multer({ dest: path.join(PROJECTS_DIR, '.uploads'), limits: { fileSize: 30 * 1024 * 1024 } });

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(400).json({ error: String(err.message || err) });
  }
};

// --- Projects ---

app.get('/api/projects', wrap((req, res) => res.json(listProjects())));

app.post('/api/projects', wrap((req, res) => {
  const { name, settings } = req.body;
  if (!name?.trim()) throw new Error('Project name is required');
  res.json(createProject({ name: name.trim(), settings }));
}));

app.get('/api/projects/:id', wrap((req, res) => res.json(loadProject(req.params.id))));

app.patch('/api/projects/:id', wrap((req, res) => {
  const { settings, script } = req.body;
  res.json(updateProject(req.params.id, (p) => {
    if (settings) Object.assign(p.settings, settings);
    if (typeof script === 'string') p.script = script;
  }));
}));

// --- Stage 0: references ---

app.post('/api/projects/:id/references', upload.single('image'), wrap(async (req, res) => {
  const { id } = req.params;
  const role = req.body.role; // 'character' | 'product' | 'style'
  if (!['character', 'product', 'style'].includes(role)) throw new Error('role must be character, product or style');
  if (!req.file) throw new Error('No image uploaded');
  const ext = path.extname(req.file.originalname || '.png') || '.png';
  const destName = role === 'product' ? `product-${Date.now()}${ext}` : `${role}${ext}`;
  const dest = path.join(assetDir(id, 'references'), destName);
  fs.renameSync(req.file.path, dest);
  // The style image only goes to Claude (vision), never to kie.ai generation,
  // so it needs no hosted URL.
  const url = role === 'style' ? null : await uploadFile(dest, `video-gen/${id}`);
  const asset = { path: path.relative(projectDir(id), dest), url, uploadedAt: new Date().toISOString() };
  res.json(updateProject(id, (p) => {
    if (role === 'character') p.references.character = asset;
    else if (role === 'style') p.references.style = asset;
    else p.references.product.push(asset);
  }));
}));

app.delete('/api/projects/:id/references/:role/:index?', wrap((req, res) => {
  const { id, role, index } = req.params;
  res.json(updateProject(id, (p) => {
    if (role === 'character') p.references.character = null;
    else if (role === 'style') p.references.style = null;
    else p.references.product.splice(Number(index ?? 0), 1);
  }));
}));

app.post('/api/projects/:id/references/character/generate', wrap(async (req, res) => {
  const { prompt } = req.body;
  if (!prompt?.trim()) throw new Error('A character prompt is required');
  const { url, path: relPath } = await generateCharacterImage(req.params.id, prompt.trim());
  res.json(updateProject(req.params.id, (p) => {
    p.references.character = { path: relPath, url, uploadedAt: new Date().toISOString() };
  }));
}));

// --- Stage 1: storyboard ---

app.post('/api/projects/:id/storyboard', wrap(async (req, res) => {
  const { id } = req.params;
  const { script, note } = req.body;
  const project = loadProject(id);
  const scriptText = (typeof script === 'string' && script.trim()) ? script.trim() : project.script;
  if (!scriptText) throw new Error('Paste a script first');
  const result = await generateStoryboard({ ...project, script: scriptText }, scriptText, note);
  res.json(updateProject(id, (p) => {
    p.script = scriptText;
    p.storyboardMeta = {
      style_block: result.style_block,
      character_block: result.character_block,
      product_block: result.product_block,
    };
    p.scenes = result.scenes
      .sort((a, b) => a.order - b.order)
      .map((raw, i) => newScene(raw, i));
    p.storyboardStatus = 'draft';
  }));
}));

app.post('/api/projects/:id/storyboard/approve', wrap((req, res) => {
  res.json(updateProject(req.params.id, (p) => {
    if (!p.scenes.length) throw new Error('No storyboard to approve');
    p.storyboardStatus = 'approved';
  }));
}));

app.patch('/api/projects/:id/scenes/:sceneId', wrap((req, res) => {
  const editable = ['start', 'duration_s', 'vo', 'is_transformation', 'start_frame_prompt', 'end_frame_prompt', 'motion_prompt', 'reference_order', 'end_frame_reference_order'];
  res.json(updateProject(req.params.id, (p) => {
    const scene = p.scenes.find((s) => s.id === req.params.sceneId);
    if (!scene) throw new Error('Unknown scene');
    for (const key of editable) {
      if (key in req.body) scene[key] = req.body[key];
    }
    if (scene.is_transformation && scene.status.end_frame === 'n/a') scene.status.end_frame = 'pending';
    if (!scene.is_transformation) scene.status.end_frame = 'n/a';
  }));
}));

app.post('/api/projects/:id/scenes/:sceneId/regenerate-storyboard', wrap(async (req, res) => {
  const { id, sceneId } = req.params;
  const project = loadProject(id);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('Unknown scene');
  const raw = await regenerateScene(project, scene, req.body.note);
  res.json(updateProject(id, (p) => {
    const idx = p.scenes.findIndex((s) => s.id === sceneId);
    const fresh = newScene(raw, idx);
    fresh.id = sceneId;
    fresh.order = p.scenes[idx].order;
    p.scenes[idx] = fresh;
  }));
}));

// --- Stage 2: frames ---

app.post('/api/projects/:id/frames', wrap((req, res) => {
  const project = loadProject(req.params.id);
  if (project.storyboardStatus !== 'approved') throw new Error('Approve the storyboard first');
  const count = generateAllFrames(req.params.id);
  res.json({ submitted: count });
}));

app.post('/api/projects/:id/scenes/:sceneId/frame/regenerate', wrap((req, res) => {
  const which = req.body.which === 'end' ? 'end' : 'start';
  // fire and forget; frontend polls
  generateFrame(req.params.id, req.params.sceneId, which);
  res.json({ ok: true });
}));

app.post('/api/projects/:id/scenes/:sceneId/frame/approve', wrap((req, res) => {
  const which = req.body.which === 'end' ? 'end' : 'start';
  res.json(updateProject(req.params.id, (p) => {
    const scene = p.scenes.find((s) => s.id === req.params.sceneId);
    if (!scene?.assets[`${which}_frame_path`]) throw new Error('Nothing to approve yet');
    scene.status[`${which}_frame`] = 'approved';
  }));
}));

app.post('/api/projects/:id/frames/approve-all', wrap((req, res) => {
  res.json(updateProject(req.params.id, (p) => {
    for (const scene of p.scenes) {
      if (scene.status.start_frame === 'review') scene.status.start_frame = 'approved';
      if (scene.status.end_frame === 'review') scene.status.end_frame = 'approved';
    }
  }));
}));

// --- Stage 3: videos ---

app.post('/api/projects/:id/videos', wrap((req, res) => {
  const count = generateAllVideos(req.params.id);
  res.json({ submitted: count });
}));

app.post('/api/projects/:id/scenes/:sceneId/video/regenerate', wrap((req, res) => {
  generateVideo(req.params.id, req.params.sceneId);
  res.json({ ok: true });
}));

app.post('/api/projects/:id/scenes/:sceneId/video/approve', wrap((req, res) => {
  res.json(updateProject(req.params.id, (p) => {
    const scene = p.scenes.find((s) => s.id === req.params.sceneId);
    if (!scene?.assets.video_path) throw new Error('Nothing to approve yet');
    scene.status.video = 'approved';
  }));
}));

app.post('/api/projects/:id/videos/approve-all', wrap((req, res) => {
  res.json(updateProject(req.params.id, (p) => {
    for (const scene of p.scenes) {
      if (scene.status.video === 'review') scene.status.video = 'approved';
    }
  }));
}));

// --- Stage 4: export ---

app.get('/api/projects/:id/export', wrap((req, res) => {
  const project = loadProject(req.params.id);
  const approved = project.scenes.filter((s) => s.status.video === 'approved' && s.assets.video_path);
  if (!approved.length) throw new Error('No approved clips to export');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${project.id}-clips.zip"`);
  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', (err) => res.destroy(err));
  archive.pipe(res);
  for (const scene of approved) {
    archive.file(path.join(projectDir(project.id), scene.assets.video_path), {
      name: `${String(scene.order).padStart(2, '0')}-${scene.id}.mp4`,
    });
  }
  archive.finalize();
}));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Animated Ad Pipeline running at http://localhost:${PORT}`);
  // Re-attach to any tasks that were in flight when the server last stopped.
  try {
    resumePending(listProjects().map((p) => p.id));
  } catch (err) {
    console.error('Resume scan failed:', err);
  }
});
