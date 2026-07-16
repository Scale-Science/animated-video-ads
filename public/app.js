/* Animated Ad Pipeline — stage-machine UI.
   Views: home (project list) -> project (Setup / Storyboard / Frames / Videos / Export).
   Polls the project while any generation task is in flight. */

const state = {
  view: 'home',
  projects: [],
  project: null,
  tab: 'setup',
  busy: null, // label shown while a blocking call runs
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

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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

// --- data loading ---

async function loadProjects() {
  state.projects = await api('GET', '/api/projects');
}

async function openProject(id, tab) {
  state.project = await api('GET', `/api/projects/${id}`);
  state.view = 'project';
  if (tab) state.tab = tab;
  render();
}

async function refreshProject() {
  if (!state.project) return;
  state.project = await api('GET', `/api/projects/${state.project.id}`);
}

function anyGenerating(p) {
  return p?.scenes?.some((s) => ['start_frame', 'end_frame', 'video'].some((k) => s.status[k] === 'generating'));
}

setInterval(async () => {
  if (state.view !== 'project' || !state.project || !anyGenerating(state.project)) return;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  try {
    await refreshProject();
    if (!typing && !state.busy) render();
  } catch { /* transient */ }
}, 3000);

// --- file url helper ---
const fileUrl = (relPath) => `/files/${state.project.id}/${relPath}?t=${Date.now() >> 14}`;

// --- rendering ---

function render() {
  const app = $('#app');
  app.innerHTML = state.view === 'home' ? renderHome() : renderProject();
}

function renderHome() {
  return `
    <h1>Animated Ad Pipeline</h1>
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
          <span class="badge ${p.storyboardStatus === 'approved' ? 'approved' : 'pending'}">${esc(p.storyboardStatus)}</span>
          <span class="muted">${p.sceneCount} scenes</span>
          <span class="spacer"></span>
          <span class="muted">${new Date(p.createdAt).toLocaleString()}</span>
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

// --- Setup tab ---

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
          <img class="ref-img" src="${fileUrl(p.references.style.path)}" />
          <button class="danger small" data-act="del-ref" data-role="style">Remove</button>
        </div>` : `
        <div class="row">
          <input type="file" id="style-file" accept="image/*" style="max-width:280px" />
          <button class="secondary" data-act="upload-ref" data-role="style">Upload style image</button>
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
          <img class="ref-img" src="${fileUrl(p.references.character.path)}" />
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
            <img class="ref-img" src="${fileUrl(r.path)}" />
            <button class="danger small" style="margin-top:4px" data-act="del-ref" data-role="product" data-index="${i}">Remove</button>
          </div>`).join('')}
      </div>
      <div class="row" style="margin-top:10px">
        <input type="file" id="prod-file" accept="image/*" style="max-width:280px" />
        <button class="secondary" data-act="upload-ref" data-role="product">Upload product photo</button>
      </div>
    </div>`;
}

// --- Storyboard tab ---

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
        ${locked ? '<span class="muted">Storyboard approved — head to the Frames tab. Editing or regenerating will require re-approval.</span>' : ''}
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
  <div class="panel" data-scene="${s.id}">
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

// --- Frames tab ---

function badge(status) {
  const cls = status === 'n/a' ? 'na' : status;
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

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
      ${anyGenerating(p) ? '<span class="busy">⏳ generating — updates live</span>' : ''}
    </div>
    <div class="grid">
      ${p.scenes.map((s) => `
        <div class="card">
          <div class="scene-head"><span class="title">Scene ${s.order}</span><span class="muted">${esc(s.duration_s)}s</span><span class="spacer"></span></div>
          <div class="frame-pair">
            <div>
              <div class="thumb-label">Start ${badge(s.status.start_frame)}</div>
              ${s.assets.start_frame_path ? `<img src="${fileUrl(s.assets.start_frame_path)}"/>` : '<div class="muted" style="aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;background:var(--panel2);border-radius:8px">no frame yet</div>'}
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
              ${s.assets.end_frame_path ? `<img src="${fileUrl(s.assets.end_frame_path)}"/>` : '<div class="muted" style="aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;background:var(--panel2);border-radius:8px">no frame yet</div>'}
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

