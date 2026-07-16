// Browser port of server/pipeline.js: submit kie.ai tasks per scene, poll to
// completion, cache assets in IndexedDB, persist state after every transition.
// A failed scene never aborts the batch; resumePending() re-attaches after a reload.
import { createTask, pollTask, uploadBlob, fetchAsset, UPLOAD_TTL_MS } from './kie.js';
import { loadProject, updateProject } from './store.js';
import { putBlob, getBlob, invalidateUrl } from './db.js';

const IMAGE_MODEL = 'nano-banana-pro';
const VIDEO_MODEL = 'kling-3.0/video';

// Notifies the UI whenever a scene changes state.
export const events = new EventTarget();
const emit = (projectId) => events.dispatchEvent(new CustomEvent('change', { detail: { projectId } }));

function setScene(projectId, sceneId, mutate) {
  const p = updateProject(projectId, (proj) => {
    const scene = proj.scenes.find((s) => s.id === sceneId);
    if (scene) mutate(scene, proj);
  });
  emit(projectId);
  return p;
}

// Ensure an asset ({ path: blobKey, url, uploadedAt }) has a fresh kie.ai URL.
async function freshUrl(projectId, asset) {
  if (asset.url && asset.uploadedAt && Date.now() - Date.parse(asset.uploadedAt) < UPLOAD_TTL_MS) {
    return { url: asset.url, uploadedAt: asset.uploadedAt, refreshed: false };
  }
  if (!asset.path) throw new Error('Reference asset has no cached file to upload');
  const blob = await getBlob(`${projectId}:${asset.path}`);
  if (!blob) throw new Error(`Cached asset missing from this browser (${asset.path}) — regenerate or re-upload it`);
  const url = await uploadBlob(blob, asset.path.split('/').pop(), `video-gen/${projectId}`);
  return { url, uploadedAt: new Date().toISOString(), refreshed: true };
}

async function resolveReference(projectId, sceneId, name, { forEndFrame = false } = {}) {
  const project = loadProject(projectId);
  const sceneIdx = project.scenes.findIndex((s) => s.id === sceneId);

  const refresh = async (getAsset, setUrl) => {
    const asset = getAsset(project);
    if (!asset || !asset.path) return null;
    const r = await freshUrl(projectId, asset);
    if (r.refreshed) updateProject(projectId, (p) => setUrl(p, r));
    return r.url;
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
    case 'prev_frame':
      return refresh(
        (p) => {
          const s = p.scenes[sceneIdx - 1];
          return s?.assets.start_frame_path
            ? { url: s.assets.start_frame_url, uploadedAt: s.assets.start_frame_uploaded_at, path: s.assets.start_frame_path }
            : null;
        },
        (p, r) => {
          const s = p.scenes[sceneIdx - 1];
          s.assets.start_frame_url = r.url;
          s.assets.start_frame_uploaded_at = r.uploadedAt;
        },
      );
    case 'start_frame': {
      if (!forEndFrame) return null;
      return refresh(
        (p) => {
          const s = p.scenes[sceneIdx];
          return s.assets.start_frame_path
            ? { url: s.assets.start_frame_url, uploadedAt: s.assets.start_frame_uploaded_at, path: s.assets.start_frame_path }
            : null;
        },
        (p, r) => {
          const s = p.scenes[sceneIdx];
          s.assets.start_frame_url = r.url;
          s.assets.start_frame_uploaded_at = r.uploadedAt;
        },
      );
    }
    default:
      return null;
  }
}

// --- Frames (Stage 2) ---

export async function generateFrame(projectId, sceneId, which /* 'start' | 'end' */) {
  const key = `${which}_frame`;
  const project = loadProject(projectId);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);
  const prompt = which === 'start' ? scene.start_frame_prompt : scene.end_frame_prompt;
  if (!prompt) throw new Error(`Scene ${sceneId} has no ${key} prompt`);

  let refNames = which === 'start' ? [...scene.reference_order] : [...scene.end_frame_reference_order];
  if (which === 'start' && project.settings.continuityChaining && scene.order > 1 && !refNames.includes('prev_frame')) {
    refNames = ['prev_frame', ...refNames];
  }

  setScene(projectId, sceneId, (s) => { s.status[key] = 'generating'; s.error[key] = null; });
  try {
    const imageInput = [];
    for (const name of refNames) {
      const url = await resolveReference(projectId, sceneId, name, { forEndFrame: which === 'end' });
      if (url) imageInput.push(url);
    }
    const taskId = await createTask(IMAGE_MODEL, {
      prompt,
      image_input: imageInput.slice(0, 8),
      aspect_ratio: project.settings.aspectRatio,
      resolution: '2K',
      output_format: 'png',
    });
    setScene(projectId, sceneId, (s, p) => { s.tasks[key] = taskId; p.counters.imageGens += 1; });
    await attachFrameTask(projectId, sceneId, which, taskId);
  } catch (err) {
    setScene(projectId, sceneId, (s) => { s.status[key] = 'failed'; s.error[key] = String(err.message || err); });
  }
}

