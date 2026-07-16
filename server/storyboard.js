// Stage 1: script -> storyboard via the Anthropic API, primed with the two skill
// files. The skill files are read from disk on every call so edits to the skill
// flow straight into the app's output.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SKILL_DIR } from './store.js';

let _client;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }
  _client ??= new Anthropic();
  return _client;
}
const MODEL = process.env.STORYBOARD_MODEL || 'claude-opus-4-8';

const REFERENCE_NAMES = ['character', 'product', 'prev_frame', 'start_frame'];

const sceneSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'order', 'start', 'duration_s', 'vo', 'is_transformation',
    'start_frame_prompt', 'end_frame_prompt', 'motion_prompt',
    'reference_order', 'end_frame_reference_order',
  ],
  properties: {
    order: { type: 'integer' },
    start: { type: 'string', description: 'Timestamp where this clip starts, e.g. "0:04"' },
    duration_s: { type: 'number', description: 'Clip duration in seconds, 3-5' },
    vo: { type: 'string', description: 'The exact voiceover line(s) this clip covers' },
    is_transformation: { type: 'boolean' },
    start_frame_prompt: { type: 'string' },
    end_frame_prompt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    motion_prompt: { type: 'string' },
    reference_order: { type: 'array', items: { type: 'string', enum: REFERENCE_NAMES } },
    end_frame_reference_order: { type: 'array', items: { type: 'string', enum: REFERENCE_NAMES } },
  },
};

const storyboardSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['style_block', 'character_block', 'product_block', 'scenes'],
  properties: {
    style_block: { type: 'string' },
    character_block: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    product_block: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    scenes: { type: 'array', items: sceneSchema },
  },
};

function readSkillFiles() {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const motion = fs.readFileSync(path.join(SKILL_DIR, 'references', 'seedance-motion.md'), 'utf8');
  return { skill, motion };
}

function systemPrompt(project) {
  const { skill, motion } = readSkillFiles();
  const s = project.settings;
  return `You are the storyboard engine inside a video-ad generation app. Follow the pipeline skill below exactly — it is the source of truth for how prompts must be written.

<skill file="animated-video-ad-pipeline/SKILL.md">
${skill}
</skill>

<skill file="animated-video-ad-pipeline/references/seedance-motion.md">
${motion}
</skill>

APP-SPECIFIC TRANSLATION — this is the one deviation from the skill's output format:
The skill ends every prompt with a "Files to attach" list. In this app, attaching a file means the app passes reference image URLs to the generation API in order. So instead of writing "Files to attach" lists inside the prompt text, you record each scene's ordered reference list in the structured fields "reference_order" (for the starting frame) and "end_frame_reference_order" (for the ending frame, when the scene is a transformation). Allowed reference names:
- "character"  — the locked character reference image
- "product"    — the locked product reference image
- "prev_frame" — the previous scene's approved starting frame
- "start_frame"— this scene's own generated starting frame (only valid in end_frame_reference_order, where the skill says to attach it as file 1)
The prompt text must still refer to subjects by file position ("the character from file 1", "same product as file 2"), and the positions must match the order of the reference list you output: the first entry in the list is file 1, the second is file 2, and so on. Never refer to a character or product by name. Do NOT include a "Files to attach" section in the prompt text itself.

Other hard rules:
- Starting-frame and ending-frame prompts are single still frames: no camera movement, no motion blur, no camera language. Lead with the STYLE block, then CHARACTER/PRODUCT blocks as needed, then the frame description.
- Motion prompts follow the seedance-motion reference: shared motion/style header, duration, one camera move, one continuous beat. Motion durations come from the timing map.
- Clips are 3-5 seconds, cut on meaning.
- Set is_transformation=true (and write an end_frame_prompt) only when the clip contains a real transformation; end_frame_prompt is null otherwise, and end_frame_reference_order is [] when there is no end frame.
- Write style_block, character_block and product_block once and reuse their text byte-identically inside every prompt.

Project configuration to bake into the STYLE block:
- Visual style descriptor: ${s.styleDescriptor}
- Brand accent color: ${s.brandAccent || '(none specified — use a tasteful neutral accent)'}
- Background note: ${s.backgroundNote || '(none specified)'}
- Aspect ratio: ${s.aspectRatio}
- Character reference available: ${project.references.character ? 'yes' : 'no — do not use the "character" reference name'}
- Product reference available: ${project.references.product.length > 0 ? 'yes' : 'no — do not use the "product" reference name'}`;
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
  const user = `Here is the finished, timestamped voiceover script. Produce the full storyboard (Stages 2, 4, 5 and 6 of the skill: timing map, starting-frame prompts, ending-frame prompts for transformation clips, and motion prompts).
${note ? `\nOperator note for this generation: ${note}\n` : ''}
<script>
${script}
</script>`;
  return callClaude(systemPrompt(project), user, storyboardSchema);
}

export async function regenerateScene(project, scene, note) {
  const meta = project.storyboardMeta || {};
  const user = `The storyboard below is already approved in structure. Regenerate ONLY scene ${scene.order} (${scene.id}), keeping its timing and VO line the same unless the operator note says otherwise. Reuse the locked blocks byte-identically.

Locked STYLE block:
${meta.style_block || '(none)'}
Locked CHARACTER block:
${meta.character_block || '(none)'}
Locked PRODUCT block:
${meta.product_block || '(none)'}

Full current storyboard (context):
${JSON.stringify(project.scenes.map(({ id, order, start, duration_s, vo, is_transformation, start_frame_prompt, end_frame_prompt, motion_prompt, reference_order, end_frame_reference_order }) => ({ id, order, start, duration_s, vo, is_transformation, start_frame_prompt, end_frame_prompt, motion_prompt, reference_order, end_frame_reference_order })), null, 2)}

${note ? `Operator note: ${note}` : 'Improve the prompts for this scene while following the skill exactly.'}`;
  return callClaude(systemPrompt(project), user, sceneSchema);
}
