# SPLICE

**Long video in. Shorts out.** A free-forever, accountless AI studio that turns long video into vertical shorts — with **CLAIM SHIELD**, a multi-parameter, best-effort copyright-claim prevention screen.

One Docker service. One free Render instance. Zero required API keys.

> **The honest truth first:** CLAIM SHIELD is a *prevention screen*, not a copyright removal tool. It cannot remove copyright, bypass Content ID, or guarantee monetization. Platform detection is final. The app says this on every rights panel, and it will never pretend otherwise.

---

## What it actually does

| Capability | Reality |
|---|---|
| Upload | mp4 / mov / mkv / webm / m4v / avi, up to **2 GB / 120 min**, chunked and resumable. |
| URL import | YouTube / Shorts via a bundled `yt-dlp`. Live streams return a clear `LIVE_UNSUPPORTED` error. Playlists resolve to one video with a note. |
| AI analysis | Staged, SSE-visible pipeline: ingest → transcript → shots + DSP → browser offload → scoring → rights-aware selection → render → rights scan/repair. |
| Provider ladder | LLM: TokenHarbor → Groq → Gemini → OpenAI-compatible → **local heuristic**. ASR: Groq Whisper → Deepgram → AssemblyAI → **local-basic / none**. Rights: AudD → ACRCloud → **pure-TS DSP heuristics**. |
| Zero-key mode | Fully functional. No transcript is fabricated: if no ASR is available, `transcript.mode = none` and captions only burn words that were genuinely detected. |
| CLAIM SHIELD | 16 real detectors (A1–A4 audio, V1–V5 visual, T1–T3 text, S1–S3 source, X1 transform), weighted risk score, three tiers, ≤3-pass repair loop, hard server-side download gate. |
| Browser offload | MediaPipe face detection + tesseract.js OCR + 64-bit pHash + measured ROI/chrome statistics. Falls back to honest frame-diff saliency if WebAssembly assets are unavailable. |
| Output | Real H.264/AAC MP4, `faststart`, target resolution 1080/720/480p, 9:16 / 16:9 / 1:1, burned karaoke captions, procedural backgrounds, locally synthesized music loops. |
| Storage | Your library lives in **IndexedDB on your device**. Server scratch files expire after **45 minutes**. No account, no telemetry, no watermarks, no quotas, no expiry on your local data. |

### What it deliberately does *not* do
- No pricing, login, quotas, watermarks, expiry modals or upsells.
- No detection evasion, no DRM circumvention, no "beat Content ID" claims.
- No direct social upload — that would require OAuth credentials this build intentionally omits. Export a **Publish Kit** (MP4 + SRT + metadata + `.ics`) and post it yourself.

---

## Run locally

Requires **Node 22+** and **ffmpeg** on `PATH`.

```bash
npm install          # also synthesizes 6 rights-safe music loops into public/audio
cp .env.example .env # optional; everything works with no keys
npm run dev          # API :3001, Vite SPA :5173
```

Open **http://localhost:5173**. For a production-like single-service run:

```bash
npm run build        # server -> dist-server/index.mjs, SPA -> dist/
npm start            # everything on http://localhost:3001
```

`npm test` runs the CLAIM SHIELD unit suite. `npm run typecheck` checks both TS projects. `npm run lint` runs ESLint.

### Optional environment variables

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | HTTP port | `3001` |
| `SPLICE_SCRATCH` | Temp working directory | `/tmp/splice` |
| `FILE_TTL_MIN` | Server asset lifetime | `45` |
| `MAX_UPLOAD_GB` | Upload cap | `2` |
| `MAX_CONCURRENT` | Heavy jobs at once | `1` |
| `SPLICE_API_TOKEN` | Require `Bearer` auth on `/api` (self-host only) | unset |
| `GROQ_API_KEY`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `TOKENHARBOR_API_KEY` + `TOKENHARBOR_BASE_URL`, `GEMINI_API_KEY`, `OPENAI_COMPATIBLE_API_KEY` + `OPENAI_COMPATIBLE_BASE_URL` | Upgrade the AI ladder | unset → heuristic |
| `AUDD_API_KEY`, `ACRCLOUD_ACCESS_KEY` + `ACRCLOUD_ACCESS_SECRET` | Real fingerprint provider for A1/A4 | unset → DSP |
| `YT_COOKIES_B64`, `YT_PROXY` | Help yt-dlp past YouTube bot checks | unset |
| `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET` | Direct upload (not needed for the free workflow) | unset |
| `FFMPEG_BIN`, `FFPROBE_BIN`, `SPLICE_FONT_DIR` | Override binaries / fonts | auto |

---

## Deploy to Render Free (exact steps)

1. Push this folder to a GitHub repository.
2. In Render → **New + → Web Service** → connect that repo.
3. Render detects `render.yaml` and proposes a **free** Docker web service named `splice`. Accept it.
4. No environment variables are required. Add only optional upgrade keys from the table above if you have them.
5. Click **Create Web Service**. Render builds the Dockerfile, then serves the SPA + API on one port.
6. Watch `/api/health` — it must return `"status":"ok"`. The first request after a free-tier sleep can take ~1 minute; that is Render, not SPLICE.
7. Open the service URL. There is no sign-up screen because there is no sign-up.

