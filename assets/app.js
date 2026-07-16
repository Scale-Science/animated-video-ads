/* Animated Ad Pipeline — static (GitHub Pages) build.
   Runs entirely in the browser: kie.ai and Anthropic are called directly with
   keys you store in this browser's localStorage. Projects persist in
   localStorage; generated assets are cached in IndexedDB. */

import * as store from './store.js';
import * as db from './db.js';
import * as pipeline from './pipeline.js';
import * as anthropic from './anthropic.js';
import { uploadBlob } from './kie.js';
import { buildZip } from './zip.js';

const state = {
  view: 'home',
  projects: [],
  project: null,
  tab: 'setup',
  busy: null,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

async function withBusy(label, fn) {
  state.busy = label;
  render();
  try {
    await fn();
  } catch (err) {
    toast(String(err.message || err));
  } finally {
    state.busy = null;
    render();
  }
}

// Re-render on pipeline state changes (task completions etc.)
pipeline.events.addEventListener('change', (e) => {
  if (state.view !== 'project' || state.project?.id !== e.detail.projectId) return;
  state.project = store.loadProject(state.project.id);
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (!typing && !state.busy) render();
});

function openProject(id, tab) {
  state.project = store.loadProject(id);
  state.view = 'project';
  if (tab) state.tab = tab;
  pipeline.resumePending(id);
  render();
}

function refresh() {
  if (state.project) state.project = store.loadProject(state.project.id);
}

function anyGenerating(p) {
  return p?.scenes?.some((s) => ['start_frame', 'end_frame', 'video'].some((k) => s.status[k] === 'generating'));
}

// --- rendering ---

function render() {
  $('#app').innerHTML = state.view === 'home' ? renderHome() : renderProject();
  hydrateBlobs();
}

// Point <img>/<video> tags with data-blob at IndexedDB object URLs after render.
function hydrateBlobs() {
  document.querySelectorAll('[data-blob]').forEach(async (el) => {
    const url = await db.objectUrl(el.dataset.blob);
    if (url && el.isConnected) el.src = url;
  });
}

const blobAttr = (path) => `data-blob="${esc(`${state.project.id}:${path}`)}"`;

function renderHome() {
  const keys = store.getKeys();
  return `
    <h1>Animated Ad Pipeline</h1>
    <div class="panel keybox">
      <h3>API keys</h3>
      <label>kie.ai API key (images + videos)</label>
      <input id="key-kie" type="password" value="${esc(keys.kie || '')}" placeholder="kie.ai key" autocomplete="off" />
      <label>Anthropic API key (storyboard)</label>
      <input id="key-anthropic" type="password" value="${esc(keys.anthropic || '')}" placeholder="sk-ant-…" autocomplete="off" />
      <div style="margin-top:10px"><button data-act="save-keys">Save keys</button></div>
      <div class="notice">Keys are stored only in this browser's localStorage and sent directly to kie.ai / Anthropic — never to any other server. Projects and generated media also live in this browser, so use the same browser (and profile) to come back to a project.</div>
    </div>
    <div class="panel">
      <h3>New project</h3>
      <div class="row">
        <input id="new-name" placeholder="Project name" style="max-width:320px" />
        <button data-act="create-project">Create</button>
      </div>
    </div>
    <div class="panel">
      <h3>Projects</h3>
      ${state.projects.length ? state.projects.map((p) => `
        <div class="row" style="padding:8px 0;border-bottom:1px solid var(--border)">
          <a data-act="open" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong></a>
          <span class="muted">${esc(p.id)}</span>
          <span class="badge ${esc(p.storyboardStatus)}">${esc(p.storyboardStatus)}</span>
          <span class="muted">${p.sceneCount} scenes</span>
          <span class="spacer"></span>
          <span class="muted">${new Date(p.createdAt).toLocaleString()}</span>
          <button class="danger small" data-act="delete-project" data-id="${esc(p.id)}">Delete</button>
        </div>`).join('') : '<div class="muted">No projects yet.</div>'}
    </div>`;
}

function stageDot(ok) {
  return `<span class="dot" style="background:${ok ? 'var(--green)' : 'var(--border)'}"></span>`;
}

function renderProject() {
  const p = state.project;
  const framesReady = p.scenes.length > 0 && p.scenes.every((s) => s.status.start_frame === 'approved' && (s.status.end_frame === 'n/a' || s.status.end_frame === 'approved'));
  const clipsApproved = p.scenes.filter((s) => s.status.video === 'approved').length;
  const tabs = [
    ['setup', `Setup${stageDot(!!(p.references.character || p.references.product.length))}`],
    ['storyboard', `Storyboard${stageDot(p.storyboardStatus === 'approved')}`],
    ['frames', `Frames${stageDot(framesReady)}`],
    ['videos', `Videos${stageDot(clipsApproved > 0 && clipsApproved === p.scenes.length)}`],
    ['export', 'Export'],
  ];
  return `
    <div class="row">
      <a data-act="home">&larr; Projects</a>
      <h1 style="margin:0">${esc(p.name)}</h1>
      <span class="spacer"></span>
      <span class="counters">generations — images: ${p.counters.imageGens} · videos: ${p.counters.videoGens}</span>
    </div>
    <div class="tabs">
      ${tabs.map(([id, label]) => `<button class="${state.tab === id ? 'active' : ''}" data-act="tab" data-tab="${id}">${label}</button>`).join('')}
    </div>
    ${state.busy ? `<div class="panel"><span class="busy">⏳ ${esc(state.busy)}…</span></div>` : ''}
    ${{ setup: renderSetup, storyboard: renderStoryboard, frames: renderFrames, videos: renderVideos, export: renderExport }[state.tab]()}
  `;
}

function renderSetup() {
  const p = state.project;
  const s = p.settings;
  return `
    <div class="panel">
      <h3>Project settings</h3>
      <label>Animation style &amp; creative notes — tone, mood, genre, anything the storyboard should reflect (e.g. "funny claymation", "serious muppets", "futuristic"). If you upload a style image below, you can just say "claymation just like the image attached". Claude writes the polished STYLE block from this before any images are made.</label>
      <textarea id="set-creative" placeholder="e.g. claymation just like the image attached, with deadpan humor">${esc(s.creativeDirection || '')}</textarea>
      <label>Style reference image (optional) — screenshot an animation style you want and it will be shown to Claude when writing the storyboard</label>
      ${p.references.style ? `
        <div class="row">
          <img class="ref-img" ${blobAttr(p.references.style.path)} />
          <button class="danger small" data-act="del-ref" data-role="style">Remove</button>
        </div>` : `
        <div class="row">
          <input type="file" id="style-file" accept="image/*" style="max-width:280px" />
          <button class="secondary" data-act="upload-style">Upload style image</button>
        </div>`}
      <div class="row">
        <div style="flex:1"><label>Brand accent color</label><input id="set-accent" value="${esc(s.brandAccent)}" placeholder="e.g. teal #17b3a6" /></div>
        <div style="flex:1"><label>Background note</label><input id="set-bg" value="${esc(s.backgroundNote)}" placeholder="e.g. faint blueprint grid" /></div>
        <div><label>Aspect ratio</label>
          <select id="set-ar">${['9:16', '16:9', '1:1', '4:5', '3:4'].map((r) => `<option ${s.aspectRatio === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <label style="margin:0"><input type="checkbox" id="set-chain" ${s.continuityChaining ? 'checked' : ''} style="width:auto"/> Continuity chaining (attach previous scene's approved frame as a reference)</label>
        <label style="margin:0"><input type="checkbox" id="set-sound" ${s.sound ? 'checked' : ''} style="width:auto"/> Kling sound on (off by default — ads are timed to a separate VO)</label>
      </div>
      <div style="margin-top:12px"><button data-act="save-settings">Save settings</button></div>
    </div>

    <div class="panel">
      <h3>Character reference (file 1)</h3>
      ${p.references.character ? `
        <div class="row">
          <img class="ref-img" ${blobAttr(p.references.character.path)} />
          <button class="danger small" data-act="del-ref" data-role="character">Remove</button>
        </div>` : `
        <div class="row">
          <input type="file" id="char-file" accept="image/*" style="max-width:280px" />
          <button class="secondary" data-act="upload-ref" data-role="character">Upload</button>
        </div>
        <label>…or generate one (a clean, single-subject, neutral-expression frame)</label>
        <div class="row">
          <input id="char-prompt" placeholder="Describe the character…" style="flex:1" />
          <button data-act="gen-character">Generate character</button>
        </div>`}
    </div>

    <div class="panel">
      <h3>Product reference (file 2)</h3>
      <div class="row">
        ${p.references.product.map((r, i) => `
          <div>
            <img class="ref-img" ${blobAttr(r.path)} />
            <button class="danger small" style="margin-top:4px" data-act="del-ref" data-role="product" data-index="${i}">Remove</button>
          </div>`).join('')}
      </div>
      <div class="row" style="margin-top:10px">
        <input type="file" id="prod-file" accept="image/*" style="max-width:280px" />
        <button class="secondary" data-act="upload-ref" data-role="product">Upload product photo</button>
      </div>
    </div>`;
}

function renderStoryboard() {
  const p = state.project;
  const locked = p.storyboardStatus === 'approved';
  return `
    <div class="panel">
      <h3>Script ${p.storyboardStatus !== 'empty' ? `<span class="badge ${locked ? 'approved' : 'review'}">${esc(p.storyboardStatus)}</span>` : ''}</h3>
      <label>Paste the finished, timestamped voiceover script</label>
      <textarea id="script" rows="8">${esc(p.script)}</textarea>
      <label>Optional note to the storyboard engine</label>
      <input id="sb-note" placeholder="e.g. keep the opening punchier" />
      <div class="row" style="margin-top:12px">
        <button data-act="gen-storyboard">${p.scenes.length ? 'Regenerate whole storyboard' : 'Generate storyboard'}</button>
        ${p.scenes.length && !locked ? '<button class="success" data-act="approve-storyboard">Approve storyboard</button>' : ''}
        ${locked ? '<span class="muted">Storyboard approved — head to the Frames tab.</span>' : ''}
      </div>
    </div>
    ${p.storyboardMeta ? `
    <details class="raw"><summary>Locked STYLE / CHARACTER / PRODUCT blocks</summary>
      <pre class="blocks">STYLE:\n${esc(p.storyboardMeta.style_block)}\n\nCHARACTER:\n${esc(p.storyboardMeta.character_block || '(none)')}\n\nPRODUCT:\n${esc(p.storyboardMeta.product_block || '(none)')}</pre>
    </details>` : ''}
    ${p.scenes.map(renderSceneEditor).join('')}
  `;
}

function renderSceneEditor(s) {
  return `
  <div class="panel" data-scene-panel="${s.id}">
    <div class="scene-head">
      <span class="title">Scene ${s.order}</span>
      <span class="muted">${esc(s.id)}</span>
      <span class="spacer"></span>
      <button class="secondary small" data-act="regen-scene" data-scene="${s.id}">Regenerate scene</button>
      <button class="small" data-act="save-scene" data-scene="${s.id}">Save edits</button>
    </div>
    <div class="row">
      <div><label>Start</label><input data-f="start" value="${esc(s.start)}" style="width:80px"/></div>
      <div><label>Duration (s)</label><input data-f="duration_s" type="number" min="3" max="15" value="${esc(s.duration_s)}" style="width:80px"/></div>
      <div style="flex:1"><label>VO line(s)</label><input data-f="vo" value="${esc(s.vo)}"/></div>
      <div><label>Transformation</label><input data-f="is_transformation" type="checkbox" ${s.is_transformation ? 'checked' : ''} style="width:auto"/></div>
    </div>
    <label>Starting-frame prompt</label>
    <textarea data-f="start_frame_prompt">${esc(s.start_frame_prompt)}</textarea>
    <label>References for the starting frame, in file order (comma-separated: character, product, prev_frame)</label>
    <input data-f="reference_order" value="${esc(s.reference_order.join(', '))}"/>
    ${s.is_transformation ? `
      <label>Ending-frame prompt</label>
      <textarea data-f="end_frame_prompt">${esc(s.end_frame_prompt || '')}</textarea>
      <label>References for the ending frame (start_frame, character, product…)</label>
      <input data-f="end_frame_reference_order" value="${esc(s.end_frame_reference_order.join(', '))}"/>` : ''}
    <label>Motion prompt</label>
    <textarea data-f="motion_prompt">${esc(s.motion_prompt)}</textarea>
  </div>`;
}

function badge(status) {
  const cls = status === 'n/a' ? 'na' : status;
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

const emptyThumb = '<div class="muted" style="aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;background:var(--panel2);border-radius:8px">no frame yet</div>';

function renderFrames() {
  const p = state.project;
  if (p.storyboardStatus !== 'approved') {
    return '<div class="panel muted">Approve the storyboard first — no images are generated until then.</div>';
  }
  const reviewable = p.scenes.some((s) => s.status.start_frame === 'review' || s.status.end_frame === 'review');
  const toGenerate = p.scenes.some((s) => ['pending', 'failed'].includes(s.status.start_frame) || (s.is_transformation && ['pending', 'failed'].includes(s.status.end_frame)));
  return `
    <div class="panel row">
      <button data-act="gen-frames" ${toGenerate ? '' : 'disabled'}>Generate all starting frames</button>
      <button class="success" data-act="approve-all-frames" ${reviewable ? '' : 'disabled'}>Approve all in review</button>
      ${anyGenerating(p) ? '<span class="busy">⏳ generating — keep this tab open; updates live</span>' : ''}
    </div>
    <div class="grid">
      ${p.scenes.map((s) => `
        <div class="card">
          <div class="scene-head"><span class="title">Scene ${s.order}</span><span class="muted">${esc(s.duration_s)}s</span><span class="spacer"></span></div>
          <div class="frame-pair">
            <div>
              <div class="thumb-label">Start ${badge(s.status.start_frame)}</div>
              ${s.assets.start_frame_path ? `<img ${blobAttr(s.assets.start_frame_path)}/>` : emptyThumb}
              <div class="row" style="margin-top:6px">
                ${s.status.start_frame === 'review' ? `<button class="success small" data-act="approve-frame" data-scene="${s.id}" data-which="start">Approve</button>` : ''}
                <button class="secondary small" data-act="regen-frame" data-scene="${s.id}" data-which="start" ${s.status.start_frame === 'generating' ? 'disabled' : ''}>Regenerate</button>
                <button class="secondary small" data-act="edit-prompt" data-scene="${s.id}" data-field="start_frame_prompt">Edit prompt</button>
              </div>
              ${s.error.start_frame ? `<div class="err">${esc(s.error.start_frame)}</div>` : ''}
            </div>
            ${s.is_transformation ? `
            <div>
              <div class="thumb-label">End ${badge(s.status.end_frame)}</div>
              ${s.assets.end_frame_path ? `<img ${blobAttr(s.assets.end_frame_path)}/>` : emptyThumb}
              <div class="row" style="margin-top:6px">
                ${s.status.end_frame === 'review' ? `<button class="success small" data-act="approve-frame" data-scene="${s.id}" data-which="end">Approve</button>` : ''}
                <button class="secondary small" data-act="regen-frame" data-scene="${s.id}" data-which="end" ${s.status.end_frame === 'generating' || !s.assets.start_frame_path ? 'disabled' : ''}>Regenerate</button>
                <button class="secondary small" data-act="edit-prompt" data-scene="${s.id}" data-field="end_frame_prompt">Edit prompt</button>
              </div>
              ${s.error.end_frame ? `<div class="err">${esc(s.error.end_frame)}</div>` : ''}
            </div>` : ''}
          </div>
          <div class="muted" style="margin-top:8px">${esc(s.vo)}</div>
        </div>`).join('')}
    </div>`;
}

function renderVideos() {
  const p = state.project;
  const gateOpen = p.scenes.length && p.scenes.every((s) => s.status.start_frame === 'approved' && (s.status.end_frame === 'n/a' || s.status.end_frame === 'approved'));
  if (!gateOpen) {
    return '<div class="panel muted">Videos unlock once every scene\'s frames are approved (start frame for every scene, end frame for transformation scenes).</div>';
  }
  const reviewable = p.scenes.some((s) => s.status.video === 'review');
  const toGenerate = p.scenes.some((s) => ['pending', 'failed'].includes(s.status.video));
  return `
    <div class="panel row">
      <button data-act="gen-videos" ${toGenerate ? '' : 'disabled'}>Generate all videos (Kling 3.0 pro)</button>
      <button class="success" data-act="approve-all-videos" ${reviewable ? '' : 'disabled'}>Approve all in review</button>
      ${anyGenerating(p) ? '<span class="busy">⏳ generating — keep this tab open; video tasks can take several minutes each</span>' : ''}
    </div>
    <div class="grid">
      ${p.scenes.map((s) => `
        <div class="card">
          <div class="scene-head"><span class="title">Scene ${s.order}</span>${badge(s.status.video)}<span class="muted">${esc(s.duration_s)}s${s.is_transformation ? ' · start→end interpolation' : ''}</span></div>
          ${s.assets.video_path ? `<video controls ${blobAttr(s.assets.video_path)}></video>` : (s.assets.start_frame_path ? `<img ${blobAttr(s.assets.start_frame_path)} style="opacity:.4"/>` : emptyThumb)}
          <div class="row" style="margin-top:6px">
            ${s.status.video === 'review' ? `<button class="success small" data-act="approve-video" data-scene="${s.id}">Approve</button>` : ''}
            <button class="secondary small" data-act="regen-video" data-scene="${s.id}" ${s.status.video === 'generating' ? 'disabled' : ''}>${s.assets.video_path ? 'Regenerate' : 'Generate'}</button>
            <button class="secondary small" data-act="edit-prompt" data-scene="${s.id}" data-field="motion_prompt">Edit motion prompt</button>
          </div>
          ${s.error.video ? `<div class="err">${esc(s.error.video)}</div>` : ''}
          <div class="muted" style="margin-top:8px">${esc(s.vo)}</div>
        </div>`).join('')}
    </div>`;
}

function renderExport() {
  const p = state.project;
  const approved = p.scenes.filter((s) => s.status.video === 'approved');
  return `
    <div class="panel">
      <h3>Export</h3>
      <p class="muted">${approved.length} of ${p.scenes.length} clips approved. The zip names clips by scene order so they drop into an editor in sequence.</p>
      <button data-act="export-zip" ${approved.length ? '' : 'disabled'}>Download all approved clips (.zip)</button>
    </div>
    <div class="grid">
      ${approved.map((s) => `
        <div class="card">
          <div class="scene-head"><span class="title">${String(s.order).padStart(2, '0')}-${esc(s.id)}.mp4</span></div>
          <video controls ${blobAttr(s.assets.video_path)}></video>
        </div>`).join('')}
    </div>`;
}

// --- events ---

function sceneEdits(panel) {
  const body = {};
  panel.querySelectorAll('[data-f]').forEach((el) => {
    const f = el.dataset.f;
    if (el.type === 'checkbox') body[f] = el.checked;
    else if (f === 'duration_s') body[f] = Number(el.value) || 4;
    else if (f.endsWith('reference_order')) body[f] = el.value.split(',').map((x) => x.trim()).filter(Boolean);
    else body[f] = el.value;
  });
  if (body.end_frame_prompt === '') body.end_frame_prompt = null;
  return body;
}

function applySceneEdits(sceneId, edits) {
  state.project = store.updateProject(state.project.id, (p) => {
    const scene = p.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error('Unknown scene');
    Object.assign(scene, edits);
    if (scene.is_transformation && scene.status.end_frame === 'n/a') scene.status.end_frame = 'pending';
    if (!scene.is_transformation) scene.status.end_frame = 'n/a';
  });
}

// Downscale to <=1568px long edge and re-encode as JPEG so screenshots stay
// well under Anthropic's per-image size limits.
async function normalizeStyleImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    return blob || file;
  } catch {
    return file;
  }
}

// Load the project's style reference image from IndexedDB as base64 for the
// Anthropic vision call. Returns null when no style image is set.
async function loadStyleImage() {
  const ref = state.project.references.style;
  if (!ref) return null;
  const blob = await db.getBlob(`${state.project.id}:${ref.path}`);
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }
  return { mediaType: blob.type || 'image/jpeg', dataB64: btoa(bin) };
}

async function fileToRef(file, role) {
  const pid = state.project.id;
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] || '.png').toLowerCase();
  const blobPath = role === 'character' ? `references/character${ext}` : `references/product-${Date.now()}${ext}`;
  await db.putBlob(`${pid}:${blobPath}`, file);
  db.invalidateUrl(`${pid}:${blobPath}`);
  const url = await uploadBlob(file, blobPath.split('/').pop(), `video-gen/${pid}`);
  return { path: blobPath, url, uploadedAt: new Date().toISOString() };
}

function bindEvents(app) {
  // Autosave the script textarea on blur so pasted text survives re-renders.
  app.addEventListener('change', (e) => {
    if (e.target.id === 'script' && state.project) {
      state.project = store.updateProject(state.project.id, (p) => { p.script = e.target.value; });
    }
  });

  app.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const pid = state.project?.id;
    const sceneId = btn.dataset.scene;

    const actions = {
      'home': () => { state.projects = store.listProjects(); state.view = 'home'; state.project = null; render(); },
      'open': () => openProject(btn.dataset.id, 'setup'),
      'tab': () => { state.tab = btn.dataset.tab; render(); },
      'save-keys': () => {
        store.setKeys({ kie: $('#key-kie').value.trim(), anthropic: $('#key-anthropic').value.trim() });
        toast('Keys saved to this browser.');
      },
      'create-project': () => {
        const name = $('#new-name').value;
        if (!name.trim()) return toast('Project name is required');
        const project = store.createProject({ name: name.trim() });
        openProject(project.id, 'setup');
      },
      'delete-project': async () => {
        const id = btn.dataset.id;
        if (!window.confirm(`Delete project "${id}" and all its generated media from this browser? This cannot be undone.`)) return;
        store.deleteProjectRecord(id);
        await db.deleteProjectBlobs(id);
        state.projects = store.listProjects();
        render();
      },
      'save-settings': () => {
        state.project = store.updateProject(pid, (p) => Object.assign(p.settings, {
          creativeDirection: $('#set-creative').value,
          brandAccent: $('#set-accent').value,
          backgroundNote: $('#set-bg').value,
          aspectRatio: $('#set-ar').value,
          continuityChaining: $('#set-chain').checked,
          sound: $('#set-sound').checked,
        }));
        toast('Settings saved.');
      },
      'upload-ref': () => {
        // Read inputs BEFORE withBusy — its re-render rebuilds the form and
        // would wipe the file selection.
        const role = btn.dataset.role;
        const file = (role === 'character' ? $('#char-file') : $('#prod-file'))?.files[0];
        if (!file) return toast('Choose an image file first');
        return withBusy('Uploading reference', async () => {
          const asset = await fileToRef(file, role);
          state.project = store.updateProject(pid, (p) => {
            if (role === 'character') p.references.character = asset;
            else p.references.product.push(asset);
          });
        });
      },
      'del-ref': () => {
        state.project = store.updateProject(pid, (p) => {
          if (btn.dataset.role === 'character') p.references.character = null;
          else if (btn.dataset.role === 'style') p.references.style = null;
          else p.references.product.splice(Number(btn.dataset.index ?? 0), 1);
        });
        render();
      },
      'upload-style': () => {
        const file = $('#style-file')?.files[0];
        if (!file) return toast('Choose an image file first');
        return withBusy('Saving style image', async () => {
          const blob = await normalizeStyleImage(file);
          const blobPath = 'references/style.jpg';
          await db.putBlob(`${pid}:${blobPath}`, blob);
          db.invalidateUrl(`${pid}:${blobPath}`);
          state.project = store.updateProject(pid, (p) => {
            p.references.style = { path: blobPath, addedAt: new Date().toISOString() };
          });
        });
      },
      'gen-character': () => {
        const prompt = $('#char-prompt').value.trim(); // read before withBusy re-renders
        if (!prompt) return toast('A character prompt is required');
        return withBusy('Generating character (Nano Banana Pro, ~30s)', async () => {
          const { url, path } = await pipeline.generateCharacterImage(pid, prompt);
          state.project = store.updateProject(pid, (p) => {
            p.references.character = { path, url, uploadedAt: new Date().toISOString() };
          });
        });
      },
      'gen-storyboard': () => {
        // Capture the textarea BEFORE withBusy re-renders (the re-render rebuilds
        // the form from saved state, wiping unsaved text), and persist the script
        // immediately so it survives any later re-render.
        const script = $('#script').value.trim();
        const note = $('#sb-note').value;
        if (!script) return toast('Paste a script first');
        const project = store.updateProject(pid, (p) => { p.script = script; });
        state.project = project;
        return withBusy('Generating storyboard with Claude (this can take a minute or two)', async () => {
          const styleImage = await loadStyleImage();
          const result = await anthropic.generateStoryboard(project, script, note, styleImage);
          state.project = store.updateProject(pid, (p) => {
            p.storyboardMeta = {
              style_block: result.style_block,
              character_block: result.character_block,
              product_block: result.product_block,
            };
            p.scenes = result.scenes.sort((a, b) => a.order - b.order).map((raw, i) => store.newScene(raw, i));
            p.storyboardStatus = 'draft';
          });
        });
      },
      'approve-storyboard': () => {
        state.project = store.updateProject(pid, (p) => {
          if (!p.scenes.length) throw new Error('No storyboard to approve');
          p.storyboardStatus = 'approved';
        });
        render();
      },
      'save-scene': () => {
        applySceneEdits(sceneId, sceneEdits(btn.closest('[data-scene-panel]')));
        render();
        toast('Scene saved.');
      },
      'regen-scene': () => {
        const note = window.prompt('Optional note for regenerating this scene (leave blank for none):', '');
        if (note === null) return;
        return withBusy(`Regenerating scene ${sceneId}`, async () => {
          const project = store.loadProject(pid);
          const scene = project.scenes.find((s) => s.id === sceneId);
          const styleImage = await loadStyleImage();
          const raw = await anthropic.regenerateScene(project, scene, note, styleImage);
          state.project = store.updateProject(pid, (p) => {
            const idx = p.scenes.findIndex((s) => s.id === sceneId);
            const fresh = store.newScene(raw, idx);
            fresh.id = sceneId;
            fresh.order = p.scenes[idx].order;
            p.scenes[idx] = fresh;
          });
        });
      },
      'gen-frames': () => {
        try {
          const n = pipeline.generateAllFrames(pid);
          toast(`Submitted ${n} frame generation${n === 1 ? '' : 's'}.`);
          refresh(); render();
        } catch (err) { toast(String(err.message || err)); }
      },
      'approve-all-frames': () => {
        state.project = store.updateProject(pid, (p) => {
          for (const scene of p.scenes) {
            if (scene.status.start_frame === 'review') scene.status.start_frame = 'approved';
            if (scene.status.end_frame === 'review') scene.status.end_frame = 'approved';
          }
        });
        render();
      },
      'approve-frame': () => {
        state.project = store.updateProject(pid, (p) => {
          const scene = p.scenes.find((s) => s.id === sceneId);
          if (!scene?.assets[`${btn.dataset.which}_frame_path`]) throw new Error('Nothing to approve yet');
          scene.status[`${btn.dataset.which}_frame`] = 'approved';
        });
        render();
      },
      'regen-frame': () => {
        pipeline.generateFrame(pid, sceneId, btn.dataset.which);
        refresh(); render();
      },
      'gen-videos': () => {
        try {
          const n = pipeline.generateAllVideos(pid);
          toast(`Submitted ${n} video generation${n === 1 ? '' : 's'}.`);
          refresh(); render();
        } catch (err) { toast(String(err.message || err)); }
      },
      'approve-all-videos': () => {
        state.project = store.updateProject(pid, (p) => {
          for (const scene of p.scenes) {
            if (scene.status.video === 'review') scene.status.video = 'approved';
          }
        });
        render();
      },
      'approve-video': () => {
        state.project = store.updateProject(pid, (p) => {
          const scene = p.scenes.find((s) => s.id === sceneId);
          if (!scene?.assets.video_path) throw new Error('Nothing to approve yet');
          scene.status.video = 'approved';
        });
        render();
      },
      'regen-video': () => {
        pipeline.generateVideo(pid, sceneId);
        refresh(); render();
      },
      'edit-prompt': () => {
        const field = btn.dataset.field;
        const scene = state.project.scenes.find((s) => s.id === sceneId);
        const current = scene[field] || '';
        const next = window.prompt(`Edit ${field.replace(/_/g, ' ')} for scene ${scene.order}:`, current);
        if (next === null || next === current) return;
        applySceneEdits(sceneId, { [field]: next });
        render();
      },
      'export-zip': () => withBusy('Building zip', async () => {
        const p = store.loadProject(pid);
        const approved = p.scenes.filter((s) => s.status.video === 'approved' && s.assets.video_path);
        if (!approved.length) throw new Error('No approved clips to export');
        const entries = [];
        for (const s of approved) {
          const blob = await db.getBlob(`${pid}:${s.assets.video_path}`);
          if (!blob) throw new Error(`Clip for ${s.id} is missing from this browser's cache`);
          entries.push({ name: `${String(s.order).padStart(2, '0')}-${s.id}.mp4`, blob });
        }
        const zip = await buildZip(entries);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zip);
        a.download = `${pid}-clips.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }),
    };

    const handler = actions[act];
    if (handler) {
      try { await handler(); } catch (err) { toast(String(err.message || err)); }
    }
  });
}

// --- boot ---
bindEvents($('#app'));
state.projects = store.listProjects();
render();
window.__appBooted = true;
