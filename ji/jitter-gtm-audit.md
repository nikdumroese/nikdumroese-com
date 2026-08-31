# Jitter.video — GTM & Tech Stack Audit

Pre-call audit of https://jitter.video. Compiled from live site/DNS/robots/CMS inspection.

**TL;DR:** Paris-based, product-led motion-design tool positioned as the fast/simple anti-After-Effects and the motion layer on top of Figma. Sophisticated top-of-funnel (de-anon, affiliate, attribution) but thin mid-funnel content. Enterprise machinery is already built; AI feature is live but quiet.

---

## What they are
- Collaborative, browser-based motion design tool.
- Positioning: *"a fast and simple motion design tool on the web"* — speed + simplicity + no-expertise-required.
- Competes against After Effects (incumbent); ecosystem play with Figma; differentiates vs Canva (consumer) and AE (heavyweight).

## Tech stack
- **Frontend:** React + Remix (some Next.js traces). Engineered site, not no-code/Webflow.
- **Infra:** Cloudflare (DNS, CDN, proxy; NS on Cloudflare).
- **Email:** Google Workspace (corporate) + AWS SES (transactional/marketing). SPF authorizes both.
- **Verifications:** Facebook domain verify + 3× Google site-verification (Search Console, Ads, Workspace).

## GTM / growth stack
| Tool | Signal |
|------|--------|
| **Segment** (analytics.js) | Central customer-data pipeline → mature event routing to multiple destinations. |
| **GTM + GA4** (GTM-MXXDKW6X, G-FH539XQSBR) | Standard tag management + analytics. |
| **Vector** | B2B website visitor de-anonymization / intent → outbound/PLG-sales motion. |
| **Dub** (dubcdn) | Link management / campaign attribution. |
| **PromoteKit** | Affiliate/referral program on top of Stripe → creator/affiliate-led growth. |
| **Stripe** (via PromoteKit) | Self-serve billing. |
| Twitter/X + LinkedIn pixels | Paid social retargeting active on both. |

## Pricing
- **Tiers:** Free / Pro / Enterprise. Pro is **per-editor/month, billed annually** (seat-based).
- **Approx price points** (from CMS payload, USD/mo, CONFIRM LIVE): ~**$48–$60 per editor** annual-billed; **~$100** month-to-month anchor.
- **Feature gating:** Free has watermark; paid unlocks HD/4K export, unlimited, SSO/SAML (Enterprise). **Export quality/volume is the monetization lever** (39 mentions).
- **Hidden pricing routes** (robots.txt disallow): `/pricing/exec` and `/pricing/link` → custom/negotiated enterprise pricing + shareable quote links = sales-assist motion.

## Hiring / company signals
- Paris-based French startup. **No public careers page** (careers/jobs/about URLs return catch-all 404 SPA shell).
- Product surface from robots.txt disallows reveals roadmap/org:
  - `/ai-playground` → **AI feature live** (likely prompt/text-to-motion). Their next growth bet.
  - `/teams`, `/organizations`, `/sso`, `/onboarding` → team/enterprise infra already built.
  - `/use-template`, `/starter-file` → template-led onboarding funnel.
- Lean, product-led org; copy references "founder" repeatedly → founder-close decisions.

## Competitor framing
- **Primary incumbent: Adobe After Effects** (speed + simplicity + no-expertise = anti-AE). But **no `/vs-after-effects` SEO pages** → missed capture opportunity.
- **Figma = channel, not rival:** heavy "import from Figma" → positioned as the motion layer on Figma's static design.
- **Lottie is central** (13 mentions): exports to Lottie/JSON/GIF/MP4/WebM → targets product/design teams shipping animations to code.
- **SEO = templates, not comparisons:** ~1,157 template mentions, 949KB `/templates/` page → organic acquisition is template-gallery-led, funneling to `/use-template`.

## Talking points for the call
1. **AI is live but quiet** (`/ai-playground`) — ask about AI motion roadmap.
2. **Enterprise machinery exists** (SSO, teams, exec pricing, quote links) but **content/demand-gen underbuilt** relative to product maturity → wedge for GTM/marketing/RevOps help.
3. **Seat-based (~$50/editor) PLG-to-sales hybrid** with Vector (de-anon) + PromoteKit (affiliate) + Dub (attribution): strong TOFU, thinner mid-funnel content.
4. **Positioning:** "motion layer for Figma-native design teams, minus After Effects complexity," monetized on export quality.
5. **Paris-based, lean, product-led** — fast, founder-close decisions.

## Corrections / caveats
- Careers, competitor-comparison, and `/vs-` pages **do not exist** — earlier HTTP 200s were a catch-all SPA shell ("Page not found" title, identical ~23.6KB). No public jobs page, no comparison SEO pages.
- Price digits are React-hydrated (not in server HTML); numbers above are pulled from the CMS payload and should be confirmed on the live pricing page.

## Raw signals reference
- IPs: 172.67.73.95, 104.26.2.153, 104.26.3.153 (Cloudflare)
- NS: owen/fay.ns.cloudflare.com
- MX: Google Workspace
- TXT: SPF (google + amazonses), FB domain verify, 3× google-site-verification
- Socials: discord.gg/hWBmsxtZwa, instagram.com/jitter.video, linkedin.com/company/jittervideo, youtube.com/c/JitterVideo, x.com/jittervideo
- Analytics IDs: GTM-MXXDKW6X, G-FH539XQSBR
- Script domains: cdn.segment.com, www.dubcdn.com, cdn.promotekit.com, www.googletagmanager.com
