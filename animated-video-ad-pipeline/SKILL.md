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

## Stage 3 - Choose the style, then lock the reference blocks

First choose one visual style for the whole ad. Then write the reusable blocks once and paste the relevant
ones into every image prompt. Consistency comes from reusing identical block text plus attaching identical
reference images.

### Choose a style

Pick one style and keep it fixed across every frame; do not mix styles within a single ad. Ask the user for
a preference. If they have none, default to the polished-3D (ZackDFilms) look. Each preset below is a
one-line **style descriptor** that slots into the STYLE block. Use one as written, or write a custom
descriptor in the same spirit.

- **Polished 3D (ZackDFilms):** "Polished 3D animated explainer in the style of ZackDFilms. Smooth
  semi-realistic render, softly stylized proportions, clean detailed skin with subtle freckles, gentle
  studio lighting with soft shadows, shallow depth of field." Optional backdrop: a faint blueprint grid.
- **Claymation / plasticine:** "Handmade claymation look, plasticine texture with subtle fingerprint
  detail, tactile matte surfaces, stop-motion charm, soft even lighting."
- **Cel-shaded 2.5D:** "Cel-shaded animation, bold clean outlines, flat color fills with defined shadow
  boundaries, graphic-novel look with a sense of depth."
- **Stylized realism:** "Grounded, near-realistic proportions and lighting with slightly heightened color
  and clean premium surfaces, understated and modern."
- **Low-poly:** "Low-poly geometric forms, faceted surfaces, flat or simple gradient fills, minimalist and
  contemporary."

For a custom style, write the descriptor as one vivid sentence naming the render look, the proportions, and
the lighting feel, then reuse it verbatim.

### Write the reference blocks

Three blocks get pasted into image prompts. The STYLE block is text and appears in full every time. The
CHARACTER and PRODUCT blocks are pure file references and carry no physical description, because the look
of the character and product is supplied by the attached reference images, not by words. See rule 3 in the
core convention: describing the subject in a scene prompt is what causes drift.

**STYLE block** (paste into every image prompt). Drop in the chosen style descriptor and keep the technical
constraints as-is:
> [chosen style descriptor]. Background is a soft [brand] gradient [plus any style-specific backdrop, for
> example the blueprint grid on the ZackDFilms look]. Muted clean palette with [brand accent] accents.
> Vertical 9:16. No text, no watermark. Single static frame, no motion blur, no camera-movement cues.

**CHARACTER block** (reference only, never described):
> The character from file 1.

**PRODUCT block** (reference only, never described):
> Same product as file 2.

The STYLE descriptor is the one piece of text that must stay byte-identical across every prompt; varying
its wording invites the render to drift. The character and product are held constant by attaching the same
reference images every time, not by repeating a description. Do not write out the product's geometry,
color, size, texture, or packaging in a scene or end-frame prompt. If a beat needs the product to look a
certain way, that belongs in the locked reference image, not in the prompt text.

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
- Lead with the STYLE block, then the CHARACTER and/or PRODUCT blocks as needed, then the frame-specific
  description.
- Refer to any recurring subject as "the character from file 1" / "same product as file 2", never by name.
- The frame description covers action, composition, expression, and lighting continuity. It does not
  describe the physical attributes of the character or product; those come from the attached files. Writing
  "a small off-white pillow-shaped gum" instead of "same product as file 2" is the drift trap from rule 3.
- If the frame must match an object shown in an earlier generated frame, attach that image and say "same
  [object] as file [N]".
- End every prompt with a **Files to attach** list.

**Starting-frame prompt template:**
```
[STYLE block]
[CHARACTER block if the character is in frame]
[PRODUCT block if the product is in frame]

Frame description: [what is in frame, visualizing this clip's VO line. Composition, focal point,
expression, lighting continuity.]

Files to attach:
- file 1 = [character reference, or the prior generated frame this must match]
- file 2 = [product reference, if present]
```

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
- Same rules as Stage 4: no camera movement, Files-to-attach list, reference by file number, no describing
  the physical attributes of any referenced subject.

**Ending-frame prompt template:**
```
[STYLE block]
[CHARACTER / PRODUCT blocks as needed]

Frame description: Same [subject] as file 1, now [resolved state]. If it resolves into another referenced
subject, name that file, e.g. "now merged into a single unit that matches file 2". [Only the differences
from the starting frame: composition and lighting, not physical attributes.]

What changed from file 1: [one line, so the first-to-last interpolation is a clean single action]

Files to attach:
- file 1 = the generated starting-frame image of this clip
- file 2 = [product or other reference, if the resolved state must match one]
```

**Worked example (the ingredients-merge beat done right).** A clip where four floating ingredients merge
into the product:

> [STYLE block]
> The character from file 1.
> Same product as file 2.
>
> Frame description: Same scene as file 1, the four floating ingredient elements now merged into a single
> piece that matches file 2, resting in the character's open palm, centered with a soft rim light. Same
> framing and lighting as file 1.
>
> What changed from file 1: the four converging elements have fused into one piece that matches file 2.
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

- Prepend a **shared motion/style header** (the STYLE block plus: "Animate from the attached first frame,
  keeping character and product identical. Vertical 9:16, 30fps, smooth motion with natural ease-in and
  ease-out, zero jitter. No text, no watermark.").
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
- [ ] STYLE / CHARACTER / PRODUCT blocks written once and reused verbatim
- [ ] Character and product reference images locked before mass generation
- [ ] Every subject referred to as "file N", never by name
- [ ] No prompt describes the physical attributes of the character or product; both are referenced by file
- [ ] Every image prompt ends with a Files-to-attach list that matches the prompt text
- [ ] Still prompts contain no camera movement; motion prompts contain the camera moves
- [ ] End frames only where there is a real transformation, attaching the start frame as file 1
- [ ] Motion durations carried from the timing map; no speed-ramp on VO-timed ads
