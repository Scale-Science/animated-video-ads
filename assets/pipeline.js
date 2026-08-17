// Generation orchestration for the generator app: build reference-library
// character images, generate scene images (attaching mapped references by file
// number), and animate approved frames with Kling 3. Everything caches to
// IndexedDB, persists after every transition, isolates per-item failures, and
// resumes in-flight tasks after a reload.
import { createTask, pollTask, uploadBlob, fetchAsset, UPLOAD_TTL_MS } from './kie.js';
import { loadProject, updateProject } from './store.js';
import { putBlob, getBlob, invalidateUrl } from './db.js';

const IMAGE_MODEL = 'nano-banana-pro';
const VIDEO_MODEL = 'kling-3.0/video';
const MAX_CONCURRENCY = 5;

export const events = new EventTarget();
const emit = (projectId) => events.dispatchEvent(new CustomEvent('change', { detail: { projectId } }));

// Run thunks with bounded concurrency (kie.ai rate-limit friendly).
async function runPool(thunks, concurrency = MAX_CONCURRENCY) {
  const queue = [...thunks];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);
}

// Ensure a holder ({url, uploadedAt, path}) has a fresh uploaded kie.ai URL.
// setUrl(project, {url, uploadedAt}) persists a refreshed URL back onto the holder.
async function freshUrl(projectId, holder, setUrl) {
  if (holder.url && holder.uploadedAt && Date.now() - Date.parse(holder.uploadedAt) < UPLOAD_TTL_MS) {
    return holder.url;
  }
  if (!holder.path) throw new Error('asset has no cached image to upload');
  const blob = await getBlob(`${projectId}:${holder.path}`);
  if (!blob) throw new Error(`cached asset missing from this browser (${holder.path})`);
  const url = await uploadBlob(blob, holder.path.split('/').pop(), `video-gen/${projectId}`);
  const uploadedAt = new Date().toISOString();
  updateProject(projectId, (p) => setUrl(p, { url, uploadedAt }));
  return url;
}

// Resolve a fileMap entry's refId to a fresh hosted URL.
// refId is a library reference id, or "scene:<sceneId>" for a prior scene frame.
async function resolveRefUrl(projectId, refId) {
  if (!refId) return null;
  const project = loadProject(projectId);
  if (refId.startsWith('scene:')) {
    const sid = refId.slice('scene:'.length);
    const scene = project.scenes.find((s) => s.id === sid);
    if (!scene?.image?.path) return null;
    return freshUrl(projectId, scene.image, (p, r) => {
      const s = p.scenes.find((x) => x.id === sid);
      s.image.url = r.url; s.image.uploadedAt = r.uploadedAt;
    });
  }
  const ref = project.references.find((r) => r.id === refId);
  if (!ref?.path && !ref?.url) return null;
  return freshUrl(projectId, ref, (p, r) => {
    const x = p.references.find((y) => y.id === refId);
    x.url = r.url; x.uploadedAt = r.uploadedAt;
  });
}

// --- reference library: generate character images ---

function setRef(projectId, refId, mutate) {
  const p = updateProject(projectId, (proj) => {
    const ref = proj.references.find((r) => r.id === refId);
    if (ref) mutate(ref, proj);
  });
  emit(projectId);
  return p;
}

export async function generateReference(projectId, refId) {
  const project = loadProject(projectId);
  const ref = project.references.find((r) => r.id === refId);
  if (!ref) throw new Error(`Unknown reference ${refId}`);
  if (!ref.prompt?.trim()) throw new Error(`Reference "${ref.label}" has no prompt`);

  setRef(projectId, refId, (r) => { r.status = 'generating'; r.error = null; });
  try {
    const image_input = [];
    for (const rid of ref.charRefIds || []) {
      const url = await resolveRefUrl(projectId, rid);
      if (url) image_input.push(url);
    }
    const taskId = await createTask(IMAGE_MODEL, {
      prompt: ref.prompt,
      image_input: image_input.slice(0, 8),
      aspect_ratio: project.settings.aspectRatio,
      resolution: project.settings.resolution,
      output_format: 'png',
    });
    setRef(projectId, refId, (r, p) => { r.taskId = taskId; p.counters.imageGens += 1; });
    await attachRefTask(projectId, refId, taskId);
  } catch (err) {
    setRef(projectId, refId, (r) => { r.status = 'failed'; r.error = String(err.message || err); });
  }
}

