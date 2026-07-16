// Disk-backed project store. Everything lives in projects/<id>/project.json plus
// asset subfolders, so a run survives restarts and paid generations are never lost.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECTS_DIR = path.join(ROOT, 'projects');
export const SKILL_DIR = path.join(ROOT, 'animated-video-ad-pipeline');

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

export function projectDir(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid project id: ${id}`);
  return path.join(PROJECTS_DIR, id);
}

export function assetDir(id, kind) {
  const dir = path.join(projectDir(id), kind); // references | frames | videos | exports
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listProjects() {
  return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PROJECTS_DIR, e.name, 'project.json')))
    .map((e) => {
      const p = loadProject(e.name);
      return { id: p.id, name: p.name, createdAt: p.createdAt, storyboardStatus: p.storyboardStatus, sceneCount: p.scenes.length };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function createProject({ name, settings = {} }) {
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project'}-${crypto.randomBytes(3).toString('hex')}`;
  const project = {
    id,
    name,
    createdAt: new Date().toISOString(),
    settings: {
      styleDescriptor: 'Polished 3D animated explainer in the style of ZackDFilms. Smooth semi-realistic render, softly stylized proportions, clean detailed skin with subtle freckles, gentle studio lighting with soft shadows, shallow depth of field.',
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
    storyboardMeta: null,      // { style_block, character_block, product_block }
    scenes: [],
    counters: { imageGens: 0, videoGens: 0 },
  };
  fs.mkdirSync(projectDir(id), { recursive: true });
  saveProject(project);
  return project;
}

export function loadProject(id) {
  const file = path.join(projectDir(id), 'project.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveProject(project) {
  const file = path.join(projectDir(project.id), 'project.json');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2));
  fs.renameSync(tmp, file);
  return project;
}

// Read-modify-write helper so concurrent poll loops don't clobber each other.
// Node is single-threaded, so a synchronous load->mutate->save is atomic per call.
export function updateProject(id, mutate) {
  const project = loadProject(id);
  mutate(project);
  saveProject(project);
  return project;
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
