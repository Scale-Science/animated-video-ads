// Stage 2/3 orchestration: submit kie.ai tasks per scene, poll to completion,
// download assets, persist state after every transition. A failed scene never
// aborts the batch. Restart-safe: resumePending() re-attaches to in-flight tasks.
import path from 'node:path';
import fs from 'node:fs';
import { createTask, pollTask, uploadFile, downloadAsset, UPLOAD_TTL_MS } from './kie.js';
import { loadProject, updateProject, assetDir, projectDir } from './store.js';

const IMAGE_MODEL = 'nano-banana-pro';
const VIDEO_MODEL = 'kling-3.0/video';

// Ensure a locally-stored asset has a fresh kie.ai URL (uploads expire after ~3 days).
async function freshUrl(projectId, asset) {
  if (asset.url && asset.uploadedAt && Date.now() - Date.parse(asset.uploadedAt) < UPLOAD_TTL_MS) {
    return asset.url;
  }
  if (!asset.path) throw new Error('Reference asset has no local file to upload');
  const abs = path.isAbsolute(asset.path) ? asset.path : path.join(projectDir(projectId), asset.path);
  const url = await uploadFile(abs, `video-gen/${projectId}`);
  return { url, uploadedAt: new Date().toISOString() };
}

// Resolve one reference name to a URL, refreshing uploads as needed and
// persisting refreshed URLs back into the project.
async function resolveReference(projectId, sceneId, name, { forEndFrame = false } = {}) {
  const project = loadProject(projectId);
  const scene = project.scenes.find((s) => s.id === sceneId);
  const sceneIdx = project.scenes.indexOf(scene);

  const refresh = async (getAsset, setUrl) => {
    const asset = getAsset(project);
    if (!asset) return null;
    const result = await freshUrl(projectId, asset);
    if (typeof result === 'string') return result;
    updateProject(projectId, (p) => setUrl(p, result));
    return result.url;
  };

  switch (name) {
    case 'character':
      return refresh(
        (p) => p.references.character,
        (p, r) => Object.assign(p.references.character, { url: r.url, uploadedAt: r.uploadedAt }),
      );
    case 'product':
      return refresh(
        (p) => p.references.product[0],
        (p, r) => Object.assign(p.references.product[0], { url: r.url, uploadedAt: r.uploadedAt }),
      );
    case 'prev_frame': {
      const prev = project.scenes[sceneIdx - 1];
      if (!prev?.assets.start_frame_path) return null;
      return refresh(
        (p) => {
          const s = p.scenes[sceneIdx - 1];
          return { url: s.assets.start_frame_url, uploadedAt: s.assets.start_frame_uploaded_at, path: s.assets.start_frame_path };
        },
        (p, r) => {
          const s = p.scenes[sceneIdx - 1];
          s.assets.start_frame_url = r.url;
          s.assets.start_frame_uploaded_at = r.uploadedAt;
        },
      );
    }
    case 'start_frame': {
      if (!forEndFrame) return null;
      return refresh(
        (p) => {
          const s = p.scenes.find((x) => x.id === sceneId);
          return s.assets.start_frame_path
            ? { url: s.assets.start_frame_url, uploadedAt: s.assets.start_frame_uploaded_at, path: s.assets.start_frame_path }
            : null;
        },
        (p, r) => {
          const s = p.scenes.find((x) => x.id === sceneId);
          s.assets.start_frame_url = r.url;
          s.assets.start_frame_uploaded_at = r.uploadedAt;
        },
      );
    }
    default:
      return null;
  }
}

async function resolveReferences(projectId, scene, names, opts) {
  const urls = [];
  for (const name of names) {
    const url = await resolveReference(projectId, scene.id, name, opts);
    if (url) urls.push(url);
  }
  return urls.slice(0, 8); // Nano Banana Pro max
}

function setSceneField(projectId, sceneId, mutate) {
  return updateProject(projectId, (p) => {
    const scene = p.scenes.find((s) => s.id === sceneId);
    if (scene) mutate(scene, p);
  });
}

// --- Frames (Stage 2) ---

