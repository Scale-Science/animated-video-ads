// Minimal STORE-only (no compression) ZIP writer — mp4 clips don't compress
// anyway, and this keeps the static app dependency-free.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// entries: [{ name: string, blob: Blob }]
export async function buildZip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);

  for (const { name, blob } of entries) {
    const nameBytes = encoder.encode(name);
    const data = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(data);
    const header = [
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0),
    ];
    const localOffset = offset;
    for (const part of [...header, nameBytes, data]) { chunks.push(part); offset += part.length; }
    central.push({ nameBytes, crc, size: data.length, localOffset });
  }

  const centralStart = offset;
  for (const { nameBytes, crc, size, localOffset } of central) {
    const rec = [
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(localOffset),
    ];
    for (const part of [...rec, nameBytes]) { chunks.push(part); offset += part.length; }
  }
  const centralSize = offset - centralStart;
  const end = [
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(centralSize), u32(centralStart), u16(0),
  ];
  chunks.push(...end);

  return new Blob(chunks, { type: 'application/zip' });
}
