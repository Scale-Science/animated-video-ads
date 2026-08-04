---
name: animated-video-ad-pipeline
description: >
  Turn a direct-response ad script into a full polished-3D animated video ad, one clip at a time.
  Produces an adapted script, a clip-and-timing map, and per-clip image and motion prompts ready to
  run in Nano Banana Pro (frames) and Seedance 2.0 on Higgsfield or Kie.ai (video). Use this whenever
  the user wants to build an animated DR video ad, adapt a competitor video script for their product,
  break a script into 3-5 second clips with starting/ending frames, write animation image prompts in a
  chosen style (polished 3D, claymation, cel-shaded, and others), or write image-to-video motion prompts. Trigger on "animated ad", "video ad script",
  "adapt this script for [product]", "break this into clips", "starting frame prompts", "end frame",
  "Seedance prompts", "Nano Banana prompts for a video", or any request to move from a script toward
  animated ad frames and clips. Use it even if the user only names one stage (e.g. "write the end frame
  for this clip") so the file-referencing and style conventions stay consistent across the whole ad.
---

# Animated Video Ad Pipeline

Build a polished-3D animated direct-response video ad from a script, stage by stage. The media is
generated in external tools; this skill's job is to produce the exact prompts and the operator
instructions (which reference images to attach, in what order) so every frame and clip stays
consistent.

## The tools in the loop (and what this skill actually outputs)

- **Nano Banana Pro** generates the still frames (starting frame and ending frame per clip).
- **Seedance 2.0** (via Higgsfield or Kie.ai, model is platform-agnostic) animates a still into a
  clip using image-to-video. It can take a first frame alone, or a first frame plus a last frame for a
  controlled interpolation.
- **Instagram Edits** (or any editor) assembles the clips and trims to the voiceover.

This skill does NOT call those tools. It outputs text: the adapted script, the timing map, and for each
clip a starting-frame prompt, an ending-frame prompt, and a motion prompt, each with an explicit list of
which reference images to attach and in what order. The operator (or a downstream automation) runs those
prompts in the tools above.

**Bundled resources.** `references/seedance-motion.md` holds the full motion prompt craft (prompt
structure, camera vocabulary with speed language, easing and lighting-continuity terms, transformation
fallback). It is self-contained inside this skill, so the pipeline does not depend on any other skill
being installed. Read it at Stage 6.

## The single most important convention: reference by file number, never by name

The image model has no memory between generations. It only knows what is attached. Two rules follow, and
breaking either one is the most common way these ads drift:

1. **Never use a given name for a character or object in a prompt.** Do not write "the narrator" or a
   character name or "the object from scene 2". The model does not know those names. Instead attach the
   reference image and refer to it by its file position: **"the character from file 1"**, **"same object
   as file 1"**, **"same product as file 2"**.

2. **Every prompt ships with a "Files to attach" list** mapping each file number to a specific image, so
   the operator attaches them in the right order. The number in the prompt text must match the number in
   the list.

3. **Reference the file, never describe the subject.** Once a character or product has a reference image,
   do not write out its physical attributes in a scene prompt. Point at the file: "the character from
   file 1", "same product as file 2". Describing the subject in prose (its shape, color, size, texture) is
   the single most common cause of drift, because the model generates from your words instead of from the
   locked reference, and your words are never a perfect match. If you catch yourself writing what the
   product looks like, stop and replace it with a file reference. The only exception is the one-time prompt
   that creates a reference from scratch (see Stage 3), where a description is unavoidable because there is
   nothing to attach yet.

### Standard file order

Default order when a scene has the recurring character and the product:

- **file 1 = character reference**
- **file 2 = product reference**

When a scene also references an object from a previously generated frame (for example an end frame that
must match a hero object shown in the previous clip's frame), attach that previous generated image as
**file 1**, and shift the others after it. The exact numbering is not sacred; what matters is that the
prompt text and the Files-to-attach list agree, so the operator always knows which image goes in which
slot. State it explicitly every time.

### Example of the convention in action

Clip: a scratched watch face polishing itself smooth. The starting frame already exists as a generated
image.

**Ending-frame prompt (excerpt):**
> Same watch face as file 1, now flawless. The scratches are gone and the crystal is smooth and
> gleaming...

**Files to attach:**
- file 1 = the generated starting-frame image of this clip's watch face

Because "same watch face as file 1" points at an attached image, the model reproduces the right watch.
Writing "the same watch face" with nothing attached would produce a random one.

---

## Stage 0 - Gather inputs

Before writing anything, confirm you have:

- **The product's foundational docs** (research/avatar, offer brief, necessary beliefs, top angles). These
  set the mechanism, the target avatar, and the claims you are allowed to make.
- **The script.** The default flow is that the user provides a finished, timestamped voiceover script.
  Use it as written and go straight to Stage 2. Only adapt a script (Stage 1) if the user explicitly asks
  you to reframe a source or competitor script for their product.
- **The visual style** the user wants. Stage 3 offers a menu of presets and supports custom styles; if the
  user has no preference, default to the polished-3D (ZackDFilms) look.
- **The compliance-safe claim substitutions** for this product (see Stage 1).
- **Locked reference images** once they exist: one clean character reference and one product reference.
  These become file 1 and file 2 for the rest of the build.

If any are missing, ask for them rather than inventing details. Invented social proof, guarantee terms, or
clinical numbers are a liability in a running ad.

---

## Stage 1 - Adapt the script (optional)

Skip this stage when the user supplies a finished script. Run it only when the user asks you to reframe a
source or competitor script for their product. When you do, reframe the source around the product's real
mechanism and avatar while keeping the structure that made the original work.

- **Map to the product's real actives / mechanism.** Preserve the original's escalating-stack rhythm
  (each line adds one element and one benefit) but swap in the product's genuine ingredients and effects.
- **Keep the close intact structurally** (social proof beat, then risk-reversal beat, then CTA), but swap
  in the product's real proof and guarantee. Never carry a competitor's customer counts, guarantee window,
  or clinical figures into the adapted script. Flag any number that needs the client's real value.
- **Apply the product's compliance-safe claim substitutions.** Every category has claims that must be
  softened to a defensible version: swap an outcome the product cannot guarantee for the mechanism or the
  visible effect it can (for example, an appearance change reframed as clearing or reducing rather than a
  cure or a permanent result). Pull the specific substitutions from the product's foundational docs, and
  confirm anything ambiguous with the client before it goes in a running ad.
- **Do not invent an open-ended promise.** If the guarantee has no stated time period, write it open
  ("for any reason") rather than inventing a window, and flag that it becomes a promise the brand is on the
  hook for, worth confirming with the client signatory.

Deliver the adapted script as a timestamped VO line list (each line with its start time), because those
timestamps drive the clip split in Stage 2.

---

## Stage 2 - Split into clips and build the timing map

- **Cut on meaning, not on a fixed grid.** Each clip is one visual beat, typically **3 to 5 seconds**.
  A new clip starts wherever the script introduces a new idea, ingredient, or emotional turn.
- Keep every clip at or under Seedance's per-clip length limit (roughly 15 seconds; these clips are well
  under it at 3-5s).
- Output a numbered clip list. For each clip record: clip number, in/out timing, duration, and the exact VO
  line(s) it covers. This map is the spine every later stage refers back to.

---

## Stage 3 - Set the creative direction, then lock the reference blocks

First set the creative direction for the whole ad, then write the reusable blocks once and paste the
relevant ones into every image prompt. Consistency comes from reusing identical block text plus attaching
identical reference images.

### Set the creative direction

Creative direction has two parts, and both are project-level: they are set once and applied to every scene.

1. **Render style** (the visual look). Pick one and keep it fixed across every frame; do not mix render
   styles within a single ad. Each preset below is a one-line **style descriptor** that goes into the
   Style: line of every prompt. Use one as written, or write a custom descriptor in the same spirit. If the
   user has no preference, default to the polished-3D (ZackDFilms) look.

   When a descriptor bundles a character-rendering clause (how people are rendered in this style, such as
   "clean detailed skin with subtle freckles" or "glossy porcelain-white skeletons with human eyes"),
   treat that clause as separable. It belongs in the Style: line only for scenes that actually contain a
   character, and is dropped for product-only or object-only scenes. See "Write the blocks" below.

   - **Polished 3D (ZackDFilms):** "Polished 3D animated explainer in the style of ZackDFilms.
     Semi-stylized photoreal CGI with clean textures and soft directional lighting, shot with a shallow
     depth of field macro-lens look and softly blurred bokeh background. Softly stylized proportions, clean
     detailed skin with subtle freckles, gentle soft shadows." Optional backdrop: a faint blueprint grid.
     See "Signature elements of the ZackDFilms style" below for the overlays, cutaways, camera, and
     continuity that define this look.
   - **Claymation / plasticine:** "Handmade claymation look, plasticine texture with subtle fingerprint
     detail, tactile matte surfaces, stop-motion charm, soft even lighting."
   - **Felt puppets (Muppet-style):** "Soft felt-and-fabric puppet characters, visible stitching and fuzzy
     texture, hand-crafted set, warm practical lighting, tactile stop-motion-adjacent charm."
   - **Cel-shaded 2.5D:** "Cel-shaded animation, bold clean outlines, flat color fills with defined shadow
     boundaries, graphic-novel look with a sense of depth."
   - **Futuristic / sci-fi 3D:** "Sleek futuristic 3D render, clean high-tech surfaces, cool metallic and
     glass materials, neon-accent rim lighting, polished sci-fi product-film look."
   - **Stylized realism:** "Grounded, near-realistic proportions and lighting with slightly heightened
     color and clean premium surfaces, understated and modern."
   - **Low-poly:** "Low-poly geometric forms, faceted surfaces, flat or simple gradient fills, minimalist
     and contemporary."

   For a custom style, write the descriptor as one vivid sentence naming the render look, the proportions,
   and the lighting feel, then reuse it verbatim.

2. **Tone and world notes** (the mood and setting). A short free-form line describing how the ad should
   feel and where it lives: the humor level, energy, and any world or character framing. Examples: "funny
   and irreverent," "calm and premium," "serious and cinematic," "playful kids-show energy," "futuristic
   and sleek." This is separate from the render style; a single render style can carry many tones (a
   claymation ad can be funny or somber). The user's shorthand often fuses the two, so split it: "funny
   claymation" becomes render style = claymation, tone = funny. "Serious muppets" becomes render style =
   felt puppets, tone = serious. "Futuristic" is usually a render-style-plus-world note.

