# Attributions

SPLICE is built from patterns and, where noted, vendored component source from the
following open-source projects. Cloned research repositories live only under `.design/`
and are **not** shipped in the app or Docker image.

## Design intelligence (research only, not shipped)
- [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) — MIT. Ran `search.py --design-system` for "cinematic dark editor", "video studio premium", "creative tool editorial". Adopted process rules (contrast, focus, reduced motion, breakpoints, SVG icons); rejected its suggested palettes in favor of the brief's art direction.
- [anthropics/skills](https://github.com/anthropics/skills) — see `THIRD_PARTY_NOTICES.md` in that repo. Read `frontend-design` and `webapp-testing` skills; adopted the two-pass critique method and reconnaissance-then-action Playwright workflow.

## UI component patterns (license-compatible copies / dependencies)
- [magicuidesign/magicui](https://github.com/magicuidesign/magicui) — MIT. Marquee, Shimmer, BorderBeam, DotPattern patterns.
- [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits) — MIT. ShinyText, BlurText, Aurora patterns.
- [ibelick/motion-primitives](https://github.com/ibelick/motion-primitives) — MIT. Text/Blur/Spotlight effects.
- [shadcn-ui/ui](https://github.com/shadcn-ui/ui) — MIT; [radix-ui/primitives](https://github.com/radix-ui/primitives) — MIT. Accessible primitives, fully restyled to SPLICE tokens.
- [emilkowalski/sonner](https://github.com/emilkowalski/sonner) — MIT (toasts + undo); [emilkowalski/vaul](https://github.com/emilkowalski/vaul) — MIT (drawers); [pacocoursey/cmdk](https://github.com/pacocoursey/cmdk) — MIT (⌘K); [formkit/auto-animate](https://github.com/formkit/auto-animate) — MIT; [barvian/number-flow](https://github.com/barvian/number-flow) — MIT.
- [darkroomengineering/lenis](https://github.com/darkroomengineering/lenis) — MIT; [greensock/GSAP](https://github.com/greensock/GSAP) — standard "no charge" license for standard use (ScrollTrigger; SplitText is a Club plugin — we implement our own split-text effect, named `splitLines`, not GSAP SplitText); [motiondivision/motion](https://github.com/motiondivision/motion) — MIT; [lucide-icons/lucide](https://github.com/lucide-icons/lucide) — ISC.
- [pmndrs/zustand](https://github.com/pmndrs/zustand) — MIT; [jakearchibald/idb-keyval](https://github.com/jakearchibald/idb-keyval) — MIT.
- [@fontsource-variable/unbounded](https://fontsource.org), `space-grotesk`, `ibm-plex-mono` — SIL Open Font License 1.1.

## Media / infrastructure
- [FFmpeg](https://ffmpeg.org) — LGPL 2.1+ / GPL builds; installed by the OS package manager in Docker.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — Unlicense, downloaded as a release binary in Docker. Used only for user-directed imports; no DRM circumvention.
- [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) — Apache-2.0 (`@ffmpeg/ffmpeg` 0.12.x).
- [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe) — Apache-2.0 (Tasks Vision FaceDetector); [tesseract.js](https://github.com/naptha/tesseract.js) — Apache-2.0. Browser-side analysis offload.
- [fastify/fastify](https://github.com/fastify/fastify) — MIT; [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) — MIT; [colinhacks/zod](https://github.com/colinhacks/zod) — MIT.
- [vitejs/vite](https://github.com/vitejs/vite) — MIT; React — MIT; TypeScript — Apache-2.0; Tailwind CSS — MIT.
- [alexta69/metube](https://github.com/alexta69/metube) — MIT; [imputnet/cobalt](https://github.com/imputnet/cobalt) — AGPL-3.0. Studied architecture and error-copy patterns only; no code copied (AGPL avoided).

## Generated assets
All background loops and music beds are generated at build/runtime by our own code
(`scripts/synth-music.mjs`, `src/server/lib/backgrounds.ts`). No third-party video,
audio, or stock media is bundled. The "Splice!" game art and all iconography are drawn
in CSS/Canvas/SVG by this project.