export async function generateFrame(projectId, sceneId, which /* 'start' | 'end' */) {
  const key = `${which}_frame`;
  let project = loadProject(projectId);
  let scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);
  const prompt = which === 'start' ? scene.start_frame_prompt : scene.end_frame_prompt;
  if (!prompt) throw new Error(`Scene ${sceneId} has no ${key} prompt`);

  let refNames = which === 'start' ? [...scene.reference_order] : [...scene.end_frame_reference_order];
  if (which === 'start' && project.settings.continuityChaining && scene.order > 1 && !refNames.includes('prev_frame')) {
    refNames = ['prev_frame', ...refNames];
  }

  setSceneField(projectId, sceneId, (s) => { s.status[key] = 'generating'; s.error[key] = null; });
  try {
    const imageInput = await resolveReferences(projectId, scene, refNames, { forEndFrame: which === 'end' });
    const taskId = await createTask(IMAGE_MODEL, {
      prompt,
      image_input: imageInput,
      aspect_ratio: project.settings.aspectRatio,
      resolution: '2K',
      output_format: 'png',
    });
    setSceneField(projectId, sceneId, (s, p) => { s.tasks[key] = taskId; p.counters.imageGens += 1; });
    await attachFrameTask(projectId, sceneId, which, taskId);
  } catch (err) {
    setSceneField(projectId, sceneId, (s) => { s.status[key] = 'failed'; s.error[key] = String(err.message || err); });
  }
}

async function attachFrameTask(projectId, sceneId, which, taskId) {
  const key = `${which}_frame`;
  try {
    const [url] = await pollTask(taskId);
    const dest = path.join(assetDir(projectId, 'frames'), `${sceneId}-${which}.png`);
    await downloadAsset(url, dest);
    setSceneField(projectId, sceneId, (s) => {
      s.status[key] = 'review';
      s.assets[`${key}_url`] = url;
      s.assets[`${key}_uploaded_at`] = new Date().toISOString();
      s.assets[`${key}_path`] = path.relative(projectDir(projectId), dest);
      s.tasks[key] = null;
    });
  } catch (err) {
    setSceneField(projectId, sceneId, (s) => { s.status[key] = 'failed'; s.error[key] = String(err.message || err); s.tasks[key] = null; });
  }
}

export function generateAllFrames(projectId) {
  const project = loadProject(projectId);
  const jobs = [];
  for (const scene of project.scenes) {
    if (['pending', 'failed'].includes(scene.status.start_frame)) {
      jobs.push(generateFrame(projectId, scene.id, 'start').then(async () => {
        // End frames reference the just-generated start frame (skill: attach it as file 1),
        // so they run after the start frame lands.
        const fresh = loadProject(projectId).scenes.find((s) => s.id === scene.id);
        if (fresh.is_transformation && fresh.end_frame_prompt && ['pending', 'failed'].includes(fresh.status.end_frame) && fresh.assets.start_frame_path) {
          await generateFrame(projectId, scene.id, 'end');
        }
      }));
    } else if (scene.is_transformation && scene.end_frame_prompt && ['pending', 'failed'].includes(scene.status.end_frame) && scene.assets.start_frame_path) {
      jobs.push(generateFrame(projectId, scene.id, 'end'));
    }
  }
  // fire-and-forget; state is polled by the frontend
  Promise.allSettled(jobs);
  return jobs.length;
}

// --- Videos (Stage 3) ---

