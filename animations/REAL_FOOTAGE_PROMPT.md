Rebuild the MedLab Instagram animation using real product screenshots instead of
the recreated CSS mockup.

## Context

`animations/` (repo root of AI-Receptionist) already has a working render
pipeline and two mp4s built entirely from hand-drawn HTML/CSS approximations
of the product:
- `animations/render.mjs` — Playwright records a scene HTML file at 1080x1920,
  ffmpeg-static (bundled, no system install) transcodes the capture to mp4.
  Run `node render.mjs <scene>.html` from inside `animations/`, or
  `node render.mjs` with no args to render every scene in its `catalog`.
- `animations/scenes/medlab-demo.html` — intro → incoming call → fake chat
  transcript → fake dashboard mockup → end card, ~14s, all invented UI.
- `animations/scenes/ava-brand.html` — abstract brand/voice-pulse piece, no
  product UI, doesn't need touching for this task.
- Brand system used throughout: indigo/blue gradient `#4f46e5→#2563eb`, navy
  `#0f172a` panels, emerald pulse `#34d399`, IBM Plex Sans/Mono fonts. Keep
  matching this for any new UI chrome (frames, labels, callouts) you add.

The mockup dashboard/chat beats look fake because they are — they're
recreated from scratch, not the real product. This task replaces those two
beats with actual screenshots of the running product so the demo reads as
real, not staged.

## Assets

Real screenshots will be dropped in `animations/assets/screenshots/`. Expect
roughly (confirm actual filenames present — don't assume all exist):
- A dashboard/console screenshot (medlab-web's Call Logs or Overview screen —
  ideally showing a live booking row).
- A screenshot of the bot's greeting / first reply on a text channel (SMS or
  WhatsApp), showing the AI-disclosure line.
- Possibly a compliance page screenshot (HIPAA guardrails / emergency
  redirect KPI) or a call-log detail view.

Look at what's actually in that folder before writing any code — don't guess
contents from filenames alone; open each image to see its real resolution,
aspect ratio, and what UI chrome (browser bar, mobile status bar) is already
baked into the screenshot.

## Task

1. Read `animations/scenes/medlab-demo.html` first — reuse its intro and
   incoming-call beats and its cue-timeline approach (a `<script>` at the
   bottom with an absolute-ms cue list calling `show()`/`hide()`/`on()` to
   toggle classes — NOT nested CSS `animation-delay`, which was tried first
   and is broken: the `animation` shorthand resets `animation-fill-mode`,
   causing screens to never properly hide and bleed into each other).

2. Build a new scene, `animations/scenes/medlab-demo-real.html` — don't
   overwrite the existing mockup version; we want both to compare.

3. Replace the fake chat-transcript beat with the real greeting screenshot:
   present it inside a simple phone-frame (rounded rect, subtle border/shadow
   in the brand system), full-bleed or with a slow Ken-Burns zoom/pan via CSS
   transform so a static image doesn't feel dead on video. If the screenshot
   is small/low-res, don't upscale aggressively — crop tighter instead.

4. Replace the fake dashboard beat with the real dashboard screenshot:
   same treatment — frame it, then zoom/pan toward the actual booking
   row/badge in the image. If you want a callout (arrow or highlight ring)
   pointing at a specific real element, draw it as an absolutely-positioned
   overlay div with a hand-picked pixel offset — check that offset against
   the actual screenshot rather than guessing coordinates.

5. Add the new scene to the `catalog` object in `animations/render.mjs` with
   a duration that fits the real content (don't just copy the old 14000ms —
   fewer beats now, likely shorter).

6. Render it (`node render.mjs medlab-demo-real.html` from `animations/`) and
   verify correctness the same way the original was verified: use ffmpeg to
   extract a handful of frames across the real output duration (reported
   duration may run short of the intended wait time — Chromium's video
   recorder is variable-frame-rate and compresses static stretches, this is
   expected, not a bug) and actually look at the frames — don't declare done
   without visually checking for overlap/bleed-through bugs like the ones the
   first version had.

## Constraints

- Keep output at 1080x1920 (matches the existing two mp4s — Reels/Stories).
- Don't touch `medlab-demo.html` or `ava-brand.html`.
- No new npm dependencies — Playwright + ffmpeg-static already cover this.
