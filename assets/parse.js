// Pure parsers for the pasted prompt blocks. No DOM, no state — unit-testable.
//
// Scene prompts are pasted as one block, each prompt introduced by a header:
//   **P1 — Cold open** *(GLP: "Let me in!")*
//   <prompt body, one or more paragraphs, until the next **P header>
// Motion prompts use the same P-id headers, one per scene.

// Match a header like  **P1 — Title**  optionally followed by  *(Speaker: "line")*
const HEADER_RE = /\*\*\s*(P\d+)\b[\s.:—–-]*([^*\n]*?)\s*\*\*\s*(?:\*\(([^)]*)\)\*)?/gi;

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

// Every "file N" mention, and any "file N = label" / "Files: N = label" pairs.
export function extractFileRefs(body) {
  const nums = new Set();
  const labelMap = {}; // fileNum -> label text
  for (const m of body.matchAll(/\bfile\s+(\d+)/gi)) nums.add(Number(m[1]));
  for (const m of body.matchAll(/\bfile\s+(\d+)\s*=\s*([^\n,;]+)/gi)) {
    const n = Number(m[1]);
    labelMap[n] = m[2].trim().replace(/[.\s]+$/, '');
    nums.add(n);
  }
  // also a compact "Files: 1 = a, 2 = b" line without the word "file" before each number
  const filesLine = body.match(/\bFiles?\s*(?:to attach)?\s*:\s*([^\n]+)/i);
  if (filesLine) {
    for (const m of filesLine[1].matchAll(/(\d+)\s*=\s*([^,;]+)/g)) {
      const n = Number(m[1]);
      if (labelMap[n] == null) labelMap[n] = m[2].trim().replace(/[.\s]+$/, '');
      nums.add(n);
    }
  }
  return { fileNums: [...nums].sort((a, b) => a - b), labelMap };
}

// Build a suggested [{file, refId}] mapping from label matches against the library.
export function suggestMapping(fileNums, labelMap, references) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const libs = references.map((r) => ({ id: r.id, key: norm(r.label) }));
  const matchLabel = (label) => {
    const k = norm(label);
    if (!k) return null;
    let hit = libs.find((l) => l.key === k);                       // exact
    if (!hit) hit = libs.find((l) => l.key && (k.includes(l.key) || l.key.includes(k))); // contains
    return hit ? hit.id : null;
  };
  return fileNums.map((file) => ({ file, refId: labelMap[file] != null ? matchLabel(labelMap[file]) : null }));
}

export function parseScenes(text, references = []) {
  return splitByHeaders(text).map((h) => {
    const { speaker, dialogue } = parseMeta(h.meta);
    const { fileNums, labelMap } = extractFileRefs(h.body);
    return {
      id: h.id,
      title: h.title,
      speaker,
      dialogue,
      prompt_body: h.body,
      fileMap: suggestMapping(fileNums, labelMap, references),
    };
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