export async function generateVideo(projectId, sceneId) {
  const project = loadProject(projectId);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);
  if (scene.status.start_frame !== 'approved') throw new Error(`Scene ${sceneId} start frame is not approved`);

  setSceneField(projectId, sceneId, (s) => { s.status.video = 'generating'; s.error.video = null; });
  try {
    const startUrl = await resolveReference(projectId, sceneId, 'start_frame', { forEndFrame: true });
    if (!startUrl) throw new Error('No start frame available');
    const imageUrls = [startUrl];
    if (scene.is_transformation && scene.assets.end_frame_path && scene.status.end_frame === 'approved') {
      const fresh = await freshUrl(projectId, {
        url: scene.assets.end_frame_url,
        uploadedAt: scene.assets.end_frame_uploaded_at,
        path: scene.assets.end_frame_path,
      });
      const endUrl = typeof fresh === 'string' ? fresh : fresh.url;
      if (typeof fresh !== 'string') {
        setSceneField(projectId, sceneId, (s) => { s.assets.end_frame_url = fresh.url; s.assets.end_frame_uploaded_at = fresh.uploadedAt; });
      }
      imageUrls.push(endUrl);
    }
    const duration = String(Math.min(15, Math.max(3, Math.round(scene.duration_s || 4))));
    const taskId = await createTask(VIDEO_MODEL, {
      prompt: scene.motion_prompt,
      image_urls: imageUrls,
      duration,
      mode: 'pro',
      sound: !!project.settings.sound,
      multi_shots: false,
    });
    setSceneField(projectId, sceneId, (s, p) => { s.tasks.video = taskId; p.counters.videoGens += 1; });
    await attachVideoTask(projectId, sceneId, taskId);
  } catch (err) {
    setSceneField(projectId, sceneId, (s) => { s.status.video = 'failed'; s.error.video = String(err.message || err); });
  }
}

async function attachVideoTask(projectId, sceneId, taskId) {
  try {
    const [url] = await pollTask(taskId, { timeoutMs: 40 * 60 * 1000 });
    const dest = path.join(assetDir(projectId, 'videos'), `${sceneId}.mp4`);
    await downloadAsset(url, dest);
    setSceneField(projectId, sceneId, (s) => {
      s.status.video = 'review';
      s.assets.video_url = url;
      s.assets.video_path = path.relative(projectDir(projectId), dest);
      s.tasks.video = null;
    });
  } catch (err) {
    setSceneField(projectId, sceneId, (s) => { s.status.video = 'failed'; s.error.video = String(err.message || err); s.tasks.video = null; });
  }
}

export function generateAllVideos(projectId) {
  const project = loadProject(projectId);
  const notReady = project.scenes.filter((s) => s.status.start_frame !== 'approved');
  if (notReady.length) throw new Error(`Videos are gated on all start frames being approved. Waiting on: ${notReady.map((s) => s.id).join(', ')}`);
  let count = 0;
  const jobs = [];
  for (const scene of project.scenes) {
    if (['pending', 'failed'].includes(scene.status.video)) {
      jobs.push(generateVideo(projectId, scene.id));
      count++;
    }
  }
  Promise.allSettled(jobs);
  return count;
}

// --- Character generation (Stage 0 helper) ---

export async function generateCharacterImage(projectId, prompt) {
  const project = loadProject(projectId);
  const taskId = await createTask(IMAGE_MODEL, {
    prompt,
    image_input: [],
    aspect_ratio: project.settings.aspectRatio,
    resolution: '2K',
    output_format: 'png',
  });
  updateProject(projectId, (p) => { p.counters.imageGens += 1; });
  const [url] = await pollTask(taskId);
  const dest = path.join(assetDir(projectId, 'references'), `character-generated-${Date.now()}.png`);
  await downloadAsset(url, dest);
  return { url, path: path.relative(projectDir(projectId), dest) };
}

// --- Resume after restart ---

export function resumePending(projectIds) {
  for (const id of projectIds) {
    let project;
    try { project = loadProject(id); } catch { continue; }
    for (const scene of project.scenes) {
      if (scene.tasks.start_frame) attachFrameTask(id, scene.id, 'start', scene.tasks.start_frame);
      if (scene.tasks.end_frame) attachFrameTask(id, scene.id, 'end', scene.tasks.end_frame);
      if (scene.tasks.video) attachVideoTask(id, scene.id, scene.tasks.video);
      // Anything marked 'generating' with no task id died before submission — mark failed.
      for (const key of ['start_frame', 'end_frame', 'video']) {
        if (scene.status[key] === 'generating' && !scene.tasks[key]) {
          setSceneField(id, scene.id, (s) => { s.status[key] = 'failed'; s.error[key] = 'Interrupted before task submission (server restart)'; });
        }
      }
    }
  }
}
