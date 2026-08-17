/* Generator app (static / GitHub Pages build).
   The operator writes all prompts by hand and pastes them in. The app manages a
   labeled reference library, attaches references to Nano Banana Pro by file
   number, generates scene images and Kling videos, and handles approve /
   regenerate / download. Everything runs in the browser with your kie.ai key. */

import * as store from './store.js';
import * as db from './db.js';
import * as pipeline from './pipeline.js';
import { parseScenes, parseMotion } from './parse.js';
import { uploadBlob } from './kie.js';
import { buildZip } from './zip.js';

const state = { view: 'home', projects: [], project: null, tab: 'library', busy: null };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Math.random().toString(16).slice(2, 8);

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

async function withBusy(label, fn) {
  state.busy = label;
  render();
  try { await fn(); } catch (err) { toast(String(err.message || err)); } finally { state.busy = null; render(); }
}

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
const reload = () => { if (state.project) state.project = store.loadProject(state.project.id); };
const anyGenerating = (p) =>
  p?.references?.some((r) => r.status === 'generating') ||
  p?.scenes?.some((s) => s.image.status === 'generating' || s.video.status === 'generating');

// --- rendering ---

function render() {
  $('#app').innerHTML = state.view === 'home' ? renderHome() : renderProject();
  hydrateBlobs();
  window.__appBooted = true;
}
function hydrateBlobs() {
  document.querySelectorAll('[data-blob]').forEach(async (el) => {
    const url = await db.objectUrl(el.dataset.blob);
    if (url && el.isConnected) el.src = url;
  });
}
const blobAttr = (path) => `data-blob="${esc(`${state.project.id}:${path}`)}"`;

function badge(status) {
  const cls = status === 'approved' ? 'approved' : status === 'review' ? 'review' : status === 'failed' ? 'failed' : status === 'generating' ? 'generating' : 'pending';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

function renderHome() {
  const keys = store.getKeys();
  return `
    <div class="row">
      <h1 style="margin:0">Ad Generator</h1>
      <span class="spacer"></span>
      <a href="banana.html"><button class="secondary">🍌 Quick batch generator →</button></a>
    </div>
    <div class="panel keybox">
      <h3>kie.ai API key</h3>
      <label>Needed for all image and video generation. Stored only in this browser, sent only to kie.ai.</label>
      <input id="key-kie" type="password" value="${esc(keys.kie || '')}" placeholder="kie.ai key" autocomplete="off" />
      <div style="margin-top:10px"><button data-act="save-keys">Save key</button></div>
      <div class="notice">Projects and generated media live in this browser (localStorage + IndexedDB). Use the same browser and profile to come back to a project.</div>
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
          <span class="muted">${p.refCount} refs · ${p.sceneCount} scenes</span>
          <span class="spacer"></span>
          <span class="muted">${new Date(p.createdAt).toLocaleString()}</span>
          <button class="danger small" data-act="delete-project" data-id="${esc(p.id)}">Delete</button>
        </div>`).join('') : '<div class="muted">No projects yet.</div>'}
    </div>`;
}

function stageDot(ok) { return `<span class="dot" style="background:${ok ? 'var(--green)' : 'var(--border)'}"></span>`; }

function renderProject() {
  const p = state.project;
  const libReady = p.references.length > 0 && p.references.every((r) => r.status === 'approved');
  const imagesReady = p.scenes.length > 0 && p.scenes.every((s) => s.image.status === 'approved');
  const videosDone = p.scenes.length > 0 && p.scenes.every((s) => s.video.status === 'approved');
  const tabs = [
    ['library', `Library${stageDot(p.references.length > 0 && libReady)}`],
    ['scenes', `Scenes${stageDot(imagesReady)}`],
    ['videos', `Videos${stageDot(videosDone)}`],
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
    ${{ library: renderLibrary, scenes: renderScenes, videos: renderVideos, export: renderExport }[state.tab]()}
  `;
}