**How each part flows into the work:**
- The **render style descriptor** goes into the Style: line of every prompt, so every frame shares one
  look (with the character-rendering clause included only when a character is in the scene).
- The **tone and world notes** guide the storyboard: they shape the character's expression and body
  language, the situation in each frame description, and the energy of the motion prompts in Stage 6. They
  are creative direction for the scenes, not text pasted into the Style: line. Keep them in mind on every
  scene so the whole ad reads with one consistent mood.

### Signature elements of the ZackDFilms style

These apply when the polished-3D (ZackDFilms) style is chosen. The render aesthetic and composition ones
belong in the still frames (this stage); the camera and pacing ones belong in the motion prompts (Stage 6
and `references/seedance-motion.md`, which carries the ZackDFilms camera and continuity vocabulary in full).

- **Macro micro-lens framing.** Frame subjects close, as if through a macro lens, with a shallow depth of
  field and a softly blurred bokeh background. This is the "educational close-up" feel that defines the
  look. Put it in the frame description as composition ("framed close, macro-lens depth, background softly
  blurred").
- **Diagrammatic graphic overlays (optional).** A signature of this style is motion-graphic overlays
  integrated into the 3D space to explain mechanics: glowing mechanic lines, vector arrows, trajectory arcs
  and measurement lines pinned in 3D. Non-text graphics (arrows, glowing lines, arcs) are on-brand and can
  go straight in the frame description. **Caveat:** numeric or worded callouts are text, which collides with
  the "No text, no watermark" rule in the Style line. If you want measurement callouts with numbers or
  labels, either relax that rule for the project or add the callouts in post; do not silently contradict
  the no-text constraint.
- **Cross-section cutaways (composition).** Frames can cut through environmental geometry to reveal hidden
  action beneath a surface while keeping the surface visible (for example, a cutaway through a tooth, a
  material, or the ground). This is a strong mechanism-explainer device; use it on beats where the VO is
  explaining how something works.
- **Dynamic camera and fast continuity.** The living, floating macro camera, the whip zooms and rotations,
  the anticipation-then-burst pacing, and the focal-anchor continuity across cuts are all motion behaviors.
  They live in the motion prompts and are detailed in `references/seedance-motion.md`. Note them at the
  storyboard stage so the motion prompts can carry them, but keep them out of the still frames (rule: no
  camera-movement cues in image prompts).

### Write the blocks (prompt structure)

Every image prompt has the same shape: the **frame description comes first**, then a **Style:** line, then
the Files-to-attach list. File references live inside the frame description; there is no separate character
or product line pasted above the prompt.

**The frame description** says what is in the frame, visualizing the VO line, with file references woven in
("the character from file 1", "same product as file 2"). It covers action, composition, expression, and
lighting continuity. It never describes the physical attributes of a referenced subject; those come from
the attached files (rule 3).

**The Style: line** carries the look. Write the chosen style descriptor in two separable parts:

- **Scene style** (always present): the render look, lighting, background, and palette that apply to every
  frame, plus the fixed technical constraints. This part stays byte-identical across every prompt.
- **Character rendering** (present only when a character is in the frame): the clause describing how
  characters are rendered in this style, for example "characters rendered as glossy porcelain-white
  skeletons with human eyes and hair". **Omit this clause entirely in any scene with no character.** A
  product-only or object-only frame should never carry character-rendering language; it just describes the
  style of the image it needs.

So the Style line reads: scene style, plus the character-rendering clause only if a character is present,
then the technical tail. Template:
> Style: [scene style descriptor][, plus the character-rendering clause only if a character is in this
> frame]. Background is a soft [brand] gradient [plus any style-specific backdrop]. Muted clean palette
> with [brand accent] accents. Vertical 9:16. No text, no watermark. Single static frame, no motion blur,
> no camera-movement cues.

The scene-style portion and the technical tail stay identical across prompts; varying their wording invites
drift. The character-rendering clause is the only movable part: included verbatim when a character is in
frame, dropped when none is. The character and product themselves are held constant by attaching the same
reference images every time, never by describing them.

### Reference-lock workflow (do this before mass-generating)

The only place a full physical description is written is the one-time prompt that creates a reference from
scratch, because at that moment there is nothing to attach yet.

1. **Product reference:** normally this is an uploaded product photo, so no description is needed at all;
   the photo is the reference. Lock it as **file 2**.
2. **Character reference:** if the character is uploaded, lock that image as **file 1** with no description.
   If the character must be generated, write one prompt that describes them in full (this is the single
   allowed description), generate a clean single-subject frame with a neutral expression, approve it, and
   lock that image as **file 1**. Never repeat that description in later prompts.
3. From then on, every character or product scene attaches those locked images and refers to them only as
   file 1 and file 2. This is what keeps the face and the product from changing across dozens of
   generations.

---

## Stage 4 - Write the starting-frame image prompts

One per clip. The frame must **visualize what the VO line is saying** at that moment. Specificity is a
credibility signal, so make every claim in the line something the viewer can see.

Rules for starting-frame (and all still) prompts:

- **No camera movement, no motion blur.** These are single still frames. Camera and motion language belong
  only in Stage 6.
- **Order: frame description first, then the Style: line, then the Files-to-attach list.** The frame
  description leads because it is the subject of the image; the style is the treatment applied to it.
- Weave file references into the frame description ("the character from file 1", "same product as file 2"),
  never by name. There is no separate character or product line above the prompt.
- The frame description covers action, composition, expression, and lighting continuity. It does not
  describe the physical attributes of the character or product; those come from the attached files. Writing
  "a small off-white pillow-shaped gum" instead of "same product as file 2" is the drift trap from rule 3.
- **Drop the character-rendering clause from the Style: line when no character is in the frame.** A
  product-only or object-only scene gets only the scene style, never "characters rendered as..." language.
- If the frame must match an object shown in an earlier generated frame, attach that image and say "same
  [object] as file [N]".
- End every prompt with a **Files to attach** list.

**Starting-frame prompt template:**
```
Frame description: [what is in frame, visualizing this clip's VO line, with file references woven in.
Composition, focal point, expression, lighting continuity. No physical-attribute description of referenced
subjects.]

Style: [scene style descriptor][, plus the character-rendering clause only if a character is in this
frame]. Background is a soft [brand] gradient [plus any style-specific backdrop]. Muted clean palette with
[brand accent] accents. Vertical 9:16. No text, no watermark. Single static frame, no motion blur, no
camera-movement cues.

Files to attach:
- file 1 = [character reference, or the prior generated frame this must match]
- file 2 = [product reference, if present]
```

### Continuity across scenes

The ZackDFilms look leans on fast educational cuts, so the clips have to feel like one continuous piece
rather than a set of unrelated shots. Two practices carry that continuity, and they matter more the shorter
and faster the cuts are:

- **Focal-anchor continuity.** Keep the hero subject anchored in a consistent screen position across
  consecutive scenes so the viewer's eye stays locked as the cut lands. If a subject is centered at the end
  of one beat, start the next beat with it centered too. Write the anchor into the frame description
  ("subject held centered", "product anchored center-frame") so adjacent frames line up.
- **Reference chaining.** To hold setting, character, and lighting steady from one scene to the next,
  attach the previous scene's approved frame as a reference for the next scene (as file 1, with the others
  shifting after it, per the standard file order). This is the single most effective way to stop the world
  from drifting between cuts. Use it whenever two consecutive scenes share a subject or location.

