// Pure parsers for the pasted prompt blocks. No DOM, no state — unit-testable.
//
// Scene prompts are pasted as one block, each prompt introduced by a header:
//   **P1 — Cold open** *(GLP: "Let me in!")*
//   <prompt body, one or more paragraphs, until the next **P header>
// Motion prompts use the same P-id headers, one per scene.

// Match a header like  **P1 — Title**  optionally followed by  *(Speaker: "line")*
// Anchored to the start of a line so a stray bold "**P2**" mid-prompt is not
// mistaken for a scene header.
const HEADER_RE = /^[ \t]*\*\*\s*(P\d+)\b[ \t.:—–-]*([^*\n]*?)\s*\*\*[ \t]*(?:\*\(([^)]*)\)\*)?/gim;

function splitByHeaders(text) {
  const heads = [];
  let m;
  HEADER_RE.lastIndex = 0;
  while ((m = HEADER_RE.exec(text)) !== null) {
    heads.push({
      index: m.index,
      end: HEADER_RE.lastIndex,
      id: m[1].toUpperCase(),
      title: (m[2] || '').trim(),
      meta: (m[3] || '').trim(),
    });
  }
  return heads.map((h, i) => {
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].index : text.length;
    return { ...h, body: text.slice(h.end, bodyEnd).trim() };
  });
}

// Pull "Speaker: \"line\"" out of the header meta.
function parseMeta(meta) {
  let speaker = '';
  let dialogue = '';
  if (meta) {
    const m = meta.match(/^\s*([^:]+?)\s*:\s*[“”"'‘’]?(.*?)[“”"'‘’]?\s*$/);
    if (m) { speaker = m[1].trim(); dialogue = m[2].trim(); }
    else { dialogue = meta.replace(/^[“”"'‘’]|[“”"'‘’]$/g, '').trim(); }
  }
  return { speaker, dialogue };
}

// Extract file references from a prompt body.
//  - explicit "file N" mentions in the body
//  - "file N = X" / "Files: N = X" numbered assignments
//  - unnumbered "Files:" entries (a bare label, or "P2 frame") — auto-numbered
// A value that looks like a scene ("P2 frame", or exactly "P2") becomes a
// scene-frame reference; anything else is treated as a library label.
export function extractFileRefs(body) {
  const nums = new Set();
  const labelMap = {}; // fileNum -> label text (to match against the library)
  const sceneMap = {}; // fileNum -> "scene:P#"

  const assign = (n, valRaw) => {
    nums.add(n);
    const val = String(valRaw).trim().replace(/[.\s]+$/, '');
    const p = val.match(/\bP(\d+)\b/i);
    if (p && (/\bframe\b/i.test(val) || /^P\d+$/i.test(val))) sceneMap[n] = `scene:P${p[1]}`;
    else labelMap[n] = val;
  };

  for (const m of body.matchAll(/\bfile\s+(\d+)/gi)) nums.add(Number(m[1]));
  for (const m of body.matchAll(/\bfile\s+(\d+)\s*=\s*([^\n,;]+)/gi)) assign(Number(m[1]), m[2]);

  const filesLine = body.match(/\bFiles?\s*(?:to attach)?\s*:\s*([^\n]+)/i);
  if (filesLine) {
    const nextAuto = () => { let i = 1; while (nums.has(i)) i += 1; return i; };
    for (const raw of filesLine[1].split(/[,;]/)) {
      const tok = raw.replace(/^[\s+•\-–]+/, '').replace(/[.\s]+$/, '').trim(); // strip bullets/trailing dot
      if (!tok) continue;
      const eq = tok.match(/^(\d+)\s*=\s*(.+)$/);
      if (eq) assign(Number(eq[1]), eq[2]);
      else assign(nextAuto(), tok);
    }
  }
  return { fileNums: [...nums].sort((a, b) => a - b), labelMap, sceneMap };
}

// Build a suggested [{file, refId}] mapping. A scene-frame reference maps
// straight to "scene:P#"; otherwise the label text is matched to the library.
export function suggestMapping(fileNums, labelMap, sceneMap, references) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const libs = references.map((r) => ({ id: r.id, key: norm(r.label) }));
  const matchLabel = (label) => {
    const k = norm(label);
    if (!k) return null;
    let hit = libs.find((l) => l.key === k);
    if (!hit) hit = libs.find((l) => l.key && (k.includes(l.key) || l.key.includes(k)));
    return hit ? hit.id : null;
  };
  return fileNums.map((file) => ({
    file,
    refId: sceneMap[file] ? sceneMap[file] : (labelMap[file] != null ? matchLabel(labelMap[file]) : null),
  }));
}

export function parseScenes(text, references = []) {
  const heads = splitByHeaders(text);
  // Collapse duplicate ids (a doubled paste, or a stray second bold header per
  // scene) — keep the entry with the longest body per id, first-seen order.
  const order = [];
  const byId = new Map();
  for (const h of heads) {
    if (!byId.has(h.id)) { order.push(h.id); byId.set(h.id, h); }
    else if ((h.body || '').length > (byId.get(h.id).body || '').length) byId.set(h.id, h);
  }
  const unique = order.map((id) => byId.get(id));
  const ids = new Set(unique.map((h) => h.id));
  return unique.map((h) => {
    const { speaker, dialogue } = parseMeta(h.meta);
    const { fileNums, labelMap, sceneMap } = extractFileRefs(h.body);
    const fileMap = suggestMapping(fileNums, labelMap, sceneMap, references).map((slot) => {
      // drop a scene reference that doesn't point at an actual parsed scene
      if (typeof slot.refId === 'string' && slot.refId.startsWith('scene:') && !ids.has(slot.refId.slice(6))) {
        return { ...slot, refId: null };
      }
      return slot;
    });
    return { id: h.id, title: h.title, speaker, dialogue, prompt_body: h.body, fileMap };
  });
}

// Motion prompts: same headers, body is the motion prompt. Carry any dialogue in
// the header meta so the operator can see the lip-sync line.
export function parseMotion(text) {
  return splitByHeaders(text).map((h) => {
    const { speaker, dialogue } = parseMeta(h.meta);
    return { id: h.id, title: h.title, speaker, dialogue, motion: h.body };
  });
}
