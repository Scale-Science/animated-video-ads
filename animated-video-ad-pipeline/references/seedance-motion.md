# Seedance 2.0 motion prompt reference (condensed, animation-locked)

Read this at Stage 6 of the pipeline, when turning a locked still frame into a clip. It is a condensed,
animation-focused cut of the broader Seedance craft. The photorealistic material-science vocabulary is
deliberately left out, because the look here is one fixed chosen animation style and the frame is already
locked. What matters at this stage is motion, camera, easing, and light behavior, not re-describing
surfaces the still frame already establishes.

Seedance 2.0 runs on Higgsfield or Kie.ai. The model is the same across platforms. It handles image-to-video
from a single first frame, or from a first frame plus a last frame for a controlled interpolation.

---

## Image-to-video prompt structure

The still frame already carries subject, materials, palette, and composition. So the motion prompt should
not re-describe the scene in full. It should describe what moves and how the camera behaves, and reassert
only the style constraints that keep the render on-model.

Order the prompt like this:

1. **Style/continuity header.** The scene style descriptor from the pipeline, plus: "Animate from the
   attached first frame, keeping character and product identical. Vertical 9:16, 30fps, smooth motion with
   natural ease-in and ease-out, zero jitter. No text, no watermark."
2. **Duration.** In seconds, carried from the Stage 2 timing map. Seedance works best at 2 to 10 seconds
   per clip; these clips sit at 3 to 5s.
3. **Camera move.** One move per clip. See the vocabulary below.
4. **What animates.** One continuous beat. Describe the single action that plays out over the duration,
   matched to the voiceover line.
5. **Files to attach.** first frame as file 1, and the last frame as file 2 if using interpolation.

Keep it to one idea. A clip that tries two camera moves or two actions will look busy and tends to drift.

---

## Camera moves (with speed language)

Seedance interpolates camera motion smoothly with no jitter, so lean on that. Name the move and give it a
speed or feel. Useful moves for this kind of explainer ad:

- **Slow push-in / dolly forward.** Camera eases toward the subject, framing held. Builds intimacy and
  focus. Good default for a single hero subject or a reveal. Keep it gentle, roughly a 5 to 15 percent
  size change over the clip.
- **Slow orbital rotation.** Camera arcs around the subject at a constant distance. Keep it slow and
  majestic, on the order of 15 to 30 degrees across a short clip, not a full spin. Good for product hero
  moments and for showing a repaired or finished object.
- **Ascending crane.** Camera rises and tilts slightly down, revealing a bit more of the scene. Good for
  endings and for a small sense of scale.
- **Lateral track.** Camera slides left or right at a smooth, even pace. Good for environment beats like a
  clinic interior or a shelf of product.
- **Focus-shift (rack focus).** Camera position holds; focus moves from one plane to another. Good for
  directing attention without moving, for example from a floating element to the subject behind it.
- **Static hold with internal motion.** Camera locked; only the subject or an effect moves. The safest
  choice for a talking or expressive character beat, and for anything where camera drift would fight the
  locked frame.

The moves above are the calm-explainer defaults. The ZackDFilms look adds a more energetic set. Use these
when the tone calls for it (educational, punchy, high-pace); keep them off for calm, premium ads:

- **Living macro camera (handheld float).** A locked composition given subtle, continuous floating drift
  and small depth swings, as if shot handheld through a macro lens. Keeps a "still" shot alive without a
  real move. This is the default ZackDFilms feel for a held beat, in place of a dead-static hold.
