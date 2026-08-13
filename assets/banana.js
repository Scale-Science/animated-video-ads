/* Batch Nano Banana image generator — a standalone page.
   Paste one or more Nano Banana Pro prompts (separate them with a line of ---),
   generate them all at once, and regenerate any single one. Uses the same
   kie.ai key, IndexedDB blob store, and upload client as the pipeline app.
   Everything lives in this browser. */

import { getKeys, setKeys } from './store.js';
import { putBlob, getBlob, deleteBlob, objectUrl, invalidateUrl } from './db.js';
import { createTask, pollTask, uploadBlob, fetchAsset, UPLOAD_TTL_MS } from './kie.js';
import { buildZip } from './zip.js';

const BATCH_KEY = 'aap:banana';
const MAX_CONCURRENCY = 5;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Math.random().toString(16).slice(2, 8);

function blankBatch() {
  return { settings: { aspectRatio: '9:16', resolution: '2K' }, references: [], items: [], promptsText: '' };
}
function loadBatch() {
  try { return JSON.parse(localStorage.getItem(BATCH_KEY)) || blankBatch(); } catch { return blankBatch(); }
}

const state = { batch: loadBatch(), busy: null };
const save = () => localStorage.setItem(BATCH_KEY, JSON.stringify(state.batch));

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

// --- prompt parsing ---
// Prompts are separated by a line containing only dashes (---). This survives
// the blank lines that appear *within* a single skill-style prompt.
function parsePrompts(text) {
  return text.split(/^\s*-{3,}\s*$/m).map((s) => s.trim()).filter(Boolean);
}

// Rebuild the item list from the textarea, preserving an already-generated
// image when the prompt at that position is unchanged (so re-running doesn't
// re-spend on prompts that already have a result).
function syncItems() {
  const prompts = parsePrompts(state.batch.promptsText);
  const old = state.batch.items;
  state.batch.items = prompts.map((p, i) => {
    const prev = old[i];
    if (prev && prev.prompt === p && prev.status === 'done' && prev.imagePath) return prev;
    return { id: rid(), prompt: p, status: 'pending', error: null, taskId: null, imagePath: null };
  });
  save();
}

// --- reference images (optional, shared across every prompt as file 1, 2, …) ---

async function freshRefUrl(ref) {
  if (ref.url && ref.uploadedAt && Date.now() - Date.parse(ref.uploadedAt) < UPLOAD_TTL_MS) return ref.url;
  const blob = await getBlob(`banana:${ref.path}`);
  if (!blob) throw new Error(`reference image "${ref.path}" is missing from this browser`);
  const url = await uploadBlob(blob, ref.path.split('/').pop(), 'video-gen/banana');
  ref.url = url;
  ref.uploadedAt = new Date().toISOString();
  save();
  return url;
}

async function resolveRefUrls() {
  const urls = [];
  for (const ref of state.batch.references) urls.push(await freshRefUrl(ref));
  return urls.slice(0, 8); // Nano Banana Pro max
}

// --- generation ---

async function generateItem(item, refUrls) {
  item.status = 'generating';
  item.error = null;
  save();
  render();
  try {
    const image_input = refUrls ?? await resolveRefUrls();
    const taskId = await createTask('nano-banana-pro', {
      prompt: item.prompt,
      image_input,
      aspect_ratio: state.batch.settings.aspectRatio,
      resolution: state.batch.settings.resolution,
      output_format: 'png',
    });
    item.taskId = taskId;
    save();
    await attachTask(item, taskId);
  } catch (err) {
    item.status = 'failed';
    item.error = String(err.message || err);
    item.taskId = null;
    save();
    render();
  }
}

async function attachTask(item, taskId) {
  try {
    const [url] = await pollTask(taskId);
    const blob = await fetchAsset(url);
    const path = `${item.id}.png`;
    await putBlob(`banana:${path}`, blob);
    invalidateUrl(`banana:${path}`);
    item.imagePath = path;
    item.status = 'done';
    item.taskId = null;
    save();
    render();
  } catch (err) {
    item.status = 'failed';
    item.error = String(err.message || err);
    item.taskId = null;
    save();
    render();
  }
}

// Run a set of thunks with bounded concurrency (kie.ai rate-limit friendly).
async function runPool(thunks, concurrency = MAX_CONCURRENCY) {
  const queue = [...thunks];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);
}

async function generate(items) {
  if (!getKeys().kie) { toast('Set your kie.ai API key first.'); return; }
  // Resolve shared references once, up front, so a bad reference fails fast.
  let refUrls;
  try { refUrls = await resolveRefUrls(); } catch (err) { toast(String(err.message || err)); return; }
  await runPool(items.map((it) => () => generateItem(it, refUrls)));
}