When you chain, remember rule 3: you are attaching the previous frame so the model can match it, not
describing what was in it. Say "same setting as file 1", never re-describe the room or the subject.

---

## Stage 5 - Write the ending-frame image prompts

Seedance can interpolate from a first frame to a last frame. When a clip contains a transformation (a
surface repairing, ingredients merging, a color shift), give it both frames so the change is controlled.

- **Attach the clip's own starting frame as file 1** and describe only what changed, using "same [subject]
  as file 1". Keep pose, camera framing, and lighting matched to the start frame so only the intended thing
  moves.
- **If the transformation resolves into the product or another referenced subject, reference that file, do
  not describe it.** A clip where scattered elements merge into the product should end on "same product as
  file 2", never on a prose description of the product. This is the exact spot the drift trap shows up, so
  attach the product as a second reference and point at it.
- Close with a short "what changed" note so the interpolation reads as one clean action rather than a
  scene cut.
- Same rules as Stage 4: no camera movement, frame description first then the Style: line then Files to
  attach, reference by file number, no describing the physical attributes of any referenced subject, and
  drop the character-rendering clause from the Style: line when no character is in the frame.

**Ending-frame prompt template:**
```
Frame description: Same [subject] as file 1, now [resolved state]. If it resolves into another referenced
subject, name that file, e.g. "now merged into a single unit that matches file 2". [Only the differences
from the starting frame: composition and lighting, not physical attributes.]

What changed from file 1: [one line, so the first-to-last interpolation is a clean single action]

Style: [scene style descriptor][, plus the character-rendering clause only if a character is in this
frame]. Background is a soft [brand] gradient [plus any style-specific backdrop]. Muted clean palette with
[brand accent] accents. Vertical 9:16. No text, no watermark. Single static frame, no motion blur, no
camera-movement cues.

Files to attach:
- file 1 = the generated starting-frame image of this clip
- file 2 = [product or other reference, if the resolved state must match one]
```

