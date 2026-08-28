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
- **Mono (eyebrows, metadata, nav labels, tags, indices):** `"Space Mono", ui-monospace, monospace`
  (Google font, self-loadable). Gives "builder" texture + the fun-typography contrast.
  Uppercase, letter-spacing 0.08em, small (12–13px).
- No third family. Contrast comes from grotesque↔mono, weight, scale, and colour — not novelty fonts.

## Colour (max 2 accents, sparse)
| Token            | Hex        | Use |
|------------------|------------|-----|
| `--paper`        | `#F4F1EA`  | warm off-white background |
| `--paper-2`      | `#ECE8DE`  | subtle raised panels / hover |
| `--ink`          | `#111110`  | primary text, display |
| `--ink-60`       | `#5B5952`  | secondary text, metadata |
| `--ink-20`       | `#C9C4B8`  | hairlines, rules |
| `--accent`       | `#F5451E`  | vermilion — primary accent, links, CTA, active marks |
| `--accent-2`     | `#2438FF`  | electric blue — secondary chip only, used rarely |
| `--on-accent`    | `#FFFFFF`  | text on accent |

Swiss logic: near-black Helvetica on warm paper + one hot vermilion. Blue is a rare second voice
(one project chip, one hover), never both accents loud in the same viewport. No gradients, no
drop shadows as decoration, no glassmorphism.

## Layout
- **Single column, editorial.** Generous margins. Container max-width ~1200px, text blocks ~68ch.
- Work is an **index/list**, not a grid of cards and never a bento box.
- Baseline rhythm on an 8px grid. Section spacing large (96–160px desktop).
- Fixed, minimal top bar: wordmark left, 2–3 links + a persistent **Get in touch** on the right.
- Hero is above-the-fold on a laptop (≤ 800px tall content): name, one-line thesis, 2–3 proof lines,
  primary CTA + CV. No hero image required — type is the hero.

## Motion (restrained)
- Entrance: fade+8px rise on scroll via IntersectionObserver, 400ms, staggered ≤80ms.
- Hover: 200ms colour/underline transitions. No layout-shifting scale transforms.
- Respect `prefers-reduced-motion: reduce` — disable all of the above.

## Components
- **Link:** ink text, vermilion on hover, animated underline (background-size trick), no colour-only cue.
- **Button (primary):** solid ink or vermilion fill, `--on-accent` text, 44px min height, mono label.
- **Eyebrow / kicker:** mono, uppercase, `--ink-60`, small, with a leading index like `01 —`.
- **Project row:** number · title · role/scope · year, full-width, hairline divider, hover reveals accent.
- **Tag/chip:** mono, small, hairline border; accent border only on the flagship.

## Accessibility (from ui-ux-pro-max, non-negotiable)
- Contrast ≥ 4.5:1 (ink/paper passes; vermilion on paper only for large/bold or with underline).
- Visible focus rings (2px vermilion outline, offset 2px).
- Touch targets ≥ 44px. `cursor: pointer` on all interactive elements.
- Semantic landmarks, labelled links, alt text, `for`-linked labels.
- Body ≥ 16px on mobile; no horizontal scroll at 375/768/1024/1440.

## Anti-patterns (do not do)
- Bento grids. Card-in-card-in-card. Generic blue-on-white SaaS default.
- Emoji as icons (use inline SVG). Corporate stock template layouts.
- More than two accent colours loud at once. Decorative gradients/shadows.
- Employer/client brand tokens (Pleo pink, Lago blue) — this is a personal system.
