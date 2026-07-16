// kie.ai API client: createTask / recordInfo polling / file upload / asset download.
// All generation is async — createTask returns a taskId, results come from polling recordInfo.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const API_BASE = 'https://api.kie.ai';
// The File Upload API lives on a separate host from the generation API.
const UPLOAD_BASE = 'https://kieai.redpandaai.co';
// Uploaded files are deleted by kie.ai after 3 days; re-upload before that.
export const UPLOAD_TTL_MS = 60 * 60 * 60 * 1000; // 60 hours

function apiKey() {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error('KIE_API_KEY is not set. Copy .env.example to .env and fill it in.');
  return key;
}

async function request(url, options, { retries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${apiKey()}`, ...options.headers },
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`kie.ai ${url} failed after ${retries} retries: HTTP ${res.status}`);
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      const delay = Math.max(retryAfter * 1000, 2000 * 2 ** attempt) + Math.random() * 1000;
      await sleep(delay);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`kie.ai ${url}: HTTP ${res.status} ${body ? JSON.stringify(body) : ''}`);
    }
    return body;
  }
}

export async function createTask(model, input) {
  const body = await request(`${API_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  const taskId = body?.data?.taskId;
  if (!taskId) throw new Error(`createTask(${model}) returned no taskId: ${JSON.stringify(body)}`);
  return taskId;
}

export async function getTask(taskId) {
  const body = await request(`${API_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { method: 'GET' });
  return body?.data ?? body;
}

// Poll a task until it succeeds or fails. Returns array of result asset URLs.
export async function pollTask(taskId, { intervalMs = 5000, timeoutMs = 20 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = await getTask(taskId);
    const state = String(task?.state ?? '').toLowerCase();
    if (state === 'success') {
      let result = task.resultJson;
      if (typeof result === 'string') {
        try { result = JSON.parse(result); } catch { result = null; }
      }
      const urls = result?.resultUrls ?? result?.result_urls ?? result?.urls
        ?? (result?.resultUrl ? [result.resultUrl] : null);
      if (!urls?.length) throw new Error(`Task ${taskId} succeeded but returned no result URLs: ${JSON.stringify(task.resultJson)}`);
      return urls;
    }
    if (state === 'fail' || state === 'failed' || state === 'error') {
      throw new Error(`Task ${taskId} failed: ${task.failMsg || task.failCode || 'unknown error'}`);
    }
    if (Date.now() > deadline) throw new Error(`Task ${taskId} timed out after ${timeoutMs / 1000}s (state: ${state})`);
    await sleep(intervalMs);
  }
}

// Upload a local file, returns a hosted URL usable as a generation input.
export async function uploadFile(localPath, uploadPath = 'video-gen') {
  const data = await fs.promises.readFile(localPath);
  const form = new FormData();
  const ext = path.extname(localPath).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' }[ext] || 'application/octet-stream';
  form.append('file', new Blob([data], { type: mime }), path.basename(localPath));
  form.append('uploadPath', uploadPath);
  const body = await request(`${UPLOAD_BASE}/api/file-stream-upload`, { method: 'POST', body: form });
  // This host reports failures as HTTP 200 with success:false in the body.
  if (body?.success === false) throw new Error(`kie.ai upload failed: ${body.msg || JSON.stringify(body)}`);
  const url = body?.data?.downloadUrl;
  if (!url) throw new Error(`File upload returned no downloadUrl: ${JSON.stringify(body)}`);
  return url;
}

// Download a generated asset to disk.
export async function downloadAsset(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(destPath, buf);
  return destPath;
}