**Worked example (the ingredients-merge beat done right).** A clip where four floating ingredients merge
into the product, with no character in frame (so the Style: line carries no character-rendering clause):

> Frame description: Same scene as file 1, the four floating ingredient elements now merged into a single
> piece that matches file 2, resting on a soft pedestal, centered with a soft rim light. Same framing and
> lighting as file 1.
>
> What changed from file 1: the four converging elements have fused into one piece that matches file 2.
>
> Style: [scene style descriptor]. Background is a soft [brand] gradient. Muted clean palette with [brand
> accent] accents. Vertical 9:16. No text, no watermark. Single static frame, no motion blur, no
> camera-movement cues.
>
> Files to attach:
> - file 1 = this clip's starting frame (the four floating ingredients)
> - file 2 = the product reference image

Notice the product is never described. Its geometry, color, and texture live in file 2. Contrast the
broken version, which wrote "a small off-white pillow-shaped gum, roughly the size of a gum pellet" and so
generated a product that matched neither the real one nor the other scenes.

Not every clip needs an end frame. Simple beats (a held expression, a static hero shot) animate fine from
a single frame. Reserve end frames for clips with a real transformation.

---

## Stage 6 - Write the motion (image-to-video) prompts

One per clip. This is where camera and motion come back in, having been deliberately absent from the still
prompts.

