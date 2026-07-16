// Browser Anthropic client for the storyboard step. Raw fetch + SSE because this
// is a no-build static page; the request shape mirrors server/storyboard.js and
// the prompts/schemas come from the same shared module.
import { getKeys } from './store.js';
import {
  storyboardSchema, sceneSchema,
  buildSystemPrompt, buildStoryboardUserPrompt, buildSceneRegenPrompt,
} from '../shared/storyboard-core.js';

const MODEL = 'claude-opus-4-8';
let skillCache = null;

async function loadSkillFiles() {
  if (skillCache) return skillCache;
  const base = new URL('.', document.baseURI);
  const [skill, motion] = await Promise.all([
    fetch(new URL('animated-video-ad-pipeline/SKILL.md', base)).then((r) => {
      if (!r.ok) throw new Error('Could not load SKILL.md from the site');
      return r.text();
    }),
    fetch(new URL('animated-video-ad-pipeline/references/seedance-motion.md', base)).then((r) => {
      if (!r.ok) throw new Error('Could not load seedance-motion.md from the site');
      return r.text();
    }),
  ]);
  skillCache = { skill, motion };
  return skillCache;
}

async function callClaude(system, userContent, schema, onProgress) {
  const key = getKeys().anthropic;
  if (!key) throw new Error('Anthropic API key is not set — add it under API Keys on the home screen.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 64000,
      stream: true,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: userContent }],
      output_config: { format: { type: 'json_schema', schema } },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Anthropic API HTTP ${res.status}`);
  }

  // Parse the SSE stream, accumulating text deltas (the structured JSON output).
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep the trailing partial line
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text;
        onProgress?.(text.length);
      } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      } else if (event.type === 'error') {
        throw new Error(event.error?.message || 'Anthropic stream error');
      }
    }
  }
  if (stopReason === 'refusal') throw new Error('The model refused this request.');
  if (stopReason === 'max_tokens') throw new Error('The storyboard response was truncated (max_tokens) — try a shorter script.');
  if (!text) throw new Error(`Empty storyboard response (stop_reason: ${stopReason})`);
  return JSON.parse(text);
}

function systemPrompt(project, skillFiles) {
  return buildSystemPrompt({
    ...skillFiles,
    settings: project.settings,
    hasCharacter: !!project.references.character,
    hasProduct: project.references.product.length > 0,
  });
}

export async function generateStoryboard(project, script, note, onProgress) {
  const skillFiles = await loadSkillFiles();
  return callClaude(systemPrompt(project, skillFiles), buildStoryboardUserPrompt(script, note), storyboardSchema, onProgress);
}

export async function regenerateScene(project, scene, note, onProgress) {
  const skillFiles = await loadSkillFiles();
  return callClaude(systemPrompt(project, skillFiles), buildSceneRegenPrompt(project, scene, note), sceneSchema, onProgress);
}
