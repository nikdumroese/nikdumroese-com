# Niklaas Dumroese — Design System (MASTER)

Our own system. Not derived from any employer/client brand. Built to a specific taste brief.

## Taste brief (source references)
- `stuohler.com` — Helvetica, unapologetic. Grotesque type is the system.
- `parkerhendo.com` — super clean, but must carry a clear **Get in touch** CTA everywhere.
- `noff.me` — the resume-as-narrative build. About/Work should read like a well-set CV.
- `onur.design` — **everything above the fold.** Hero is dense and self-contained.
- `heyvalentin.club` — fun typography + fun colour used with intent.
- `marco.fyi` — **NO bento grids.** (mobile detail is nice, bento is not.)

## Positioning
**Builder.** "I build and ship GTM systems that run on AI." Systems/growth engineer framing,
not ops-manager framing. Confident, concrete, low on adjectives.

## Type
- **Grotesque (display + UI + body):** `"Helvetica Neue", Helvetica, Arial, sans-serif`.
  Authentic Helvetica, zero webfont load. This is the voice of the site.
  - Display: heavy weight (700), tight tracking (-0.03em to -0.045em), large scale.
  - Body: 400, line-height 1.5, max line-length 68ch.
- **Mono (metadata, nav labels, numbers, IDs):** `"Space Mono"`, self-hosted latin subset in `assets/fonts/`
  with a size-adjusted Menlo fallback. Uppercase only for labels of five words or fewer, 12.5px minimum.
  Labels must carry information (counts, dates, status) or be dropped; no decorative eyebrows.
- No third family. Contrast comes from grotesque↔mono, weight, scale, and colour — not novelty fonts.

## Colour: "Grid-pad" (Oct 2026)
Derived from the subject, not a trend: engineering graph paper (measurement models are drafted on it)
plus Okabe-Ito blue, a colour-blind-safe charting palette. Replaced cream #F4F1EA + vermilion, which
2025-26 writeups document as the "second-wave" AI-default palette.

| Token            | Hex        | Use |
|------------------|------------|-----|
| `--paper`        | `#F3F5F1`  | green-grey paper background |
| `--paper-2`      | `#E6EBE4`  | raised panels / hover |
| `--ink`          | `#14171A`  | primary text (16.4:1) |
| `--ink-60`       | `#535A5E`  | secondary text (6.4:1) |
| `--ink-40`       | `#788580`  | borders and baseline series that carry meaning (3.5:1) |
| `--ink-20`       | `#B9C7BC`  | grid-green hairlines, decorative only (1.6:1) |
| `--accent`       | `#0072B2`  | Okabe-Ito blue: focus, CTA hover, plan/model series, status (4.73:1, passes as text) |
| `--accent-text`  | `#005A8C`  | accent text on `--paper-2` (accent drops to 4.29 there) |
| `--on-accent`    | `#FFFFFF`  | text on accent fills (5.19:1) |
| `--accent-on-ink`| `#56B4E9`  | links/hover on the ink footer (7.8:1) |
| `--accent-2`     | `#A35F00`  | ochre, rare |

One accent, used sparingly; never accent a single word in a headline. Charts: plan/model series solid
accent, baseline dashed `--ink-40`, so meaning never rests on colour alone.

## Layout
- **Single column, editorial.** Generous margins. Container max-width ~1200px, text blocks ~68ch.
- Work is an **index/list**, not a grid of cards and never a bento box.
- Baseline rhythm on an 8px grid. Section spacing large (96–160px desktop).
- Sticky top bar: wordmark left, 3 links + a persistent **Get in touch**. Links stay visible on phones (no hamburger).
- Hero is above-the-fold on a laptop (≤ 800px tall content): name, one-line thesis, 2–3 proof lines,
  primary CTA + CV. No hero image required — type is the hero.

## Motion (restrained)
- No entrance animations (uniform fade-and-rise is a documented AI-template tell).
- Hover: 200ms colour/underline transitions only. No layout shifts on hover.
- Respect `prefers-reduced-motion: reduce`: all transitions off.

## Lab (live tools under /lab/)
- Shared layer: `assets/lab.css` + `assets/lab.js` (SVG charts, tabs, CSV, seeded data). Controls column left, outputs right; on mobile outputs come first.
- Form controls use ink (`accent-color: var(--ink)`); the accent is kept for the model/plan series and status, one loud use per viewport.
- Architecture diagrams are inline SVG using `.diagram` classes.

## Components
- **Link:** ink text, accent on hover, animated underline (background-size trick), no colour-only cue.
- **Button (primary):** solid ink fill (accent on hover), `--on-accent` text, 44px min height, mono label.
- **Kicker:** mono, uppercase, `--ink-60`, 12.5px, and only when it carries information (e.g. "Lab · 7 tools"). No `01 —` numbering unless the items are a real sequence.
- **Project row:** title · description · result line · visible "Open →", full-width, hairline divider. Case-study accordions show an outcome line while collapsed.
- **Tag/chip:** mono, small, hairline border; accent border only on the flagship.

## Accessibility (from ui-ux-pro-max, non-negotiable)
- Contrast ≥ 4.5:1 text, ≥ 3:1 for UI boundaries and chart marks; body ≥ 16px, labels ≥ 12.5px.
- Visible focus rings (2px accent outline, offset 2px); `scroll-padding-top` keeps anchors clear of the sticky nav.
- Touch targets ≥ 44px. `cursor: pointer` on all interactive elements.
- Semantic landmarks, labelled links, alt text, `for`-linked labels.
- Body ≥ 16px on mobile; no horizontal scroll at 375/768/1024/1440.

## Anti-patterns (do not do)
- Bento grids. Card-in-card-in-card. Generic blue-on-white SaaS default.
- Emoji as icons (use inline SVG). Corporate stock template layouts.
- More than two accent colours loud at once. Decorative gradients/shadows.
- Employer/client brand tokens (Pleo pink, Lago blue) — this is a personal system.
- AI-template tells: cream + terracotta/vermilion, accented headline word, decorative mono eyebrows,
  01/02 numbering on non-sequences, fade-and-rise on every section, round-number stat strips.
