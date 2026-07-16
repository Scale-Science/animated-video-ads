// localStorage-backed project store — the browser analog of server/store.js.
// Project JSON is small; heavy assets live in IndexedDB (see db.js).

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
    .map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, storyboardStatus: p.storyboardStatus, sceneCount: p.scenes.length }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function createProject({ name, settings = {} }) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const id = `${slug}-${Math.random().toString(16).slice(2, 8)}`;
  const project = {
    id,
    name,
    createdAt: new Date().toISOString(),
    settings: {
      styleDescriptor: 'Polished 3D animated explainer in the style of ZackDFilms. Smooth semi-realistic render, softly stylized proportions, clean detailed skin with subtle freckles, gentle studio lighting with soft shadows, shallow depth of field.',
      creativeDirection: '',
      brandAccent: '',
      backgroundNote: '',
      aspectRatio: '9:16',
      continuityChaining: false,
      sound: false,
      ...settings,
    },
    references: { character: null, product: [] },
    script: '',
    storyboardStatus: 'empty', // empty | draft | approved
    storyboardMeta: null,
    scenes: [],
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

export function newScene(raw, index) {
  return {
    id: `scene-${String(index + 1).padStart(2, '0')}`,
    order: raw.order ?? index + 1,
    start: raw.start ?? '',
    duration_s: raw.duration_s ?? 4,
    vo: raw.vo ?? '',
    is_transformation: !!raw.is_transformation,
    start_frame_prompt: raw.start_frame_prompt ?? '',
    end_frame_prompt: raw.end_frame_prompt ?? null,
    motion_prompt: raw.motion_prompt ?? '',
    reference_order: raw.reference_order ?? [],
    end_frame_reference_order: raw.end_frame_reference_order ?? [],
    status: { start_frame: 'pending', end_frame: raw.is_transformation ? 'pending' : 'n/a', video: 'pending' },
    tasks: { start_frame: null, end_frame: null, video: null },
    error: { start_frame: null, end_frame: null, video: null },
    assets: {
      start_frame_url: null, start_frame_path: null, start_frame_uploaded_at: null,
      end_frame_url: null, end_frame_path: null, end_frame_uploaded_at: null,
      video_url: null, video_path: null,
    },
  };
}
