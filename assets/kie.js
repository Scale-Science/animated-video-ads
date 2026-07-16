// Browser kie.ai client — same surface as server/kie.js but the API key comes
// from the in-browser settings (localStorage) and uploads take Blobs.
import { getKeys } from './store.js';

const API_BASE = 'https://api.kie.ai';
// The File Upload API lives on a separate host from the generation API.
const UPLOAD_BASE = 'https://kieai.redpandaai.co';
export const UPLOAD_TTL_MS = 60 * 60 * 60 * 1000; // uploads expire after ~3 days; refresh at 60h

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function apiKey() {
  const key = getKeys().kie;
  if (!key) throw new Error('kie.ai API key is not set — add it under API Keys on the home screen.');
  return key;
}

async function request(url, options, { retries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${apiKey()}`, ...(options.headers || {}) },
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`kie.ai request failed after ${retries} retries: HTTP ${res.status}`);
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      await sleep(Math.max(retryAfter * 1000, 2000 * 2 ** attempt) + Math.random() * 1000);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`kie.ai HTTP ${res.status}: ${body ? JSON.stringify(body) : url}`);
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
      if (!urls?.length) throw new Error(`Task ${taskId} succeeded but returned no result URLs`);
      return urls;
    }
    if (state === 'fail' || state === 'failed' || state === 'error') {
      throw new Error(`Task failed: ${task.failMsg || task.failCode || 'unknown error'}`);
    }
    if (Date.now() > deadline) throw new Error(`Task ${taskId} timed out (state: ${state})`);
    await sleep(intervalMs);
  }
}

export async function uploadBlob(blob, fileName, uploadPath = 'video-gen') {
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('uploadPath', uploadPath);
  const body = await request(`${UPLOAD_BASE}/api/file-stream-upload`, { method: 'POST', body: form });
  // This host reports failures as HTTP 200 with success:false in the body.
  if (body?.success === false) throw new Error(`kie.ai upload failed: ${body.msg || JSON.stringify(body)}`);
  const url = body?.data?.downloadUrl;
  if (!url) throw new Error(`File upload returned no downloadUrl: ${JSON.stringify(body)}`);
  return url;
}

export async function fetchAsset(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download asset: HTTP ${res.status}`);
  return res.blob();
}