The container installs `ffmpeg`, `fontconfig`, DejaVu/Liberation fonts and a standalone `yt-dlp` release binary. It builds the SPA and server at image build time, runs as an unprivileged user, and keeps scratch files in `/tmp/splice`.

### Free-tier reality check
- The instance **sleeps when idle**; first wake is slow.
- **512 MB RAM** means one heavy job at a time (enforced with `p-queue`, concurrency 1). A 120-minute 1080p source is technically accepted but will be slow — start with shorter clips.
- Server files vanish after 45 minutes (and whenever the instance restarts). **Download what you need.**
- Browser offload needs a modern Chromium-based browser; MediaPipe uses GPU with a CPU fallback, and tesseract.js needs network access to fetch its language data on first use. All other detection works without it.

---

## Verified results

Measured on this build locally (Node 22/24, ffmpeg 9.0.2, system Chrome; **no Docker CLI, no yt-dlp, no API keys available locally**):

| Gate | Result |
|---|---|
| `npm run typecheck` (client + server) | pass |
| `npm run lint` | pass, 0 errors |
| `npm test` — CLAIM SHIELD unit suite | **14/14 pass** (weights, tiers, hard stops, repair plans, download gate, honest limitation) |
| `npm run build` | pass — server bundle + SPA bundles emitted |
| `tests/smoke_pipeline.py` — chunked upload → job → ready | **pass**, 1 clip, no passthrough fallback |
| Rendered asset `ffprobe` | `h264` + `aac`, 480×854, 28.01 s, MP4 faststart, real frame extracted |
| `npm run test:e2e` — desktop 1440×900 | 17/17 checks pass, 0 console errors |
| `npm run test:e2e` — mobile 390×844 | 9/9 checks pass, 0 console errors, no horizontal overflow |

Honest local limitations: URL import could not be exercised because `yt-dlp` is absent on this machine (the health endpoint reports `unavailable`; the Docker image installs it). No fingerprint API key was present, so A1/A4 ran in DSP-heuristic mode. Zero-key ASR reported `local-basic` with `localAsr: false`, so no words were fabricated. Docker was not buildable locally, so the Dockerfile/render.yaml are provided but the Render image itself was not built here. The Playwright suite ran headless against the locally built single-service app, not against a live Render deployment.

---

## CLAIM SHIELD, precisely

Sixteen parameters, each with a fixed weight and measured evidence:

**Audio** — A1 commercial fingerprint (40, hard stop), A2 DSP music bed (25/35), A3 speech dominance (10), A4 edge sound logo (20).
**Visual** — V1 persistent watermark (30, hard stop on stable OCR marks), V2 platform chrome (35), V3 broadcast bars (10), V4 stock watermark (30), V5 static corner blob (18).
**Text** — T1 broadcast metadata (20), T2 borrowed-show context (12), T3 injected trademarks (15, ×0.6).
**Source** — S1 attestation (25 mitigation), S2 ripper provenance (20), S3 episodic pattern (18).
**Transform** — X1 captions/hooks/reframing are not original commentary (12).

`risk = clamp(round(Σ weight × value × (T3 ? 0.6 : 1)) − mitigations + policyBias, 0, 100)`

Mitigations: `owned`/`licensed` −30, `public_domain`/`cc` −35, `add_voiceover` −12, `add_attribution` −8. Policy bias: strict 0, balanced +4, own_content +8.

Tiers: **BLOCKED** if any hard stop, `risk > 55`, or strict policy with `risk > 20`; **REVIEW** if `risk > 20`; otherwise **CLEAR**.

Repairs (≤3 passes) are *legal transformations only*: replace/mute music, trim flagged spans, blur a confirmed watermark ROI (requires your confirmation), crop platform chrome, add mandatory attribution, add original commentary, regenerate metadata. No repair re-encodes away a fingerprint to evade detection — that is exactly the line this project will not cross.

Downloads are gated on the **server**: `GET /api/assets/:id` returns `403 RIGHTS_BLOCKED` for any BLOCKED asset, and REVIEW assets need a stored confirmation. A client-side trick cannot override it.

---

## Project layout

```
shared/types.ts             Client/server contract (all records, params, constants)
src/server/                 Fastify API, SSE jobs, upload/importer, pipeline, rights engine
src/client/                 React SPA — pages, offload, game, store, design system
src/client/styles/global.css  All visual tokens, primitives, motion, responsive rules
tests/unit/                 Vitest suite for rights tiers, weights, hard stops, repairs
tests/smoke_pipeline.py     Manual end-to-end API smoke test
public/audio/               Six generated, rights-safe 45s music loops
DESIGN.md / ATTRIBUTIONS.md Art direction and third-party notices
```

Design sources: `nextlevelbuilder/ui-ux-pro-max-skill` and `anthropics/skills`, cloned into `.design/`. See `ATTRIBUTIONS.md` for licenses.

---

## License

SPLICE source is provided as-is for local, self-hosted, non-commercial use. Third-party components keep their own licenses — see `ATTRIBUTIONS.md`. You are responsible for the media you feed it and the rights you have to publish the output.
