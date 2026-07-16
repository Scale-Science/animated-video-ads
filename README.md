# Animated Ad Pipeline

A human-in-the-loop app that turns a pasted video ad script into a set of approved animated video
clips, using the kie.ai API for image (Nano Banana Pro) and video (Kling 3.0) generation and the
Anthropic API for the script → storyboard step.

The prompt-writing logic lives in [animated-video-ad-pipeline/SKILL.md](animated-video-ad-pipeline/SKILL.md)
and [animated-video-ad-pipeline/references/seedance-motion.md](animated-video-ad-pipeline/references/seedance-motion.md).
Both files are loaded at runtime, so editing the skill changes the app's output — nothing is hardcoded.

## Use it in the browser (GitHub Pages)

**https://scale-science.github.io/animated-video-ads/**

No install needed. The page runs entirely in your browser and talks to kie.ai and Anthropic
directly. On first visit, paste your `KIE_API_KEY` and `ANTHROPIC_API_KEY` into the **API keys**
panel — they are stored only in your browser's localStorage and sent only to kie.ai / Anthropic,
never to any other server (GitHub Pages is static hosting; there is no backend).

Things to know about the browser version:

- **Everything lives in your browser.** Projects are saved in localStorage and generated
  images/clips are cached in IndexedDB. Use the same browser + profile to come back to a project;
  clearing site data deletes your projects.
- **Keep the tab open while generating.** Task polling runs in the page. If you close the tab
  mid-generation, reopening the project re-attaches to in-flight kie.ai tasks — nothing paid for
  is lost, since task ids are persisted before polling starts.
- **Export** builds the zip client-side from the cached clips.

## Or run it locally (Node server)

```sh
npm install
cp .env.example .env   # fill in KIE_API_KEY and ANTHROPIC_API_KEY
npm start              # open http://localhost:3000
```

The local version keeps everything on disk under `projects/` (survives browser data clears, easy
to back up) and resumes in-flight tasks on server restart. Both versions share the same storyboard
prompts and schemas via [shared/storyboard-core.js](shared/storyboard-core.js).

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

- **Upload expiry** — kie.ai file uploads are deleted after ~3 days; the app keeps local copies as
  the source of truth and transparently re-uploads any reference whose URL is older than 60 hours.
- **Cost visibility** — the header shows running image/video generation counts.
- **Failure isolation** — a failed scene shows its error on its card and never aborts the batch;
  retry just that scene.
- **Repo layout** — `index.html` + `assets/` is the static browser app (served by GitHub Pages);
  `server/` + `public/` is the local Node app; `shared/` is prompt logic used by both;
  `animated-video-ad-pipeline/` is the skill (source of truth for prompt style).
