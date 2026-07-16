// Stage 1: script -> storyboard via the Anthropic API, primed with the two skill
// files. The skill files are read from disk on every call so edits to the skill
// flow straight into the app's output. Prompt/schema definitions are shared with
// the static browser app via shared/storyboard-core.js.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SKILL_DIR } from './store.js';
import {
  storyboardSchema, sceneSchema,
  buildSystemPrompt, buildStoryboardUserPrompt, buildSceneRegenPrompt,
} from '../shared/storyboard-core.js';

let _client;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }
  _client ??= new Anthropic();
  return _client;
}
const MODEL = process.env.STORYBOARD_MODEL || 'claude-opus-4-8';

function systemPrompt(project) {
  return buildSystemPrompt({
    skill: fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8'),
    motion: fs.readFileSync(path.join(SKILL_DIR, 'references', 'seedance-motion.md'), 'utf8'),
    settings: project.settings,
    hasCharacter: !!project.references.character,
    hasProduct: project.references.product.length > 0,
  });
}

async function callClaude(system, userContent, schema) {
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: userContent }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new Error('The model refused this request.');
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error(`No text in storyboard response (stop_reason: ${message.stop_reason})`);
  return JSON.parse(text);
}

export async function generateStoryboard(project, script, note) {
  return callClaude(systemPrompt(project), buildStoryboardUserPrompt(script, note), storyboardSchema);
}

export async function regenerateScene(project, scene, note) {
  return callClaude(systemPrompt(project), buildSceneRegenPrompt(project, scene, note), sceneSchema);
}