// --- Videos tab ---

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
      ${anyGenerating(p) ? '<span class="busy">⏳ generating — video tasks can take several minutes each</span>' : ''}
    </div>
    <div class="grid">
      ${p.scenes.map((s) => `
        <div class="card">
          <div class="scene-head"><span class="title">Scene ${s.order}</span>${badge(s.status.video)}<span class="muted">${esc(s.duration_s)}s${s.is_transformation ? ' · start→end interpolation' : ''}</span></div>
          ${s.assets.video_path ? `<video controls src="${fileUrl(s.assets.video_path)}"></video>` : `<img src="${s.assets.start_frame_path ? fileUrl(s.assets.start_frame_path) : ''}" style="opacity:.4"/>`}
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

// --- Export tab ---

function renderExport() {
  const p = state.project;
  const approved = p.scenes.filter((s) => s.status.video === 'approved');
  return `
    <div class="panel">
      <h3>Export</h3>
      <p class="muted">${approved.length} of ${p.scenes.length} clips approved. The zip names clips by scene order so they drop into an editor in sequence.</p>
      <a href="/api/projects/${esc(p.id)}/export"><button ${approved.length ? '' : 'disabled'}>Download all approved clips (.zip)</button></a>
    </div>
    <div class="grid">
      ${approved.map((s) => `
        <div class="card">
          <div class="scene-head"><span class="title">${String(s.order).padStart(2, '0')}-${esc(s.id)}.mp4</span></div>
          <video controls src="${fileUrl(s.assets.video_path)}"></video>
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

function bindEvents(app) {
  // Autosave the script textarea on blur so pasted text survives re-renders.
  app.addEventListener('change', async (e) => {
    if (e.target.id === 'script' && state.project) {
      try {
        state.project = await api('PATCH', `/api/projects/${state.project.id}`, { script: e.target.value });
      } catch { /* saved again on generate */ }
    }
  });

  app.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const pid = state.project?.id;
    const sceneId = btn.dataset.scene;

    const actions = {
      'home': async () => { await loadProjects(); state.view = 'home'; state.project = null; render(); },
      'open': () => openProject(btn.dataset.id, 'setup'),
      'tab': () => { state.tab = btn.dataset.tab; render(); },
      'create-project': () => {
        // Inputs are read BEFORE withBusy — its re-render rebuilds the form
        // from saved state and would wipe anything unsaved.
        const name = $('#new-name').value;
        if (!name.trim()) return toast('Project name is required');
        return withBusy('Creating project', async () => {
          const project = await api('POST', '/api/projects', { name });
          await openProject(project.id, 'setup');
        });
      },
      'save-settings': () => withBusy('Saving settings', async () => {
        state.project = await api('PATCH', `/api/projects/${pid}`, {
          settings: {
            creativeDirection: $('#set-creative').value,
            brandAccent: $('#set-accent').value,
            backgroundNote: $('#set-bg').value,
            aspectRatio: $('#set-ar').value,
            continuityChaining: $('#set-chain').checked,
            sound: $('#set-sound').checked,
          },
        });
      }),
      'upload-ref': () => {
        const role = btn.dataset.role;
        const file = ({ character: $('#char-file'), style: $('#style-file') }[role] || $('#prod-file'))?.files[0];
        if (!file) return toast('Choose an image file first');
        return withBusy('Uploading reference', async () => {
          const form = new FormData();
          form.append('role', role);
          form.append('image', file);
          state.project = await api('POST', `/api/projects/${pid}/references`, form);
        });
      },
      'del-ref': () => withBusy('Removing reference', async () => {
        state.project = await api('DELETE', `/api/projects/${pid}/references/${btn.dataset.role}/${btn.dataset.index ?? 0}`);
      }),
      'gen-character': () => {
        const prompt = $('#char-prompt').value.trim();
        if (!prompt) return toast('A character prompt is required');
        return withBusy('Generating character (Nano Banana Pro, ~30s)', async () => {
          state.project = await api('POST', `/api/projects/${pid}/references/character/generate`, { prompt });
        });
      },
      'gen-storyboard': () => {
        const script = $('#script').value;
        const note = $('#sb-note').value;
        if (!script.trim()) return toast('Paste a script first');
        return withBusy('Generating storyboard with Claude (this can take a minute or two)', async () => {
          state.project = await api('POST', `/api/projects/${pid}/storyboard`, { script, note });
        });
      },
      'approve-storyboard': () => withBusy('Approving storyboard', async () => {
        state.project = await api('POST', `/api/projects/${pid}/storyboard/approve`);
      }),
      'save-scene': () => withBusy('Saving scene', async () => {
        const panel = btn.closest('[data-scene]');
        state.project = await api('PATCH', `/api/projects/${pid}/scenes/${sceneId}`, sceneEdits(panel));
      }),
      'regen-scene': () => {
        const note = window.prompt('Optional note for regenerating this scene (leave blank for none):', '');
        if (note === null) return;
        return withBusy(`Regenerating scene ${sceneId}`, async () => {
          state.project = await api('POST', `/api/projects/${pid}/scenes/${sceneId}/regenerate-storyboard`, { note });
        });
      },
      'gen-frames': () => withBusy('Submitting frame generations', async () => {
        await api('POST', `/api/projects/${pid}/frames`);
        await refreshProject();
      }),
      'approve-all-frames': () => withBusy('Approving frames', async () => {
        state.project = await api('POST', `/api/projects/${pid}/frames/approve-all`);
      }),
      'approve-frame': () => withBusy('Approving frame', async () => {
        state.project = await api('POST', `/api/projects/${pid}/scenes/${sceneId}/frame/approve`, { which: btn.dataset.which });
      }),
      'regen-frame': () => withBusy('Submitting frame regeneration', async () => {
        await api('POST', `/api/projects/${pid}/scenes/${sceneId}/frame/regenerate`, { which: btn.dataset.which });
        await refreshProject();
      }),
      'gen-videos': () => withBusy('Submitting video generations', async () => {
        await api('POST', `/api/projects/${pid}/videos`);
        await refreshProject();
      }),
      'approve-all-videos': () => withBusy('Approving videos', async () => {
        state.project = await api('POST', `/api/projects/${pid}/videos/approve-all`);
      }),
      'approve-video': () => withBusy('Approving clip', async () => {
        state.project = await api('POST', `/api/projects/${pid}/scenes/${sceneId}/video/approve`);
      }),
      'regen-video': () => withBusy('Submitting video regeneration', async () => {
        await api('POST', `/api/projects/${pid}/scenes/${sceneId}/video/regenerate`);
        await refreshProject();
      }),
      'edit-prompt': () => {
        const field = btn.dataset.field;
        const scene = state.project.scenes.find((s) => s.id === sceneId);
        const current = scene[field] || '';
        const next = window.prompt(`Edit ${field.replace(/_/g, ' ')} for scene ${scene.order}:`, current);
        if (next === null || next === current) return;
        return withBusy('Saving prompt', async () => {
          state.project = await api('PATCH', `/api/projects/${pid}/scenes/${sceneId}`, { [field]: next });
        });
      },
    };

    const handler = actions[act];
    if (handler) {
      try { await handler(); } catch (err) { toast(String(err.message || err)); }
    }
  });
}

// --- boot ---
(async () => {
  bindEvents($('#app'));
  try { await loadProjects(); } catch (err) { toast(String(err.message || err)); }
  render();
})();
