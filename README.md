# F‑UJI — Professional Film Color

A zero-dependency photo editor PWA for iPhone: import a photo, apply real
Fujifilm film simulations and camera-style settings (DR, tone curve, colour,
grain, Color Chrome), save them as recipes, export. Everything runs on-device —
no account, no uploads, no build step.

The app **is** the files in this repo:

```
index.html          the whole shell (home, editor, sheets)
css/app.css         styling
js/processing.js    WebGL2 engine + CPU fallback + the colour math (FUJI.math)
js/profiles.js      film-simulation catalog (FUJI.profiles)
js/state.js         canonical adjustment model, undo/redo (FUJI.State)
js/session.js       resume-last-edit via IndexedDB
js/recipes.js       user recipes + favorites (localStorage)
js/fujiRecipes.js   bundled real Fujifilm recipes
js/context.js       on-device EXIF reader + pixel scene analysis
js/ui.js            toolbar, sheets, controls, export
js/main.js          bootstrap, render loop, gestures, crop, export
sw.js               offline app shell (precache + network-first for code)
manifest.json       PWA manifest
vercel.json         deployment config (serves the repo root)
```

## Run it locally

```bash
npm start            # → http://localhost:8080  (PORT=3000 npm start to change)
```

`npm start` serves with `no-cache` headers so the service worker always sees a
fresh `sw.js` — a cached worker is the usual reason an edit appears to do
nothing on iOS. To test offline mode: load the page once, then reload with the
network disabled.

## Test it

```bash
npm test             # full suite (~100 assertions, ~11s, zero dependencies)
npm run lint         # syntax + module-shape checks on every shipped file
npm run check        # assets/PWA integrity + syntax
node test/run.js exif sw   # filter suites by filename substring
```

There are no npm packages in this project — `test/run.js` is plain Node using
`node:vm`, `node:assert` and a ~50-line harness (`test/harness.js`). Each
`*.test.js` file also runs on its own: `node test/exif.test.js`.

### What the suite guards

| Suite | Protects |
| --- | --- |
| `syntax` | every file compiles standalone; IIFE + `"use strict"` module shape; no ESM syntax; ES2017-safe `sw.js` |
| `assets` | index.html ↔ disk ↔ `sw.js` precache ↔ manifest ↔ `vercel.json` are all in sync |
| `modules` | the app boots in a stub DOM; every `#id` a handler queries exists; every cross-module `App.*` / `FUJI.*` reference resolves; import → render → WB → crop → resume → export flows |
| `state` | undo/redo/autosave semantics; **every slider path in `js/ui.js` exists on the state model**, and every model leaf is reachable from the UI |
| `recipes` | localStorage persistence, corrupt-storage recovery, intensity scaling, favorites, import/export, undo after applying a recipe |
| `engine` | colour math: matrices, curves, white balance, HSL; `bakeParams()` stays finite at *every* slider extreme (a NaN uniform renders a black photo); CPU fallback paints a real frame; Fuji recipe catalog and scene suggestions |
| `session` | resume round-trip through IndexedDB, expiry, cache-token invalidation |

Two invariants are worth keeping in mind when editing:

1. **Anything `index.html` loads must also be in `sw.js`'s `ASSETS`.** The
   `assets` suite fails otherwise, because a cold offline launch would boot
   without the cached script and die.
2. **UI controls must write real state paths.** Sliders push `path:'group.key'`
   strings straight into `FUJI.defaultState()`; a typo is silently ignored by
   the render pipeline, so `state.test.js` resolves them all.

## CI

`.github/workflows/node.js.yml` runs `npm ci && npm run lint && npm test` on
Node 18/20/22 for pushes and PRs to `main`. `npm ci` is kept so the (empty)
lockfile is verified — if a dependency is ever added without a lockfile, CI
says so loudly instead of at deploy time.

## Notes

* WebGL2 is used when available; `FUJI.createEngine()` falls back to
  `CPUEngine`, which shares the same `bakeParams()` numbers, so old devices and
  the CI suite exercise identical colour math.
* EXIF is parsed by hand (`js/context.js`) — JPEG APP1 + TIFF, both byte
  orders, with rational/GPS decoding. No metadata leaves the device.
