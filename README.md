# Ad Generator

A browser app that turns hand-written prompts into a set of approved animated video clips, using the
kie.ai API. **The app does not write anything** — you write the script, storyboard, and all the image and
motion prompts yourself (steps 1–6 of your process) and paste finished prompts in. The app's job is
generation: manage a labeled library of reference images, attach those references to Nano Banana Pro by
file number so scene/character/product stay consistent, generate the scene images, animate them with
Kling 3, and let you approve, regenerate, and download.

## Use it in the browser (GitHub Pages)

**https://scale-science.github.io/animated-video-ads/**

No install. The page runs entirely in your browser and calls kie.ai directly. On first visit, paste your
`KIE_API_KEY` into the key panel — it is stored only in your browser's localStorage and sent only to
kie.ai. Projects and generated media also live in your browser (localStorage + IndexedDB), so come back to
a project in the same browser and profile. Keep the tab open while generating; reopening a project
re-attaches to in-flight kie.ai tasks, so nothing paid for is lost.

There's also a **🍌 Quick batch generator** (`banana.html`) for firing off a pile of one-off Nano Banana
prompts without the full project structure.

## The flow

Each stage gates the next; nothing generates until you ask.

1. **Library** — build a labeled set of reference images, each with a hosted kie.ai URL. Upload product
   photos (labelled, e.g. "gum piece", "pouch"). Add characters by pasting a character prompt with a label
   and generating them (regenerate until right, then approve), or upload a finished character image
   directly. A generated character can itself attach other library references as its `image_input`.
2. **Scenes** — paste **all** scene prompts into one field. Each prompt starts with a header like
   `**P1 — Title** *(Speaker: "line")*`. The app splits them into cards, and for each `file N` reference in
   a prompt it **auto-maps** the file number to a library asset (from a `Files: N = label` line or by
   matching the label text). You confirm or override each slot from the labeled library — or point a slot
   at an earlier scene's approved frame for continuity. Edit any prompt inline, then generate all images
   (Nano Banana Pro, 2K, 9:16). Approve or regenerate each. **The prompt text is sent exactly as written —
   the app never rewrites it;** it only supplies the ordered reference URLs in `image_input`.
3. **Videos** — unlocks when every scene image is approved. Paste **all** motion prompts (same P1, P2
   numbering); the app matches each to its scene by id and flags any mismatch. Set a per-scene or default
   duration, optionally pick a last frame, then animate each approved frame with Kling 3 (pro, 9:16). Sound
   is off by default (add your VO in the editor). Approve or regenerate each clip.
4. **Export** — download all approved clips (and/or images) as a zip, named by scene order so they drop
   into an editor in sequence.

## The core idea

Attach reference images to Nano Banana and refer to them inside prompts as file 1, file 2, file 3 — never
by re-describing them. File numbering is **per scene** (there is no fixed "character = file 1"): each scene
attaches only the references it uses, in the order its prompt cites them. That is what keeps every face and
the product consistent across dozens of generations.

## Notes

- **kie.ai models**: images via `nano-banana-pro` (2K, 9:16, png); video via `kling-3.0/video` (pro mode).
  All generation is async — the app polls task status and backs off on 429s. Uploaded reference URLs expire
  after ~3 days; the app keeps local copies and re-uploads automatically when a URL goes stale.
- **Failure isolation**: a failed item shows its error on its card and never aborts the batch; retry just
  that one.
- **Repo layout**: `index.html` + `assets/` is the browser app (served by GitHub Pages); `banana.html` is
  the quick batch tool; `animated-video-ad-pipeline/` is the prompt-writing skill (a reference for *you*
  when writing prompts, not used by the app at runtime). The `server/` + `public/` Node app is the older
  storyboard-generation flow and is **not** kept in sync with this rewrite.