// --- resume in-flight tasks after a reload ---

function resume() {
  let dirty = false;
  for (const item of state.batch.items) {
    if (item.status === 'generating') {
      if (item.taskId) attachTask(item, item.taskId);
      else { item.status = 'failed'; item.error = 'Interrupted (page was closed before the task started)'; dirty = true; }
    }
  }
  if (dirty) save();
}

// --- rendering ---

function render() {
  $('#app').innerHTML = renderPage();
  hydrateBlobs();
  window.__appBooted = true;
}

function hydrateBlobs() {
  document.querySelectorAll('[data-blob]').forEach(async (el) => {
    const url = await objectUrl(el.dataset.blob);
    if (url && el.isConnected) el.src = url;
  });
}

const anyGenerating = () => state.batch.items.some((i) => i.status === 'generating');

function badge(status) {
  return `<span class="badge ${status === 'done' ? 'approved' : status}">${esc(status)}</span>`;
}

function renderPage() {
  const b = state.batch;
  const keys = getKeys();
  const parsedCount = parsePrompts(b.promptsText).length;
  const doneCount = b.items.filter((i) => i.status === 'done').length;
  return `
    <div class="row">
      <a href="./">&larr; Pipeline</a>
      <h1 style="margin:0">Batch image generator</h1>
      <span class="spacer"></span>
      <span class="muted">Nano Banana Pro · kie.ai</span>
    </div>

    ${keys.kie ? '' : `
    <div class="panel keybox">
      <h3>kie.ai API key</h3>
      <label>Needed to generate images. Stored only in this browser, sent only to kie.ai.</label>
      <input id="key-kie" type="password" placeholder="kie.ai key" autocomplete="off" />
      <div style="margin-top:10px"><button data-act="save-key">Save key</button></div>
    </div>`}

    <div class="panel">
      <div class="row">
        <div><label>Aspect ratio</label>
          <select id="set-ar">${['9:16', '16:9', '1:1', '4:5', '3:4', '4:3'].map((r) => `<option ${b.settings.aspectRatio === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
        </div>
        <div><label>Resolution</label>
          <select id="set-res">${['1K', '2K', '4K'].map((r) => `<option ${b.settings.resolution === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
        </div>
        <div class="spacer"></div>
      </div>
      <label style="margin-top:14px">Shared reference images (optional) — attached to every prompt as file 1, file 2, … in this order. Use them for prompts that say "the character from file 1", "same product as file 2".</label>
      <div class="row">
        ${b.references.map((r, i) => `
          <div>
            <div class="thumb-label">file ${i + 1}</div>
            <img class="ref-img" ${blobAttr(r.path)} />
            <button class="danger small" style="margin-top:4px" data-act="del-ref" data-index="${i}">Remove</button>
          </div>`).join('')}
        <div>
          <div class="thumb-label">&nbsp;</div>
          <input type="file" id="ref-file" accept="image/*" style="max-width:220px" />
          <button class="secondary small" style="margin-top:4px" data-act="add-ref">Add reference</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <label>Paste your Nano Banana prompts. Separate each prompt with a line of three dashes:  <code>---</code></label>
      <textarea id="prompts" rows="10" placeholder="First prompt…&#10;&#10;---&#10;&#10;Second prompt…">${esc(b.promptsText)}</textarea>
      <div class="row" style="margin-top:10px">
        <button data-act="generate-all">Generate all${parsedCount ? ` (${parsedCount})` : ''}</button>
        <button class="secondary" data-act="regen-all" ${b.items.length ? '' : 'disabled'}>Regenerate all</button>
        <button class="success" data-act="download-all" ${doneCount ? '' : 'disabled'}>Download all (.zip)${doneCount ? ` · ${doneCount}` : ''}</button>
        ${anyGenerating() ? '<span class="busy">⏳ generating — keep this tab open; updates live</span>' : ''}
        <span class="spacer"></span>
        <span class="muted">${parsedCount} prompt${parsedCount === 1 ? '' : 's'} parsed</span>
      </div>
    </div>

    ${b.items.length ? `<div class="grid">${b.items.map(renderItem).join('')}</div>` : '<div class="panel muted">No images yet — paste prompts above and hit Generate all.</div>'}
  `;
}

function renderItem(item, idx) {
  const emptyThumb = '<div class="muted" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--panel2);border-radius:8px">no image yet</div>';
  return `
    <div class="card">
      <div class="scene-head"><span class="title">#${idx + 1}</span>${badge(item.status)}<span class="spacer"></span></div>
      ${item.imagePath ? `<img ${blobAttr(item.imagePath)} style="aspect-ratio:auto"/>` : emptyThumb}
      <div class="row" style="margin-top:6px">
        <button class="secondary small" data-act="regen" data-id="${item.id}" ${item.status === 'generating' ? 'disabled' : ''}>${item.imagePath ? 'Regenerate' : 'Generate'}</button>
        <button class="secondary small" data-act="edit" data-id="${item.id}">Edit prompt</button>
        ${item.imagePath ? `<button class="secondary small" data-act="download" data-id="${item.id}">Download</button>` : ''}
      </div>
      ${item.error ? `<div class="err">${esc(item.error)}</div>` : ''}
      <details class="raw"><summary>Prompt</summary><pre class="blocks">${esc(item.prompt)}</pre></details>
    </div>`;
}

const blobAttr = (path) => `data-blob="banana:${esc(path)}"`;

// --- reference upload (downscale + store + upload) ---

async function normalizeRef(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return blob || file;
  } catch { return file; }
}

// --- events ---

$('#app').addEventListener('change', (e) => {
  const b = state.batch;
  if (e.target.id === 'prompts') { b.promptsText = e.target.value; save(); render(); } // render → live "N prompts parsed"
  else if (e.target.id === 'set-ar') { b.settings.aspectRatio = e.target.value; save(); }
  else if (e.target.id === 'set-res') { b.settings.resolution = e.target.value; save(); }
});

$('#app').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const b = state.batch;
  const item = btn.dataset.id ? b.items.find((i) => i.id === btn.dataset.id) : null;

  const actions = {
    'save-key': () => {
      const kie = $('#key-kie').value.trim();
      if (!kie) return toast('Enter a key first');
      setKeys({ ...getKeys(), kie });
      render();
    },
    'add-ref': async () => {
      const file = $('#ref-file')?.files[0];
      if (!file) return toast('Choose an image file first');
      const blob = await normalizeRef(file);
      const path = `ref-${rid()}.png`;
      await putBlob(`banana:${path}`, blob);
      invalidateUrl(`banana:${path}`);
      b.references.push({ path });
      save();
      render();
    },
    'del-ref': async () => {
      const [ref] = b.references.splice(Number(btn.dataset.index), 1);
      if (ref) { await deleteBlob(`banana:${ref.path}`); invalidateUrl(`banana:${ref.path}`); }
      save();
      render();
    },
    'generate-all': async () => {
      // persist whatever's in the textarea, rebuild items, generate the pending ones
      const ta = $('#prompts'); if (ta) b.promptsText = ta.value;
      syncItems();
      if (!b.items.length) { render(); return toast('Paste at least one prompt.'); }
      render();
      await generate(b.items.filter((i) => i.status === 'pending' || i.status === 'failed'));
    },
    'regen-all': async () => {
      if (!window.confirm(`Regenerate all ${b.items.length} images? This re-spends on every prompt.`)) return;
      for (const it of b.items) it.status = 'pending';
      save();
      render();
      await generate(b.items);
    },
    'regen': async () => {
      if (!item) return;
      await generate([item]);
    },
    'edit': () => {
      if (!item) return;
      const next = window.prompt('Edit this prompt:', item.prompt);
      if (next === null || next.trim() === item.prompt) return;
      item.prompt = next.trim();
      // keep the textarea in sync so a later Generate all doesn't clobber this edit
      b.promptsText = b.items.map((i) => i.prompt).join('\n\n---\n\n');
      save();
      render();
    },
    'download': async () => {
      if (!item?.imagePath) return;
      const blob = await getBlob(`banana:${item.imagePath}`);
      if (!blob) return toast('Image is missing from this browser');
      triggerDownload(blob, `${String(b.items.indexOf(item) + 1).padStart(2, '0')}-${item.id}.png`);
    },
    'download-all': async () => {
      const done = b.items.filter((i) => i.status === 'done' && i.imagePath);
      if (!done.length) return;
      const entries = [];
      for (const it of done) {
        const blob = await getBlob(`banana:${it.imagePath}`);
        if (blob) entries.push({ name: `${String(b.items.indexOf(it) + 1).padStart(2, '0')}-${it.id}.png`, blob });
      }
      const zip = await buildZip(entries);
      triggerDownload(zip, 'nano-banana-images.zip');
    },
  };

  const handler = actions[act];
  if (handler) { try { await handler(); } catch (err) { toast(String(err.message || err)); } }
});

function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// --- boot ---
render();
resume();
