# Animated Ad Pipeline

A local, human-in-the-loop app that turns a pasted video ad script into a set of approved animated
video clips, using the kie.ai API for image (Nano Banana Pro) and video (Kling 3.0) generation and
the Anthropic API for the script → storyboard step.

The prompt-writing logic lives in [animated-video-ad-pipeline/SKILL.md](animated-video-ad-pipeline/SKILL.md)
and [animated-video-ad-pipeline/references/seedance-motion.md](animated-video-ad-pipeline/references/seedance-motion.md).
Both files are read from disk at runtime, so editing the skill changes the app's output — nothing is
hardcoded.

## Setup

```sh
npm install
cp .env.example .env   # then fill in KIE_API_KEY and ANTHROPIC_API_KEY
npm start              # open http://localhost:3000
```

## The flow

Each stage is gated on explicit approval — nothing generates until you approve the stage before it.

1. **Setup** — set the visual style, brand accent, aspect ratio; upload (or generate in-app) the
   locked character reference and product photos. These become the skill's file 1 / file 2 anchors.
2. **Storyboard** — paste the timestamped VO script. Claude, primed with the two skill files,
   returns a scene-by-scene storyboard: timing, VO line, starting-frame prompt, motion prompt,
   ordered reference list, and end-frame prompts for transformation scenes. Edit any field inline,
   regenerate a single scene (optionally with a note), or regenerate the whole board. Approve to unlock frames.
3. **Frames** — one click submits every scene's starting frame (Nano Banana Pro, 2K). Transformation
   scenes also get an end frame, generated after the start frame lands (the skill attaches the start
   frame as file 1). Approve/regenerate per image or approve all.
4. **Videos** — unlocks when every frame is approved. Each scene renders on Kling 3.0 (pro mode)
   with its motion prompt, approved start frame, end frame for transformations, and its duration
   from the timing map. Sound is off by default (ads are timed to a separate VO). Approve/regenerate per clip.
5. **Export** — download all approved clips as a zip, named `01-scene-01.mp4`, `02-scene-02.mp4`, …
   so they drop into an editor in sequence.

## Notes

- **Persistence / resumability** — everything lives in `projects/<id>/project.json` plus asset
  folders. If the server restarts mid-batch it re-attaches to in-flight kie.ai task ids on boot.
  Approved assets are never regenerated.
- **Upload expiry** — kie.ai file uploads are deleted after ~3 days; the app keeps local files as
  the source of truth and transparently re-uploads any reference whose URL is older than 60 hours.
- **Cost visibility** — the header shows running image/video generation counts.
- **Failure isolation** — a failed scene shows its error on its card and never aborts the batch;
  retry just that scene.
- **Config** — `.env`: `KIE_API_KEY`, `ANTHROPIC_API_KEY`, optional `PORT` and `STORYBOARD_MODEL`
  (defaults to `claude-opus-4-8`).
