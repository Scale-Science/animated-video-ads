// localStorage-backed project store for the generator app.
// The app no longer writes scripts/storyboards/prompts — the operator pastes
// finished prompts. A project holds a labeled reference library, parsed scenes
// with per-scene file→reference mapping, and per-scene video state.
// Project JSON lives in localStorage; heavy image/video blobs live in IndexedDB.

const INDEX = 'aap:projects';
const KEYS = 'aap:keys';

export function getKeys() {
  try { return JSON.parse(localStorage.getItem(KEYS)) || {}; } catch { return {}; }
}
export function setKeys(keys) {
  localStorage.setItem(KEYS, JSON.stringify(keys));
}

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX)) || []; } catch { return []; }
}

export function listProjects() {
  return readIndex()
    .map((id) => { try { return loadProject(id); } catch { return null; } })
    .filter(Boolean)
    .map((p) => ({
      id: p.id, name: p.name, createdAt: p.createdAt,
      refCount: p.references.length, sceneCount: p.scenes.length,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const rid = () => Math.random().toString(16).slice(2, 8);

export function createProject({ name }) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const id = `${slug}-${rid()}`;
  const project = {
    id,
    name,
    createdAt: new Date().toISOString(),
    settings: { sound: false, defaultDuration: 4, resolution: '2K', aspectRatio: '9:16' },
    references: [],   // labeled library — see newReference()
    scenes: [],       // parsed scene prompts — see sceneFromParsed()
    scenesRaw: '',     // the pasted scene-prompt block (for re-parse)
    motionRaw: '',     // the pasted motion-prompt block
    counters: { imageGens: 0, videoGens: 0 },
  };
  saveProject(project);
  localStorage.setItem(INDEX, JSON.stringify([...readIndex(), id]));
  return project;
}

export function deleteProjectRecord(id) {
  localStorage.removeItem(`aap:project:${id}`);
  localStorage.setItem(INDEX, JSON.stringify(readIndex().filter((x) => x !== id)));
}

export function loadProject(id) {
  const raw = localStorage.getItem(`aap:project:${id}`);
  if (!raw) throw new Error(`Unknown project ${id}`);
  return JSON.parse(raw);
}

export function saveProject(project) {
  localStorage.setItem(`aap:project:${project.id}`, JSON.stringify(project));
  return project;
}

export function updateProject(id, mutate) {
  const project = loadProject(id);
  mutate(project);
  return saveProject(project);
}

// --- reference library entries ---

export function newReference({ label, kind, source, prompt = '', charRefIds = [] }) {
  return {
    id: `ref-${rid()}`,
    label: label.trim(),
    kind,                 // 'product' | 'character'
    source,               // 'upload' | 'generated'
    prompt,               // for generated characters
    charRefIds,           // library refs attached when generating this character (image_input)
    // Upload refs are 'approved' immediately (a hosted image exists). Generated
    // refs go pending -> generating -> review -> approved.
    status: source === 'upload' ? 'approved' : 'pending',
    taskId: null,
    error: null,
    url: null,            // hosted kie.ai URL (uploaded); produced on demand for generated refs
    uploadedAt: null,
    path: null,           // IndexedDB blob key suffix (project-scoped)
  };
}

// --- scenes (one per pasted scene prompt) ---

export function sceneFromParsed(parsed) {
  return {
    id: parsed.id,             // "P1", "P2", ...
    title: parsed.title || '',
    speaker: parsed.speaker || '',
    dialogue: parsed.dialogue || '',
    prompt_body: parsed.prompt_body || '',
    fileMap: parsed.fileMap || [],   // [{ file: 1, refId: null|<refId>|"scene:<sceneId>" }]
    image: { status: 'pending', taskId: null, url: null, uploadedAt: null, path: null, error: null },
    video: {
      motion_prompt: '', duration_s: null, lastFrameRefId: null,
      status: 'pending', taskId: null, url: null, uploadedAt: null, path: null, error: null,
    },
  };
}

// Merge freshly parsed scenes over the existing ones, preserving mapping and
// generated assets for scenes whose id survives. If a scene's prompt body
// changed, its image is marked stale (pending) so it regenerates.
export function mergeScenes(oldScenes, parsedScenes) {
  const byId = new Map(oldScenes.map((s) => [s.id, s]));
  return parsedScenes.map((parsed) => {
    const prev = byId.get(parsed.id);
    if (!prev) return sceneFromParsed(parsed);
    const merged = sceneFromParsed(parsed);
    // carry the operator's mapping and generated assets
    merged.fileMap = reconcileFileMap(parsed.fileMap, prev.fileMap);
    merged.image = prev.image;
    merged.video = { ...merged.video, ...prev.video, motion_prompt: prev.video.motion_prompt, duration_s: prev.video.duration_s, lastFrameRefId: prev.video.lastFrameRefId };
    if (prev.prompt_body !== parsed.prompt_body && merged.image.status !== 'pending') {
      merged.image = { ...merged.image, status: 'pending' }; // prompt changed → image is stale
    }
    return merged;
  });
}

// Keep operator-chosen refIds for file slots that still exist; add any new slots.
function reconcileFileMap(parsedMap, prevMap) {
  const prevByFile = new Map((prevMap || []).map((m) => [m.file, m.refId]));
  const out = (parsedMap || []).map((m) => ({
    file: m.file,
    refId: m.refId != null ? m.refId : (prevByFile.get(m.file) ?? null),
  }));
  // preserve any operator-added slots not present in the newly parsed set
  for (const m of prevMap || []) {
    if (!out.some((o) => o.file === m.file)) out.push({ file: m.file, refId: m.refId });
  }
  return out.sort((a, b) => a.file - b.file);
}