// --- reference option list for the mapping / last-frame dropdowns ---

function refOptions(current, { scenes = false, excludeSceneId = null, onlyApprovedScenes = false } = {}) {
  const p = state.project;
  const opt = (val, label, sel) => `<option value="${esc(val)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  let html = opt('', '— none —', !current);
  html += p.references.map((r) => opt(r.id, `${r.label} (${r.kind})`, current === r.id)).join('');
  if (scenes) {
    for (const s of p.scenes) {
      if (s.id === excludeSceneId) continue;
      if (onlyApprovedScenes && s.image.status !== 'approved') continue;
      html += opt(`scene:${s.id}`, `${s.id} frame`, current === `scene:${s.id}`);
    }
  }
  return html;
}

// --- Library tab ---

function renderLibrary() {
  const p = state.project;
  const gen = p.references.filter((r) => r.kind === 'character' && r.source === 'generated');
  const pendingGen = gen.some((r) => ['pending', 'failed'].includes(r.status));
  return `
    <div class="panel">
      <h3>Reference library</h3>
      <p class="muted">Every entry is a labeled image with a hosted URL. Scene prompts reference these by file number (file 1, file 2, …). Products and finished characters are uploaded; characters can also be generated from a prompt.</p>
    </div>

    <div class="panel">
      <h3>Upload a reference</h3>
      <div class="row">
        <input id="up-label" placeholder="Label (e.g. gum piece, GLP)" style="max-width:220px" />
        <select id="up-kind"><option value="product">product</option><option value="character">character</option></select>
        <input type="file" id="up-file" accept="image/*" style="max-width:240px" />
        <button class="secondary" data-act="upload-ref">Upload</button>
      </div>
    </div>

    <div class="panel">
      <h3>Generate a character</h3>
      <label>Paste one character prompt (a Nano Banana prompt that creates a single character) and give it a label. Add several, then generate them all.</label>
      <div class="row">
        <input id="ch-label" placeholder="Label (e.g. Tooth)" style="max-width:220px" />
      </div>
      <textarea id="ch-prompt" placeholder="Character prompt…"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="secondary" data-act="add-character">Add character</button>
        <button data-act="gen-characters" ${pendingGen ? '' : 'disabled'}>Generate all characters</button>
        ${anyGenerating(p) ? '<span class="busy">⏳ generating — keep this tab open</span>' : ''}
      </div>
    </div>

    ${p.references.length ? `<div class="grid">${p.references.map(renderRefCard).join('')}</div>` : '<div class="panel muted">No references yet.</div>'}
  `;
}

function renderRefCard(r) {
  const p = state.project;
  const attachable = p.references.filter((x) => x.id !== r.id && x.status === 'approved');
  return `
    <div class="card">
      <div class="scene-head"><span class="title">${esc(r.label || '(unlabeled)')}</span><span class="muted">${esc(r.kind)}</span>${badge(r.status)}<span class="spacer"></span>
        <button class="danger small" data-act="del-ref" data-id="${esc(r.id)}">Remove</button>
      </div>
      ${r.path ? `<img ${blobAttr(r.path)} style="aspect-ratio:auto"/>` : '<div class="muted" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--panel2);border-radius:8px">no image yet</div>'}
      ${r.source === 'generated' ? `
        <details class="raw" ${r.status === 'pending' ? 'open' : ''}><summary>Prompt${attachable.length ? ' & attached references' : ''}</summary>
          <textarea data-ref-prompt="${esc(r.id)}">${esc(r.prompt)}</textarea>
          ${attachable.length ? `<label>Attach references (image_input for this character)</label>
            <div class="row" style="flex-wrap:wrap">${attachable.map((a) => `<label style="margin:0"><input type="checkbox" data-char-attach="${esc(r.id)}" value="${esc(a.id)}" ${(r.charRefIds || []).includes(a.id) ? 'checked' : ''} style="width:auto"/> ${esc(a.label)}</label>`).join('')}</div>` : ''}
        </details>
        <div class="row" style="margin-top:6px">
          ${r.status === 'review' ? `<button class="success small" data-act="approve-ref" data-id="${esc(r.id)}">Approve</button>` : ''}
          <button class="secondary small" data-act="regen-ref" data-id="${esc(r.id)}" ${r.status === 'generating' ? 'disabled' : ''}>${r.path ? 'Regenerate' : 'Generate'}</button>
        </div>` : ''}
      ${r.error ? `<div class="err">${esc(r.error)}</div>` : ''}
    </div>`;
}

// --- Scenes tab ---

function renderScenes() {
  const p = state.project;
  const reviewable = p.scenes.some((s) => s.image.status === 'review');
  const toGenerate = p.scenes.some((s) => ['pending', 'failed'].includes(s.image.status));
  return `
    <div class="panel">
      <h3>Scene prompts</h3>
      <label>Paste all scene prompts (P1 through the last). Each begins with a header like <code>**P1 — Title** *(Speaker: "line")*</code>.</label>
      <textarea id="scenes-raw" rows="8" placeholder="**P1 — …** *(…)*&#10;…prompt body…&#10;&#10;**P2 — …**&#10;…">${esc(p.scenesRaw)}</textarea>
      <div class="row" style="margin-top:8px">
        <button data-act="parse-scenes">Parse into scenes</button>
        <span class="muted">${p.scenes.length} scene${p.scenes.length === 1 ? '' : 's'} parsed</span>
      </div>
    </div>

    ${p.scenes.length ? `
    <div class="panel row">
      <button data-act="gen-images" ${toGenerate ? '' : 'disabled'}>Generate all images</button>
      <button class="success" data-act="approve-all-images" ${reviewable ? '' : 'disabled'}>Approve all in review</button>
      ${anyGenerating(p) ? '<span class="busy">⏳ generating — keep this tab open</span>' : ''}
    </div>
    <div class="grid">${p.scenes.map(renderSceneCard).join('')}</div>` : ''}
  `;
}

function renderSceneCard(s) {
  return `
    <div class="card" data-scene-panel="${esc(s.id)}">
      <div class="scene-head"><span class="title">${esc(s.id)}${s.title ? ' · ' + esc(s.title) : ''}</span>${badge(s.image.status)}<span class="spacer"></span></div>
      ${s.dialogue ? `<div class="muted">${esc(s.speaker ? s.speaker + ': ' : '')}"${esc(s.dialogue)}"</div>` : ''}
      ${s.image.path ? `<img ${blobAttr(s.image.path)} style="aspect-ratio:auto;margin-top:8px"/>` : '<div class="muted" style="aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;background:var(--panel2);border-radius:8px;margin-top:8px">no image yet</div>'}
      <div class="row" style="margin-top:6px">
        ${s.image.status === 'review' ? `<button class="success small" data-act="approve-image" data-id="${esc(s.id)}">Approve</button>` : ''}
        <button class="secondary small" data-act="regen-image" data-id="${esc(s.id)}" ${s.image.status === 'generating' ? 'disabled' : ''}>${s.image.path ? 'Regenerate' : 'Generate'}</button>
      </div>
      ${s.image.error ? `<div class="err">${esc(s.image.error)}</div>` : ''}
      <label>Reference mapping</label>
      ${s.fileMap.length ? s.fileMap.sort((a, b) => a.file - b.file).map((slot) => `
        <div class="row" style="margin:2px 0">
          <span class="muted" style="width:52px">file ${slot.file}</span>
          <select data-map-scene="${esc(s.id)}" data-file="${slot.file}" style="flex:1">${refOptions(slot.refId, { scenes: true, excludeSceneId: s.id, onlyApprovedScenes: true })}</select>
        </div>`).join('') : '<div class="muted">No "file N" references in this prompt.</div>'}
      <div class="row" style="margin-top:4px"><button class="secondary small" data-act="add-slot" data-id="${esc(s.id)}">+ file slot</button></div>
      <details class="raw"><summary>Prompt body</summary><textarea data-scene-prompt="${esc(s.id)}" rows="6">${esc(s.prompt_body)}</textarea></details>
    </div>`;
}

// --- Videos tab ---

function renderVideos() {
  const p = state.project;
  const imagesReady = p.scenes.length > 0 && p.scenes.every((s) => s.image.status === 'approved');
  if (!imagesReady) {
    const waiting = p.scenes.filter((s) => s.image.status !== 'approved').map((s) => s.id);
    return `<div class="panel muted">Videos unlock once every scene image is approved.${p.scenes.length ? ` Waiting on: ${waiting.join(', ') || '—'}` : ' Parse and generate scene images first.'}</div>`;
  }
  const reviewable = p.scenes.some((s) => s.video.status === 'review');
  const toGenerate = p.scenes.some((s) => ['pending', 'failed'].includes(s.video.status) && s.video.motion_prompt.trim());
  const missing = p.scenes.filter((s) => !s.video.motion_prompt.trim()).map((s) => s.id);
  return `
    <div class="panel">
      <h3>Motion prompts</h3>
      <label>Paste all motion prompts, one per scene, using the same P1, P2 numbering. Each is matched to its scene by id.</label>
      <textarea id="motion-raw" rows="7" placeholder="**P1**&#10;…motion prompt (carry the dialogue line for lip-sync)…&#10;&#10;**P2**&#10;…">${esc(p.motionRaw)}</textarea>
      <div class="row" style="margin-top:8px">
        <button data-act="parse-motion">Parse & match to scenes</button>
        ${missing.length ? `<span class="err">Missing motion for: ${missing.join(', ')}</span>` : '<span class="muted">every scene has a motion prompt</span>'}
      </div>
    </div>
    <div class="panel row">
      <div><label style="margin:0 8px 0 0;display:inline">Default duration (s)</label><input id="set-dur" type="number" min="3" max="15" value="${esc(p.settings.defaultDuration)}" style="width:70px;display:inline-block"/></div>
      <label style="margin:0"><input type="checkbox" id="set-sound" ${p.settings.sound ? 'checked' : ''} style="width:auto"/> Kling sound on (off by default — add VO in the editor)</label>
      <span class="spacer"></span>
      <button data-act="gen-videos" ${toGenerate ? '' : 'disabled'}>Generate all videos</button>
      <button class="success" data-act="approve-all-videos" ${reviewable ? '' : 'disabled'}>Approve all in review</button>
      ${anyGenerating(p) ? '<span class="busy">⏳ video tasks take several minutes each</span>' : ''}
    </div>
    <div class="grid">${p.scenes.map(renderVideoCard).join('')}</div>
  `;
}

function renderVideoCard(s) {
  return `
    <div class="card" data-scene-panel="${esc(s.id)}">
      <div class="scene-head"><span class="title">${esc(s.id)}${s.title ? ' · ' + esc(s.title) : ''}</span>${badge(s.video.status)}<span class="spacer"></span></div>
      ${s.video.path ? `<video controls ${blobAttr(s.video.path)}></video>` : `<img ${blobAttr(s.image.path)} style="aspect-ratio:auto;opacity:.5"/>`}
      <div class="row" style="margin-top:6px">
        ${s.video.status === 'review' ? `<button class="success small" data-act="approve-video" data-id="${esc(s.id)}">Approve</button>` : ''}
        <button class="secondary small" data-act="regen-video" data-id="${esc(s.id)}" ${s.video.status === 'generating' ? 'disabled' : ''}>${s.video.path ? 'Regenerate' : 'Generate'}</button>
      </div>
      ${s.video.error ? `<div class="err">${esc(s.video.error)}</div>` : ''}
      <div class="row" style="margin-top:6px">
        <span class="muted" style="width:52px">length</span>
        <input data-vid-dur="${esc(s.id)}" type="number" min="3" max="15" placeholder="${esc(s.video.duration_s ?? state.project.settings.defaultDuration)}" value="${s.video.duration_s ?? ''}" style="width:70px"/>
        <span class="muted">last frame</span>
        <select data-vid-last="${esc(s.id)}" style="flex:1">${refOptions(s.video.lastFrameRefId, { scenes: true, excludeSceneId: s.id, onlyApprovedScenes: true })}</select>
      </div>
      <details class="raw"><summary>Motion prompt${s.dialogue ? ' · "' + esc(s.dialogue) + '"' : ''}</summary><textarea data-motion-prompt="${esc(s.id)}" rows="4" placeholder="paste or edit this scene's motion prompt">${esc(s.video.motion_prompt)}</textarea></details>
    </div>`;
}

// --- Export tab ---

function renderExport() {
  const p = state.project;
  const vids = p.scenes.filter((s) => s.video.status === 'approved' && s.video.path);
  const imgs = p.scenes.filter((s) => s.image.status === 'approved' && s.image.path);
  return `
    <div class="panel">
      <h3>Export</h3>
      <p class="muted">${vids.length} of ${p.scenes.length} clips approved. Zips are named by scene order so they drop into an editor in sequence.</p>
      <div class="row">
        <button data-act="export-videos" ${vids.length ? '' : 'disabled'}>Download all approved clips (.zip)</button>
        <button class="secondary" data-act="export-images" ${imgs.length ? '' : 'disabled'}>Download all approved images (.zip)</button>
      </div>
    </div>
    <div class="grid">
      ${vids.map((s) => `<div class="card"><div class="scene-head"><span class="title">${esc(orderName(s))}.mp4</span></div><video controls ${blobAttr(s.video.path)}></video></div>`).join('')}
    </div>`;
}
const orderName = (s) => `${String(state.project.scenes.indexOf(s) + 1).padStart(2, '0')}-${s.id}`;

// --- uploads ---

async function normalizeImage(file, max = 2048) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale); const h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return (await new Promise((r) => c.toBlob(r, 'image/png'))) || file;
  } catch { return file; }
}

// --- events ---

function persistField(e) {
  const p = state.project; if (!p) return;
  const t = e.target;
  const set = (mutate) => { state.project = store.updateProject(p.id, mutate); };
  if (t.id === 'scenes-raw') set((x) => { x.scenesRaw = t.value; });
  else if (t.id === 'motion-raw') set((x) => { x.motionRaw = t.value; });
  else if (t.id === 'set-dur') set((x) => { x.settings.defaultDuration = Number(t.value) || 4; });
  else if (t.id === 'set-sound') set((x) => { x.settings.sound = t.checked; });
  else if (t.dataset.refPrompt) set((x) => { const r = x.references.find((r) => r.id === t.dataset.refPrompt); if (r) r.prompt = t.value; });
  else if (t.dataset.charAttach) set((x) => {
    const r = x.references.find((r) => r.id === t.dataset.charAttach); if (!r) return;
    const setIds = new Set(r.charRefIds || []);
    if (t.checked) setIds.add(t.value); else setIds.delete(t.value);
    r.charRefIds = [...setIds];
  });
  else if (t.dataset.scenePrompt) set((x) => { const s = x.scenes.find((s) => s.id === t.dataset.scenePrompt); if (s) s.prompt_body = t.value; });
  else if (t.dataset.mapScene) set((x) => {
    const s = x.scenes.find((s) => s.id === t.dataset.mapScene); if (!s) return;
    const file = Number(t.dataset.file);
    const slot = s.fileMap.find((m) => m.file === file);
    if (slot) slot.refId = t.value || null;
  });
  else if (t.dataset.motionPrompt) set((x) => { const s = x.scenes.find((s) => s.id === t.dataset.motionPrompt); if (s) s.video.motion_prompt = t.value; });
  else if (t.dataset.vidDur) set((x) => { const s = x.scenes.find((s) => s.id === t.dataset.vidDur); if (s) s.video.duration_s = t.value ? Number(t.value) : null; });
  else if (t.dataset.vidLast) set((x) => { const s = x.scenes.find((s) => s.id === t.dataset.vidLast); if (s) s.video.lastFrameRefId = t.value || null; });
}

function bindEvents(app) {
  app.addEventListener('change', persistField);

  app.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const pid = state.project?.id;
    const id = btn.dataset.id;

    const actions = {
      'home': () => { state.projects = store.listProjects(); state.view = 'home'; state.project = null; render(); },
      'open': () => openProject(btn.dataset.id, 'library'),
      'tab': () => { state.tab = btn.dataset.tab; render(); },
      'save-keys': () => { store.setKeys({ ...store.getKeys(), kie: $('#key-kie').value.trim() }); toast('Key saved.'); },
      'create-project': () => {
        const name = $('#new-name').value;
        if (!name.trim()) return toast('Project name is required');
        openProject(store.createProject({ name: name.trim() }).id, 'library');
      },
      'delete-project': async () => {
        const did = btn.dataset.id;
        if (!window.confirm(`Delete project "${did}" and all its media from this browser?`)) return;
        store.deleteProjectRecord(did);
        await db.deleteProjectBlobs(did);
        state.projects = store.listProjects();
        render();
      },

      // library
      'upload-ref': () => {
        const label = $('#up-label').value.trim();
        const kind = $('#up-kind').value;
        const file = $('#up-file')?.files[0];
        if (!label) return toast('Give the reference a label');
        if (!file) return toast('Choose an image file');
        return withBusy('Uploading reference', async () => {
          const blob = await normalizeImage(file);
          const path = `references/ref-${rid()}.png`;
          await db.putBlob(`${pid}:${path}`, blob);
          db.invalidateUrl(`${pid}:${path}`);
          const url = await uploadBlob(blob, path.split('/').pop(), `video-gen/${pid}`);
          const ref = store.newReference({ label, kind, source: 'upload' });
          ref.path = path; ref.url = url; ref.uploadedAt = new Date().toISOString();
          state.project = store.updateProject(pid, (p) => p.references.push(ref));
        });
      },
      'add-character': () => {
        const label = $('#ch-label').value.trim();
        const prompt = $('#ch-prompt').value.trim();
        if (!label) return toast('Give the character a label');
        if (!prompt) return toast('Paste the character prompt');
        state.project = store.updateProject(pid, (p) => p.references.push(store.newReference({ label, kind: 'character', source: 'generated', prompt })));
        render();
      },
      'gen-characters': () => { const n = pipeline.generateAllReferences(pid); toast(`Submitted ${n} character generation${n === 1 ? '' : 's'}.`); reload(); render(); },
      'regen-ref': () => { pipeline.generateReference(pid, id); reload(); render(); },
      'approve-ref': () => {
        state.project = store.updateProject(pid, (p) => { const r = p.references.find((r) => r.id === id); if (r?.path) r.status = 'approved'; });
        render();
      },
      'del-ref': async () => {
        const ref = state.project.references.find((r) => r.id === id);
        state.project = store.updateProject(pid, (p) => { p.references = p.references.filter((r) => r.id !== id); });
        if (ref?.path) { await db.deleteBlob(`${pid}:${ref.path}`); db.invalidateUrl(`${pid}:${ref.path}`); }
        render();
      },

      // scenes
      'parse-scenes': () => {
        const raw = $('#scenes-raw') ? $('#scenes-raw').value : state.project.scenesRaw;
        const parsed = parseScenes(raw, state.project.references);
        if (!parsed.length) return toast('No prompts found — check the **P1 …** headers.');
        state.project = store.updateProject(pid, (p) => { p.scenesRaw = raw; p.scenes = store.mergeScenes(p.scenes, parsed); });
        toast(`Parsed ${parsed.length} scene${parsed.length === 1 ? '' : 's'}.`);
        render();
      },
      'add-slot': () => {
        state.project = store.updateProject(pid, (p) => {
          const s = p.scenes.find((s) => s.id === id); if (!s) return;
          const next = (s.fileMap.reduce((m, x) => Math.max(m, x.file), 0)) + 1;
          s.fileMap.push({ file: next, refId: null });
        });
        render();
      },
      'gen-images': () => { const n = pipeline.generateAllSceneImages(pid); toast(`Submitted ${n} image generation${n === 1 ? '' : 's'}.`); reload(); render(); },
      'regen-image': () => { pipeline.generateSceneImage(pid, id); reload(); render(); },
      'approve-image': () => { state.project = store.updateProject(pid, (p) => { const s = p.scenes.find((s) => s.id === id); if (s?.image.path) s.image.status = 'approved'; }); render(); },
      'approve-all-images': () => { state.project = store.updateProject(pid, (p) => { for (const s of p.scenes) if (s.image.status === 'review') s.image.status = 'approved'; }); render(); },

      // videos
      'parse-motion': () => {
        const raw = $('#motion-raw') ? $('#motion-raw').value : state.project.motionRaw;
        const motions = parseMotion(raw);
        if (!motions.length) return toast('No motion prompts found — check the **P1 …** headers.');
        const byId = new Map(motions.map((m) => [m.id, m]));
        let matched = 0; const unmatched = [];
        state.project = store.updateProject(pid, (p) => {
          p.motionRaw = raw;
          for (const s of p.scenes) { const m = byId.get(s.id); if (m) { s.video.motion_prompt = m.motion; matched++; } }
          for (const m of motions) if (!p.scenes.some((s) => s.id === m.id)) unmatched.push(m.id);
        });
        toast(`Matched ${matched} motion prompt${matched === 1 ? '' : 's'}.${unmatched.length ? ' No scene for: ' + unmatched.join(', ') : ''}`);
        render();
      },
      'gen-videos': () => {
        try { const n = pipeline.generateAllVideos(pid); toast(`Submitted ${n} video generation${n === 1 ? '' : 's'}.`); reload(); render(); }
        catch (err) { toast(String(err.message || err)); }
      },
      'regen-video': () => { pipeline.generateVideo(pid, id); reload(); render(); },
      'approve-video': () => { state.project = store.updateProject(pid, (p) => { const s = p.scenes.find((s) => s.id === id); if (s?.video.path) s.video.status = 'approved'; }); render(); },
      'approve-all-videos': () => { state.project = store.updateProject(pid, (p) => { for (const s of p.scenes) if (s.video.status === 'review') s.video.status = 'approved'; }); render(); },

      // export
      'export-videos': () => exportZip('video', `${pid}-clips.zip`),
      'export-images': () => exportZip('image', `${pid}-images.zip`),
    };

    const handler = actions[act];
    if (handler) { try { await handler(); } catch (err) { toast(String(err.message || err)); } }
  });
}

async function exportZip(kind, filename) {
  const p = store.loadProject(state.project.id);
  const done = p.scenes.filter((s) => (kind === 'video' ? s.video : s.image).status === 'approved' && (kind === 'video' ? s.video : s.image).path);
  if (!done.length) return toast('Nothing approved to export');
  const ext = kind === 'video' ? 'mp4' : 'png';
  const entries = [];
  for (const s of done) {
    const asset = kind === 'video' ? s.video : s.image;
    const blob = await db.getBlob(`${p.id}:${asset.path}`);
    if (blob) entries.push({ name: `${String(p.scenes.indexOf(s) + 1).padStart(2, '0')}-${s.id}.${ext}`, blob });
  }
  const zip = await buildZip(entries);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// --- boot ---
bindEvents($('#app'));
state.projects = store.listProjects();
render();
