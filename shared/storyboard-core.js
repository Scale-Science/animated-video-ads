// Pure, environment-agnostic storyboard prompt/schema definitions.
// Used by both the local Node server (server/storyboard.js) and the static
// browser app (assets/anthropic.js) so the two stay in lockstep.

export const REFERENCE_NAMES = ['character', 'product', 'prev_frame', 'start_frame'];

export const sceneSchema = {
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

export const storyboardSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scene_style', 'character_rendering', 'tone_notes', 'scenes'],
  properties: {
    // The scene-style portion of the Style: line — render look, lighting,
    // background, palette, and the fixed technical tail. Reused byte-identically
    // in every prompt's Style: line.
    scene_style: { type: 'string' },
    // The separable character-rendering clause, included in the Style: line only
    // for scenes that contain a character; null when the style has no such clause.
    character_rendering: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    // Tone and world notes — mood/humor/energy that shape frame descriptions and
    // motion, not text pasted into the Style: line.
    tone_notes: { type: 'string' },
    scenes: { type: 'array', items: sceneSchema },
  },
};

export function buildSystemPrompt({ skill, motion, settings, hasCharacter, hasProduct, hasStyleImage }) {
  const s = settings;
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
- Follow the skill's Stage 4/5 prompt structure exactly: each starting-frame and ending-frame prompt leads with the frame description, then a "Style:" line, then (in the app, the Files-to-attach list is replaced by the structured reference fields above — do not print it). The frame description is the subject of the image; the Style: line is the treatment.
- Starting-frame and ending-frame prompts are single still frames: no camera movement, no motion blur, no camera language.
- Weave file references into the frame description ("the character from file 1", "same product as file 2"). There is no separate character or product line above the prompt.
- The Style: line = the scene_style text, PLUS the character_rendering clause ONLY when a character is in that frame, then the fixed technical tail. Drop the character_rendering clause entirely from any product-only or object-only scene.
- Motion prompts follow the seedance-motion reference: shared motion/style header (which leads with the scene_style, not the frame description), duration, one camera move, one continuous beat. Motion durations come from the timing map.
- Clips are 3-5 seconds, cut on meaning.
- Set is_transformation=true (and write an end_frame_prompt) only when the clip contains a real transformation; end_frame_prompt is null otherwise, and end_frame_reference_order is [] when there is no end frame.
- Reuse the scene_style text byte-identically in every prompt's Style: line; reuse the character_rendering clause verbatim wherever a character appears.

CREATIVE DIRECTION — you set it, per the skill's Stage 3 (two separable parts: render style and tone/world notes):
- Operator's animation style & creative notes (authoritative): ${s.creativeDirection?.trim() || '(none — default to the polished-3D ZackDFilms preset from the skill)'}
- Style reference image: ${hasStyleImage
    ? 'attached as the first image in the user message. Study its render look, proportions, materials/texture, color treatment, and lighting feel, and distill them into the render style. If the notes and the image disagree, the image is the visual target and the notes carry the intent and tone.'
    : 'none attached.'}
From the notes${hasStyleImage ? ' and the reference image' : ''}: split any fused shorthand into a render style and a tone (e.g. "funny claymation" -> render style = claymation, tone = funny), following the skill's Stage 3 guidance. Then produce, at the top level of your output:
- scene_style: ONE polished render-style descriptor sentence (render look, proportions, lighting feel) in the spirit of the skill's presets, followed by the background and palette that apply to every frame. This is the scene-style portion of the Style: line and must be reused byte-identically everywhere. Do NOT put character-rendering language in scene_style.
- character_rendering: the separable clause describing how characters are rendered in this style (e.g. "characters rendered as glossy porcelain-white skeletons with human eyes"), or null if the style has no distinct character-rendering clause. This is added to the Style: line only in scenes with a character.
- tone_notes: the tone and world notes (mood, humor, energy). These are NOT pasted into the Style: line — they guide expression, staging, and motion energy across every scene.
The style reference image is inspiration for the render style text only — it is never attached to image generation, so never refer to it by file number in any prompt.

Other project configuration to fold into the scene_style / Style: line:
- Brand accent color: ${s.brandAccent || '(none specified — use a tasteful neutral accent)'}
- Background note: ${s.backgroundNote || '(none specified)'}
- Aspect ratio: ${s.aspectRatio}
- Character reference available: ${hasCharacter ? 'yes' : 'no — do not use the "character" reference name'}
- Product reference available: ${hasProduct ? 'yes' : 'no — do not use the "product" reference name'}`;
}

export function buildStoryboardUserPrompt(script, note) {
  return `Here is the finished, timestamped voiceover script. Produce the full storyboard (Stages 2, 4, 5 and 6 of the skill: timing map, starting-frame prompts, ending-frame prompts for transformation clips, and motion prompts).
${note ? `\nOperator note for this generation: ${note}\n` : ''}
<script>
${script}
</script>`;
}

export function buildSceneRegenPrompt(project, scene, note) {
  const meta = project.storyboardMeta || {};
  // Prefer the current field names; fall back to the pre-Stage-3-rewrite names
  // so storyboards generated before this update still regenerate cleanly.
  const sceneStyle = meta.scene_style ?? meta.style_block ?? '(none)';
  const characterRendering = meta.character_rendering ?? meta.character_block ?? '(none)';
  const toneNotes = meta.tone_notes ?? '(none)';
  return `The storyboard below is already approved in structure. Regenerate ONLY scene ${scene.order} (${scene.id}), keeping its timing and VO line the same unless the operator note says otherwise. Keep the frame-description-then-Style:-line structure, and reuse the locked style text byte-identically.

Locked scene_style (the Style: line's scene-style portion, reuse verbatim):
${sceneStyle}
Locked character_rendering clause (add to the Style: line only if a character is in this frame):
${characterRendering}
Tone and world notes (guide expression, staging, and motion energy; not pasted into the Style: line):
${toneNotes}

Full current storyboard (context):
${JSON.stringify(project.scenes.map(({ id, order, start, duration_s, vo, is_transformation, start_frame_prompt, end_frame_prompt, motion_prompt, reference_order, end_frame_reference_order }) => ({ id, order, start, duration_s, vo, is_transformation, start_frame_prompt, end_frame_prompt, motion_prompt, reference_order, end_frame_reference_order })), null, 2)}

${note ? `Operator note: ${note}` : 'Improve the prompts for this scene while following the skill exactly.'}`;
}