async function attachFrameTask(projectId, sceneId, which, taskId) {
  const key = `${which}_frame`;
  try {
    const [url] = await pollTask(taskId);
    const blob = await fetchAsset(url);
    const blobPath = `frames/${sceneId}-${which}.png`;
    await putBlob(`${projectId}:${blobPath}`, blob);
    invalidateUrl(`${projectId}:${blobPath}`);
    setScene(projectId, sceneId, (s) => {
      s.status[key] = 'review';
      s.assets[`${key}_url`] = url;
      s.assets[`${key}_uploaded_at`] = new Date().toISOString();
      s.assets[`${key}_path`] = blobPath;
      s.tasks[key] = null;
    });
  } catch (err) {
    setScene(projectId, sceneId, (s) => { s.status[key] = 'failed'; s.error[key] = String(err.message || err); s.tasks[key] = null; });
  }
}

export function generateAllFrames(projectId) {
  const project = loadProject(projectId);
  let count = 0;
  const jobs = [];
  for (const scene of project.scenes) {
    if (['pending', 'failed'].includes(scene.status.start_frame)) {
      count++;
      jobs.push(generateFrame(projectId, scene.id, 'start').then(async () => {
        const fresh = loadProject(projectId).scenes.find((s) => s.id === scene.id);
        if (fresh.is_transformation && fresh.end_frame_prompt && ['pending', 'failed'].includes(fresh.status.end_frame) && fresh.assets.start_frame_path) {
          await generateFrame(projectId, scene.id, 'end');
        }
      }));
    } else if (scene.is_transformation && scene.end_frame_prompt && ['pending', 'failed'].includes(scene.status.end_frame) && scene.assets.start_frame_path) {
      count++;
      jobs.push(generateFrame(projectId, scene.id, 'end'));
    }
  }
  Promise.allSettled(jobs);
  return count;
}

// --- Videos (Stage 3) ---

export async function generateVideo(projectId, sceneId) {
  const project = loadProject(projectId);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);
  if (scene.status.start_frame !== 'approved') throw new Error(`Scene ${sceneId} start frame is not approved`);

  setScene(projectId, sceneId, (s) => { s.status.video = 'generating'; s.error.video = null; });
  try {
    const startUrl = await resolveReference(projectId, sceneId, 'start_frame', { forEndFrame: true });
    if (!startUrl) throw new Error('No start frame available');
    const imageUrls = [startUrl];
    if (scene.is_transformation && scene.assets.end_frame_path && scene.status.end_frame === 'approved') {
      const r = await freshUrl(projectId, {
        url: scene.assets.end_frame_url,
        uploadedAt: scene.assets.end_frame_uploaded_at,
        path: scene.assets.end_frame_path,
      });
      if (r.refreshed) {
        setScene(projectId, sceneId, (s) => { s.assets.end_frame_url = r.url; s.assets.end_frame_uploaded_at = r.uploadedAt; });
      }
      imageUrls.push(r.url);
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
    setScene(projectId, sceneId, (s, p) => { s.tasks.video = taskId; p.counters.videoGens += 1; });
    await attachVideoTask(projectId, sceneId, taskId);
  } catch (err) {
    setScene(projectId, sceneId, (s) => { s.status.video = 'failed'; s.error.video = String(err.message || err); });
  }
}

async function attachVideoTask(projectId, sceneId, taskId) {
  try {
    const [url] = await pollTask(taskId, { timeoutMs: 40 * 60 * 1000 });
    const blob = await fetchAsset(url);
    const blobPath = `videos/${sceneId}.mp4`;
    await putBlob(`${projectId}:${blobPath}`, blob);
    invalidateUrl(`${projectId}:${blobPath}`);
    setScene(projectId, sceneId, (s) => {
      s.status.video = 'review';
      s.assets.video_url = url;
      s.assets.video_path = blobPath;
      s.tasks.video = null;
    });
  } catch (err) {
    setScene(projectId, sceneId, (s) => { s.status.video = 'failed'; s.error.video = String(err.message || err); s.tasks.video = null; });
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
  emit(projectId);
  const [url] = await pollTask(taskId);
  const blob = await fetchAsset(url);
  const blobPath = `references/character-generated-${Date.now()}.png`;
  await putBlob(`${projectId}:${blobPath}`, blob);
  return { url, path: blobPath };
}

// --- Resume after reload ---

export function resumePending(projectId) {
  let project;
  try { project = loadProject(projectId); } catch { return; }
  for (const scene of project.scenes) {
    if (scene.tasks.start_frame) attachFrameTask(projectId, scene.id, 'start', scene.tasks.start_frame);
    if (scene.tasks.end_frame) attachFrameTask(projectId, scene.id, 'end', scene.tasks.end_frame);
    if (scene.tasks.video) attachVideoTask(projectId, scene.id, scene.tasks.video);
    for (const key of ['start_frame', 'end_frame', 'video']) {
      if (scene.status[key] === 'generating' && !scene.tasks[key]) {
        setScene(projectId, scene.id, (s) => { s.status[key] = 'failed'; s.error[key] = 'Interrupted before task submission (page was closed)'; });
      }
    }
  }
}