**Read `references/seedance-motion.md` before writing this stage.** It carries the full prompt structure,
the camera-move vocabulary with speed language, the easing and lighting-continuity terms, and the
transformation-clip fallback. The summary below is the short version; the reference file is what makes the
prompts good. It is bundled inside this skill, so it travels with the skill and does not depend on any
other skill being installed.

- Prepend a **shared motion/style header** (the scene style descriptor plus: "Animate from the attached
  first frame, keeping character and product identical. Vertical 9:16, 30fps, smooth motion with natural
  ease-in and ease-out, zero jitter. No text, no watermark."). Motion prompts drive Seedance or Kling from
  an already-generated frame, so the description-before-style ordering that the still prompts use does not
  apply here; lead with the style/continuity header as shown.
- Describe **one continuous beat**: what moves, the camera move (push-in, slow orbit, lateral track, static
  hold with internal motion, etc.), and the duration carried straight from the Stage 2 timing map.
- Keep the motion achievable from the single starting frame. Do not ask for a scene change that contradicts
  the frame.
- **Flag transformation-heavy clips.** Surface-repair or film-clearing beats are the ones most likely to
  make the model warp the geometry. Note a fallback (reduce to a single light sweep) in case it drifts.

**Motion prompt template:**
```
[shared motion/style header]

[Duration]. [Camera move]. [What animates, one continuous beat, matched to the VO line.]

Files to attach:
- file 1 = this clip's starting frame
- file 2 = this clip's ending frame (only if using first-to-last interpolation)
```

---

## Stage 7 - Assembly and post

- Generate each clip slightly longer than its target and trim the handles so cuts land cleanly on the
  voiceover.
- **Do not speed-ramp a VO-timed ad.** The usual UGC step of running footage at 1.2x will desync a scripted
  voiceover. For these ads, trim silences only and leave the speed at 1.0x.
- Assemble in clip order against the VO. Confirm each visual beat lands on its line.

---

## Quick checklist

- [ ] Script adapted to the product's real mechanism, real proof, real guarantee (no borrowed numbers)
- [ ] Compliance-safe claim substitutions applied
- [ ] Clips cut on meaning, 3-5s each, timing map built
- [ ] Scene style descriptor written once and reused verbatim; character-rendering clause kept separable
- [ ] Character and product reference images locked before mass generation
- [ ] Every subject referred to as "file N", never by name
- [ ] No prompt describes the physical attributes of the character or product; both are referenced by file
- [ ] Image prompts lead with the frame description, then a "Style:" line, then the Files-to-attach list
- [ ] The character-rendering clause appears in the Style: line only when a character is in the frame
- [ ] Every image prompt ends with a Files-to-attach list that matches the prompt text
- [ ] Still prompts contain no camera movement; motion prompts contain the camera moves
- [ ] End frames only where there is a real transformation, attaching the start frame as file 1
- [ ] Motion durations carried from the timing map; no speed-ramp on VO-timed ads
