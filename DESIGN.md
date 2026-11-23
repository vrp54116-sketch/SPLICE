# SPLICE — Design System & Art Direction

> Source of truth for the visual language. Derived from the brief (`midnight splice lab`),
> validated against `ui-ux-pro-max` design-intelligence runs for
> `cinematic dark editor`, `video studio premium`, and `creative tool editorial`,
> and the Anthropic `frontend-design` + `webapp-testing` skills. Where the brief pins a
> value, the brief wins. Repo guidance contributes process rules only.

## 1. Concept

**Midnight splice lab.** A screening room at 2 a.m.: film tape on the bench, a projector
glow, an edit bay of hardware that feels physical. Not a SaaS dashboard. Not blue-on-black.
The product is a *tool* — every surface should look like it could cut film.

Design intelligence agreed on: grid-based/Swiss structure, high contrast, SVG-only icons,
visible focus, reduced-motion support, no horizontal scroll, breakpoints at
375 / 768 / 1024 / 1440. We adopt all of those. We reject its generic palette suggestions
(violet, gold, navy) because the brief's splice-tape red-orange is the brand.

## 2. Color tokens

| Token | Hex | Role |
|---|---|---|
| `bg` | `#0A0D12` | App background |
| `surface` | `#10151D` | Panels, cards |
| `overlay` | `#18202B` | Raised surfaces, menus |
| `line` | `#26303D` | Hairlines, borders |
| `text` | `#F4F1EA` | Ivory primary text |
| `muted` | `#8B94A7` | Secondary text |
| `splice` | `#FF4D2E` | Primary / hero / CTA field |
| `splice-deep` | `#3A120C` | Recessed red field |
| `splice-glow` | `rgba(255,77,46,.20)` | Glow halos |
| `cyan` | `#22D3EE` | Focus, active, configure section |
| `magenta` | `#FF3DBE` | Accent, results section hue shift |
| `acid` | `#A8E635` | CLEAR / success (always with icon + label) |
| `amber` | `#FFB020` | REVIEW / processing |
| `danger` | `#FF5C5C` | BLOCKED (always with icon + label) |

CTA text is near-black `#0A0D12`, bold — never white-on-orange. Status color is never the
only signal: every badge carries an icon and a word.

## 3. Type

Self-hosted via `@fontsource-variable`:

- **Unbounded** — wordmark, hero, big numbers. Wide, engineered, a little loud.
- **Space Grotesk** — all UI copy, buttons, labels. Sentence case, never ALL CAPS eyebrows.
- **IBM Plex Mono** — timecodes, durations, scores, stats, filenames.

Scale: 12 / 13 / 14 / 16 / 20 / 28 / 40 / 64. Body 14–16, line-height 1.5, max 72ch.
No accenting a single word in a headline. No tracked-out caps labels above every section.

## 4. Layout

- Fixed collapsible **left rail** (240px → 64px) and fixed **top bar** (56px).
- Home/Configure use a **12-column grid**; Configure's control region is a sticky right rail
  on ≥1024px, a sticky summary + one-tap sheet below that.
- Mobile <768px: rail becomes a drawer; bottom tabs (5 max) replace primary navigation.
- No fixed-width containers; fluid `clamp()` gutters. No horizontal overflow at any tested width.

ASCII (desktop):

```
┌──────┬───────────────────────────────────────────────┐
│ rail │ topbar: breadcrumb  ⌘K  🔊  policy  + New     │
│      ├──────────────────────────┬────────────────────┤
│ Home │ main column             │ sticky controls    │
│ Proc │ (hero / configure /     │ (live summary)     │
│ Lib  │  results / editor)      │                    │
│ …    │                          │                    │
├──────┴──────────────────────────┴────────────────────┤
│ free forever · no account            storage used    │
└───────────────────────────────────────────────────────┘
```

## 5. Motifs

Sprocket edges (radial-gradient repeating holes), tape-slash dividers
(4° clipped rule), monospace timecodes, REC pulse, playhead scrubbers, a rotating
"CLEARED" stamp. Background: red-orange/magenta/cyan mesh at low opacity, 5% grain,
scanlines, ~40 canvas dust motes (paused when hidden). Section hue shift:
hero red → configure cyan → results amber.

## 6. Motion

- One orchestrated entrance per view; stagger ≤600ms. Reduced motion: no drift/parallax/
  shake, fades ≤150ms, and all canvases pause when the tab is hidden.
- GSAP SplitText for hero only; motion springs for sheets; AutoAnimate for lists;
  NumberFlow for stat tiles; Magic UI marquee/shimmer/border-beam on the CTA;
  React Bits ShinyText/BlurText for headlines.
- Motion *answers an action* (open/expand/confirm) or signals a staged job — it is not decoration.

## 7. Accessibility & feedback

- Focus-visible: 2px cyan outline, 2px offset. Targets ≥40px (44px on touch).
- Throttled `aria-live="polite"` for job progress; never announce every frame.
- Contrast pairs checked: text/bg ≥ 7:1, muted/bg ≥ 4.5:1, CTA text/fill ≥ 7:1.
- Drawers/dialogs trap focus, restore focus on close, Esc closes.
- Every error shows a specific remedy panel, never a stack trace.
- Icons from Lucide only. No emoji as icons.

## 8. Scrollbars

10px, track = `bg`, thumb = `line` → `splice` on hover, radius 8; Firefox
`scrollbar-color: var(--line) var(--bg)`.

## 9. Anti-goals (explicitly not shipping)

Pricing, upgrade modals, "Pro" badges, watermarks, expiry, login walls, minute quotas,
promo banners, generic blue-on-black gradients, detection-evasion transforms, or any
claim that CLAIM SHIELD guarantees a copyright outcome.