async function attachRefTask(projectId, refId, taskId) {
  try {
    const [url] = await pollTask(taskId);
    const blob = await fetchAsset(url);
    const path = `references/${refId}.png`;
    await putBlob(`${projectId}:${path}`, blob);
    invalidateUrl(`${projectId}:${path}`);
    // Store only the blob; a fresh uploaded URL is produced on demand by freshUrl.
    setRef(projectId, refId, (r) => {
      r.status = 'review'; r.path = path; r.url = null; r.uploadedAt = null; r.taskId = null;
    });
  } catch (err) {
    setRef(projectId, refId, (r) => { r.status = 'failed'; r.error = String(err.message || err); r.taskId = null; });
  }
}

export function generateAllReferences(projectId) {
  const project = loadProject(projectId);
  const todo = project.references.filter((r) => r.kind === 'character' && r.source === 'generated' && ['pending', 'failed'].includes(r.status));
  runPool(todo.map((r) => () => generateReference(projectId, r.id)));
  return todo.length;
}

// --- scenes: images ---

function setScene(projectId, sceneId, mutate) {
  const p = updateProject(projectId, (proj) => {
    const scene = proj.scenes.find((s) => s.id === sceneId);
    if (scene) mutate(scene, proj);
  });
  emit(projectId);
  return p;
}

export async function generateSceneImage(projectId, sceneId) {
  const project = loadProject(projectId);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);
  if (!scene.prompt_body?.trim()) throw new Error(`Scene ${sceneId} has no prompt`);

  setScene(projectId, sceneId, (s) => { s.image.status = 'generating'; s.image.error = null; });
  try {
    const image_input = [];
    for (const slot of [...scene.fileMap].sort((a, b) => a.file - b.file)) {
      const url = await resolveRefUrl(projectId, slot.refId);
      if (url) image_input.push(url);
    }
    const taskId = await createTask(IMAGE_MODEL, {
      prompt: scene.prompt_body,
      image_input: image_input.slice(0, 8),
      aspect_ratio: project.settings.aspectRatio,
      resolution: project.settings.resolution,
      output_format: 'png',
    });
    setScene(projectId, sceneId, (s, p) => { s.image.taskId = taskId; p.counters.imageGens += 1; });
    await attachImageTask(projectId, sceneId, taskId);
  } catch (err) {
    setScene(projectId, sceneId, (s) => { s.image.status = 'failed'; s.image.error = String(err.message || err); });
  }
}

async function attachImageTask(projectId, sceneId, taskId) {
  try {
    const [url] = await pollTask(taskId);
    const blob = await fetchAsset(url);
    const path = `scenes/${sceneId}.png`;
    await putBlob(`${projectId}:${path}`, blob);
    invalidateUrl(`${projectId}:${path}`);
    setScene(projectId, sceneId, (s) => {
      s.image.status = 'review'; s.image.path = path; s.image.url = null; s.image.uploadedAt = null; s.image.taskId = null;
    });
  } catch (err) {
    setScene(projectId, sceneId, (s) => { s.image.status = 'failed'; s.image.error = String(err.message || err); s.image.taskId = null; });
  }
}

export function generateAllSceneImages(projectId) {
  const project = loadProject(projectId);
  const todo = project.scenes.filter((s) => ['pending', 'failed'].includes(s.image.status));
  runPool(todo.map((s) => () => generateSceneImage(projectId, s.id)));
  return todo.length;
}

// --- scenes: videos ---

