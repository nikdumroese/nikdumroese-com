# nikdumroese-com — CLAUDE.md

Personal site, nikdumroese.com. Plain static HTML/CSS/JS — no framework, no build step,
no package.json. Deployed via GitHub Pages (`CNAME` file); pushing to `main` ships live.

## Structure
- Pages: `index.html`, `about.html`, `cv.html`, `consulting-cv.html`, `404.html` — hand-edited HTML, no templating.
- `assets/styles.css` — all styling. `assets/app.js` — page behavior. `assets/analytics.js` — Segment (write key inline; empty key = no-op; respects DNT/GPC).
- `design-system/MASTER.md` — source of truth for tokens, type, colour, layout, components, anti-patterns. Read before touching any visual/HTML output.
- `content/about.md` — source copy for About; `llms.txt` / `llms-full.txt` — agent-facing site summary, keep in sync with real page content when pages change.
- `ji/` — unrelated audit notes, not part of the site build.

## Rules
- No inline styles, no `<style>` blocks, no raw CSS properties in HTML — use the classes/tokens defined in `assets/styles.css` per `design-system/MASTER.md`.
- Anti-patterns called out in the design system (no bento grids, no emoji-as-icons, no gradients/drop-shadows, max two accents loud at once) — treat as hard constraints, not suggestions.
- Editing HTML: targeted string replacement, not full-file rewrites — these are long single-file pages.
- Changing copy/positioning: check `llms.txt`/`llms-full.txt` for matching claims and update both, not just the visible page.
- Segment write key in `assets/analytics.js` is live in prod — don't touch without confirming intent.

## Verification
No test suite/build. Verify by opening the changed HTML file directly in a browser (or local static server) and checking the page at mobile/tablet/desktop widths — there's no CI gate.