- **Whip zoom or whip rotation.** A fast, energetic push or rotation that snaps toward a focal point (a
  character's head, an impact point, a key detail), settling quickly. Use it to open a beat with energy or
  to punch in on the thing the VO just named. One whip per clip; it is the whole move, not a garnish.
- **Cross-section cutaway reveal.** The camera pushes through or past a surface to reveal hidden action
  underneath while the surface stays visible (through a tooth, a material, the ground). Pairs with the
  cross-section framing from the still stage; use it on mechanism beats.

**Pacing matches tone.** Move speed is a tone dial, not a fixed rule. Calm and premium wants slow, gentle
moves. The ZackDFilms educational style wants quicker moves, whip transitions, and the anticipation-burst
timing below. Set the speed to the project's tone note rather than defaulting everything to slow.

Always ask for ease-in and ease-out rather than linear motion (even fast moves ease at their ends). Easing
is what makes CG camera motion feel intentional instead of robotic.

---

## Motion and easing

- Describe motion procedurally and physically: elements "drift," "settle," "knit together," "sweep,"
  "absorb," "pulse," "bloom." Give a direction and a resolution (for example, "sweeps left to right, then
  settles").
- Keep the motion inside what the single frame can plausibly produce. Do not ask for a new object or a
  scene change that the starting frame does not contain, unless you are supplying a matching last frame.
- Glows and light effects should have a life cycle: they build, peak, and fade, rather than flashing on.
  "A soft glow builds around the piece and settles" reads better than "glowing."
- For particle behavior, give a rough density and speed and a settling point, not just "particles."
- **Anticipation then burst (ZackDFilms timing).** For a beat with force or reveal, split the motion into a
  slow, held preparation followed by a sudden rapid action, then a quick settle. "Holds still, then snaps
  forward and settles" reads with far more energy than one even move. This exaggerated timing is a core
  part of the ZackDFilms feel; use it on impact, launch, and reveal beats.
- **Secondary motion.** Have small elements react to the main action: dust, particles, or debris kicking up
  on an impact, a soft settle of nearby elements, a ripple from a snap. Secondary motion sells the physics
  and keeps the frame from feeling rigid.
- **Idle life.** Even on a held beat, give the subject small living motion, a slight breath, a micro-shift,
  a subtle settle, so it is never frozen. A completely still subject reads as a paused image, not a clip.

---

## Lighting continuity language

The still frame sets the lighting. The motion prompt mostly needs to preserve it, not redesign it. When a
light effect is part of the action, describe its behavior in continuity terms:

- Keep the key, fill, and rim consistent with the frame; the mood is soft studio light with gentle shadows.
- A rim or edge light can "catch" a moving object as it settles, which reads as premium.
- Color the effect light to the brand accent so it fits the palette (whatever the ad's accent color is).
- Avoid introducing a new hard light source mid-clip; it makes the render feel like it cut to a different
  scene.

---

## The first two seconds (opening clips)

The opening clip of the ad has to stop the scroll. Front-load the visual interest in the first beat: the
strongest single image, the boldest motion, the highest contrast. A slow push-in onto a striking hero
subject, or a quick satisfying transformation, both work. Save the calm, explanatory beats for the middle
of the ad once attention is earned.

---

## Continuity across cuts

The ZackDFilms style runs on short shots and fast cuts, so the clips have to read as one continuous piece.
The motion side of that continuity:

- **Focal-anchor continuity.** Keep the hero subject in a consistent screen position from the end of one
  clip to the start of the next, so the eye stays locked through the cut. If a clip ends with the subject
  centered, the next should open with it centered. This is the motion-stage partner to the focal-anchor
  framing set in the still frames.
- **Match the cut to the voiceover.** Shot lengths should track the VO's pace: a fast, list-like passage
  wants short punchy clips, a calm explanatory line wants a longer hold. Cut on the beat of the narration,
  not on a fixed timer.
- **Whip transitions live in the edit.** A whip pan or zoom that carries from one shot into the next is
  usually built in post by butting a clip that ends on a whip-out against one that begins on a whip-in,
  not generated as a single clip. Plan for it by ending and starting the adjacent clips on a matching fast
  move toward the same side or focal point.
- **Hold the light and world steady.** Keep lighting direction, color, and background consistent from clip
  to clip. A shift in key light or background tone across a cut reads as a scene change and breaks the
  continuous feel.

---

## Transformation clips: the fallback

Clips where a surface changes over time (a scratched surface smoothing, a dull finish brightening, a
cracked object sealing, a film lifting to reveal what is under it) are the ones most likely to make the
model warp the geometry, because it is animating structure, not just position. Two safeguards:

1. Prefer a first-frame-plus-last-frame interpolation for these, so the model has both endpoints and only
   has to fill the middle. Attach the start frame as file 1 and the end frame as file 2.
2. If it still drifts, simplify the described motion to a single light sweep passing over the subject,
   rather than a full particle-knit or dissolve. A clean sweep that implies the change holds shape far
   better than a literal rebuild that warps.

---

## Duration and frame rate

- Duration per clip: 3 to 5 seconds here, always at or under Seedance's per-clip limit (roughly 15s).
- Frame rate: 30fps is the default for this social format. 24fps reads more filmic, 60fps more hyper-smooth;
  pick one and keep it consistent across the ad.
- Generate each clip slightly longer than its target so there are handles to trim against the voiceover in
  post. Do not speed-ramp a voiceover-timed ad; trim silences only and leave playback at 1.0x.