export async function generateVideo(projectId, sceneId) {
  const project = loadProject(projectId);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);
  if (scene.image.status !== 'approved') throw new Error(`Scene ${sceneId} image is not approved`);
  if (!scene.video.motion_prompt?.trim()) throw new Error(`Scene ${sceneId} has no motion prompt`);

  setScene(projectId, sceneId, (s) => { s.video.status = 'generating'; s.video.error = null; });
  try {
    const firstUrl = await resolveRefUrl(projectId, `scene:${sceneId}`);
    if (!firstUrl) throw new Error('approved first frame is unavailable');
    const image_urls = [firstUrl];
    if (scene.video.lastFrameRefId) {
      const lastUrl = await resolveRefUrl(projectId, scene.video.lastFrameRefId);
      if (lastUrl) image_urls.push(lastUrl);
    }
    const duration = String(Math.min(15, Math.max(3, Math.round(scene.video.duration_s || project.settings.defaultDuration || 4))));
    const taskId = await createTask(VIDEO_MODEL, {
      prompt: scene.video.motion_prompt,
      image_urls,
      duration,
      mode: 'pro',
      sound: !!project.settings.sound,
      multi_shots: false,
    });
    setScene(projectId, sceneId, (s, p) => { s.video.taskId = taskId; p.counters.videoGens += 1; });
    await attachVideoTask(projectId, sceneId, taskId);
  } catch (err) {
    setScene(projectId, sceneId, (s) => { s.video.status = 'failed'; s.video.error = String(err.message || err); });
  }
}

async function attachVideoTask(projectId, sceneId, taskId) {
  try {
    const [url] = await pollTask(taskId, { timeoutMs: 40 * 60 * 1000 });
    const blob = await fetchAsset(url);
    const path = `videos/${sceneId}.mp4`;
    await putBlob(`${projectId}:${path}`, blob);
    invalidateUrl(`${projectId}:${path}`);
    setScene(projectId, sceneId, (s) => {
      s.video.status = 'review'; s.video.path = path; s.video.url = null; s.video.taskId = null;
    });
  } catch (err) {
    setScene(projectId, sceneId, (s) => { s.video.status = 'failed'; s.video.error = String(err.message || err); s.video.taskId = null; });
  }
}

export function generateAllVideos(projectId) {
  const project = loadProject(projectId);
  const notReady = project.scenes.filter((s) => s.image.status !== 'approved');
  if (notReady.length) throw new Error(`Videos unlock once every scene image is approved. Waiting on: ${notReady.map((s) => s.id).join(', ')}`);
  const missing = project.scenes.filter((s) => !s.video.motion_prompt?.trim());
  if (missing.length) throw new Error(`These scenes have no motion prompt: ${missing.map((s) => s.id).join(', ')}`);
  const todo = project.scenes.filter((s) => ['pending', 'failed'].includes(s.video.status));
  runPool(todo.map((s) => () => generateVideo(projectId, s.id)));
  return todo.length;
}

// --- resume after reload ---

export function resumePending(projectId) {
  let project;
  try { project = loadProject(projectId); } catch { return; }
  for (const ref of project.references) {
    if (ref.status === 'generating') {
      if (ref.taskId) attachRefTask(projectId, ref.id, ref.taskId);
      else setRef(projectId, ref.id, (r) => { r.status = 'failed'; r.error = 'Interrupted (page was closed)'; });
    }
  }
  for (const scene of project.scenes) {
    if (scene.image.status === 'generating') {
      if (scene.image.taskId) attachImageTask(projectId, scene.id, scene.image.taskId);
      else setScene(projectId, scene.id, (s) => { s.image.status = 'failed'; s.image.error = 'Interrupted (page was closed)'; });
    }
    if (scene.video.status === 'generating') {
      if (scene.video.taskId) attachVideoTask(projectId, scene.id, scene.video.taskId);
      else setScene(projectId, scene.id, (s) => { s.video.status = 'failed'; s.video.error = 'Interrupted (page was closed)'; });
    }
  }
}
