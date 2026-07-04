---
name: Murph
description: A calm, scientific interface for self-experimentation — warm desert palette, serif data, research-library density.
colors:
  cream: "#f5f0e8"
  cream-card: "#fffcf6"
  slate: "#2d3436"
  slate-muted: "#736a58"
  sand: "#d4c4a8"
  amber: "#c4a882"
  sage: "#7a8c6e"
  sage-dark: "#5a6e32"
  sienna: "#8b5d3f"
  wood-dark: "#2a1f16"
  wood-mid: "#3a2e24"
  border-warm: "rgba(196, 168, 130, 0.25)"
  card-surface: "rgba(255, 252, 246, 0.9)"
  muted-surface: "rgba(196, 168, 130, 0.15)"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(2rem, 5vw, 3.5rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  stat:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "DM Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.11em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  2xl: "20px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "36px"
  xl: "56px"
components:
  button-primary:
    backgroundColor: "{colors.sage-dark}"
    textColor: "#ffffff"
    rounded: "{rounded.2xl}"
    padding: "14px 24px"
  button-primary-hover:
    backgroundColor: "{colors.sage}"
    textColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.slate}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "10px 18px"
  card:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.slate}"
    rounded: "{rounded.lg}"
    padding: "24px"
  sidebar:
    backgroundColor: "{colors.slate}"
    textColor: "#ffffff"
    rounded: "0"
    width: "240px"
  chip-label:
    backgroundColor: "{colors.muted-surface}"
    textColor: "{colors.slate-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
---

# Design System: Murph

## 1. Overview

**Creative North Star: "The Interstellar Lab Notebook"**

Murph is a research station on a quiet planet. The interface reads like a carefully kept notebook — pages of structured findings in warm afternoon light, equations on a chalkboard, a Hamilton watch on the desk. Cream paper, dark slate ink, amber grain, a single green line for what the evidence supports. Space to breathe. Precision in every element.

This system rejects the two dominant defaults of the category outright. It is not a health app (no ring charts, no gamification, no "great job!"); it is not a SaaS dashboard (no gray boxes, no corporate tables, no metric overload). It is also not cyberpunk, neon, Blade Runner, or biohacker-glossy. Warmth comes from the palette and the paper, never from exclamation marks.

Density is a feature, not a bug. Scientific data, expert quotes, research citations, mechanism explanations — depth IS the product. The job is to present more information with more care, not less information with more whitespace.

**Key Characteristics:**
- Warm desert palette on cream paper — amber, sage, slate, sand. No pure white, no pure black.
- Serif display (Fraunces) for headlines and stat numbers, sans body (DM Sans), mono labels (DM Mono) uppercase with generous tracking.
- Desktop-first at 1440px, two-column rhythms (Protocol + Why It Works, Charts + Timeline).
- Flat surfaces, translucent cards, warm hairline borders — no decorative shadows.
- Motion restrained to View Transitions API. No Framer Motion, no bounce, no choreography.

## 2. Colors: The Warm Desert Palette

A single-accent system. Sage green carries every affirmative signal; the rest of the interface is tinted neutrals — cream paper, slate ink, sand and amber for grain. No secondary accent competes with sage. Warning sienna appears only where warranted.

### Primary
- **Sage Green** (`#7a8c6e`, dark variant `#5a6e32`): the one affirmative accent. Start Experiment CTA, positive deltas on signal cards, active-phase fill in progress bars, "strong positive signal" conclusions, sage-left-accent cards for Next Step and What Worked. The dark variant (`#5a6e32`) is the button color; the standard variant (`#7a8c6e`) is the data color.

### Neutral
- **Cream** (`#f5f0e8`): the page. Paper, not white. Every surface defaults to this.
- **Slate** (`#2d3436`): primary text and the sidebar. The ink on the page. Also the Secondary button color.
- **Slate Muted** (`#736a58`): muted text, captions, metadata. WCAG AA compliant on cream.
- **Sand** (`#d4c4a8`) / **Amber** (`#c4a882`): grain — baseline phase in charts, dashed baseline lines, expert-card avatars, subtle fills.
- **Card Surface** (`rgba(255, 252, 246, 0.9)`): translucent card background — warmer than cream, still paper.
- **Warm Border** (`rgba(196, 168, 130, 0.25)`): hairline dividers and card outlines. Never gray.
- **Wood Gradient** (`#2d3436 → #3a2e24 → #2a1f16`): the sidebar. Warm dark wood, not cool black.

### Tertiary
- **Sienna** (`#8b5d3f`): warnings and "avoid" signals only. WCAG AA compliant on cream. Never for decoration.

### Named Rules

**The One Green Rule.** Sage is the only affirmative accent. If something needs to feel positive, it gets sage — and only sage. Blue, teal, and purple are prohibited as UI color; they belong to other products.

**The No Gray Rule.** All neutrals are tinted warm. Borders use `rgba(196, 168, 130, 0.25)`, not `#e0e0e0`. Cards sit on cream, not on gray. If a surface looks cold, it's wrong.

**The Chalkboard Rule.** Data is presented on paper, as if written by hand. Stat numbers are serif (Fraunces), not the sans-serif dashboard default. Charts use dashed baseline + solid active lines, not filled areas.

## 3. Typography

**Display Font:** Fraunces (with Georgia, serif fallback)
**Body Font:** DM Sans (with system-ui, sans-serif fallback)
**Label / Mono Font:** DM Mono (with ui-monospace fallback)

**Character:** Fraunces carries the editorial, hand-lettered feel — the equation on the chalkboard, the title on the page. DM Sans is the reading voice: warm, legible, never cold. DM Mono at small sizes with wide tracking is the file-label energy — a card index, a laboratory drawer.

### Hierarchy

- **Display** (Fraunces, 600, clamp(2rem, 5vw, 3.5rem), leading 1.05, tracking -0.03em): page heroes on marketing surfaces, experiment titles on product surfaces. One per screen.
- **Headline** (Fraunces, 600, 2rem, leading 1.15, tracking -0.02em): section titles inside a surface (Protocol, Your Results, Conclusions).
- **Stat** (Fraunces, 600, 2rem+, leading 1, tracking -0.02em): the large numbers on signal cards — HRV up 12%, sleep +38min. Data as poetry.
- **Body** (DM Sans, 400, 14–16px, leading 1.55): running prose. Cap body columns at 65–75ch.
- **Label** (DM Mono, 500, 9–11px, letter-spacing 0.10–0.12em, uppercase): phase names (BASELINE · 7d), units (MS, BPM, %), card-header kickers ("CURRENT PHASE"), timeline event types.

### Named Rules

**The Serif-Numbers Rule.** Every large number is Fraunces, not DM Sans. A metric in a sans-serif dashboard font is the SaaS-cliché tell; a metric in Fraunces reads like a finding.

**The Mono-Label Rule.** Every small UPPERCASE label is DM Mono with ≥0.10em tracking. Never body-sans uppercase — it reads as shouting, not filing.

## 4. Elevation

Flat by default. Surfaces sit on cream paper and are defined by hairline warm borders or translucent backgrounds, not by shadow. Depth comes from three things: (1) the wood-gradient sidebar behind cream content, (2) translucent card surfaces over the cream page, (3) baseline-vs-active contrast in data (dashed sand line behind solid sage line).

No drop shadows for cards. No elevation tokens. If something needs to "come forward", the answer is weight/size/color, not blur.

### Named Rules

**The Flat-Paper Rule.** Cards do not cast shadows. Ever. Depth is composition (gradient sidebar ≠ cream content) and material (translucent card ≠ cream page), not lighting.

**The Hairline Rule.** Borders are 1px, colored `rgba(196, 168, 130, 0.25)`. Thicker borders are prohibited; colored side-stripes on cards are prohibited. If a card needs emphasis, use a full border or a sage-left-accent bar (1px or 3px max, not a thick stripe).

## 5. Components

Every component lives on cream paper, wears warm hairline borders, and speaks in Fraunces numbers + DM Sans copy + DM Mono labels. Touches are restrained — motion serves hierarchy, never decoration.

### Buttons
- **Shape:** rounded-2xl (20px) for primary CTA; rounded-lg (12px) for secondary.
- **Primary:** sage dark (`#5a6e32`) background, white text, 14px 24px padding, body-sans 500 weight. Used for "Start Experiment" and equivalent forward actions. Optional subtitle below in DM Mono ("7-day baseline · 14-day protocol").
- **Secondary:** slate (`#2d3436`) background, white text, 10px 18px padding. Used for header actions and neutral affordances.
- **Ghost / text:** slate text, no background, underline on hover. For low-priority links.
- **Hover / Focus:** primary shifts from sage-dark to sage. Focus ring uses `--ring` (`#7a8c6e`) at 2px offset 2px.

### Cards
- **Corner Style:** rounded-lg (10–12px).
- **Background:** `rgba(255, 252, 246, 0.9)` — translucent card surface, warmer than cream.
- **Border:** 1px `rgba(196, 168, 130, 0.25)` warm hairline. Never gray, never side-stripe.
- **Shadow Strategy:** none (see Elevation).
- **Internal Padding:** 24px default (`spacing.md`). 36px on larger feature cards.
- **Nesting:** prohibited. Nested cards are always wrong.

### Signal Cards
Large Fraunces stat number (the value) + DM Mono unit label + delta in sage green + expected range from protocol underneath. In finished state, show "was X" baseline value under the stat. One card per tracked signal; never grid five-abreast — prefer two or three across with room to breathe.

### Library List Pattern (Hero / Standard / Table)
For long lists of recommendations (e.g. experiments-that-may-move-this-biomarker, recipes, protocols), break the rhythm into three tiers instead of an identical-card grid:
1. **Hero rows (top 1–2)** — full-width row, image on the left (320px on desktop, 16:9 above on mobile), content on the right. Category eyebrow + serif h3 title + qualitative fit label top-right + mechanism prose + 4-stat band (`Exp. change` · `Duration` · `Burden` · `Evidence`). Optional small mono pill over the image (`RECOMMENDED FOR YOU`). The whole card is the link — no diagonal up-right arrow (it reads as "external" and is misleading); no "Open the experiment" CTA strip — the card surface itself is the affordance.
2. **Standard cards (next 3)** — `lg:grid-cols-3` grid. Image-on-top (16:9), content stacked below. Category eyebrow + serif title + qualitative fit label on a row, mechanism `line-clamp-3`, divided 3-stat footer with smaller `text-sm` values so longer ranges (`↓ −3 to −5%`) fit on one line. Fit tone is semantic: `Strong` / `Good` use primary, `Context` uses foreground, and `Exploratory` uses muted text.
3. **Dense table (the rest)** — single rounded card surface with a mono uppercase header row (`EXPERIMENT · EXP. CHANGE · DURATION · BURDEN · EVIDENCE · FIT`). Each row: 40px square thumbnail (rounded-md, `object-cover`, fallback to a 3-letter category chip) + serif title + category subline + tabular columns + chevron. Hover = `bg-muted/30`.

The shape compresses gracefully: before `md:` only title + fit label stay; at `md:` the full grid expands. This is the standard answer to "we have 14+ items to show on one page" — an identical card grid is the lazy alternative and is banned.

### Progress Bar (Experiment Phases)
Three phases: **Baseline · 7d ✓ → Active · Day X of Y → Analysis**. DM Mono labels, sage-green fill over sand track, active phase bold. One row, full width of the surface.

### Next Step Card (Active State)
Sage-green 3px left accent bar + session title (Headline) + when/context (Body) + "Next session: Friday" right-aligned (DM Mono). Only visible while experiment is active.

### Timeline
Vertical dot timeline. Upcoming events at top with faded opacity; history below at full opacity. Event types and their dots:
- **Session** — sage green filled dot
- **Milestone** — sage green filled dot
- **Skipped** — sand filled dot
- **Checkpoint** — sage green ring (unfilled)
- **Start** — dark-green filled dot
- **End** — sage green filled dot

### Trend Charts
Two distinct chart types live in the system:

**Experiment trend (dual-phase).** SVG sparklines. **Baseline phase:** dashed line in sand (`#d4c4a8`) with a shaded baseline region underneath. **Active phase:** solid line in sage (`#7a8c6e`). Two phases on one chart. No filled-area gradients, no axes busy work, no tooltips that explain what HRV means.

**Biomarker trend + tile pair (single-phase).** Used on the biomarker overview tab. Recharts AreaChart paired with two stacked stat tiles in a `md:grid-cols-[minmax(0,1fr)_300px] md:items-stretch` grid (chart fills, tiles each `flex-1`, heights match). Anchor the visible Y-domain on the typical band, not the data — `extraPad = bandSpan × 0.5` above and below, so the user sees headroom. Hide the Y-axis (`<YAxis hide />`) — the dashed `Typical {min}` / `Typical {max}` reference lines (sage at 50% opacity, 4-4 dash, mono labels via `insideBottomLeft` / `insideTopLeft`) carry the context. Range band is an Area at `fillOpacity={0.14}`. Series fill gradient runs `0.32 → 0.04` opacity; stroke is solid sage `2.5px`. First/last date footer in `text-[10px] text-muted-foreground` below the chart. Timeframe selector (30D / 90D / 1Y) sits top-right as a rounded pill group, active = primary fill. The two tiles: **Average tile** (mono uppercase label that adapts to timeframe — `30-DAY AVERAGE` / `90-DAY AVERAGE` / `1-YEAR AVERAGE` — Fraunces value, sans unit, sentence sub-line that reads as a finding: `"Down 4 bpm from where you started the past month."`, primary color when direction matches `goodDirection`) and **Range tile** (`55–75 bpm` Fraunces + `healthy adults` sub + right-aligned `In range` / `Out of range` pill with bg-primary/15 or bg-destructive/15 — never with an explanatory tooltip).

### Conclusions Block (Finished State Only)
Four stacked cards, vertical:
1. **What Worked** — sage-green 3px left accent.
2. **What Didn't Change** — neutral card, no accent.
3. **Key Insights** — bullet points, Body text.
4. **Recommendations** — sage-green 3px left accent, each item prefixed with `→`.

### Research / Evidence Section
Summary stats row (studies count · participants · years · evidence level rendered as "5/5"). Below: study cards, each with a round badge — `OBS` / `RCT` / `MA` — using DM Mono in a sand-filled circle.

### Compact Evidence Band
A tighter form of the evidence section, used as a header on the biomarker research tab and anywhere a single strong claim should anchor a page section. Two stacked rows: (1) a mono uppercase metadata strip — `{N} STUDIES · {N} PARTICIPANTS · {STUDY TYPE} · 5-dot rating` (foreground for the numerals, muted for the unit words, sage filled dots for the rating, border dots for the empty); (2) a serif italic blockquote up to ~3 lines, smart-quoted, with a mono `— ATTRIBUTION, YEAR` footer below. No card surface, no shadow — the blockquote sits directly on cream paper. One quote per band; if you have multiple claims, pick the strongest and link the rest.

### Expert Cards
Avatar circle filled sand (`#d4c4a8`) with initials in slate + name (Body 500) + field (Body muted) + quote (Body italic). No photos.

### Safety Section
Caution-rating dots (1–5 filled sand dots) + "Who should avoid" list + "Precautions" list. Sienna (`#8b5d3f`) used only on genuine warnings here; never decoratively.

### Sidebar (App Shell)
240px fixed width, wood gradient (`#2d3436 → #3a2e24 → #2a1f16`). White-at-85% text. Active item gets sage dark (`#5a6e32`) background block. Hairline border-right uses `rgba(255, 255, 255, 0.1)`.

### Inputs / Fields
Cream background, 1px warm border, rounded-md (10px). Focus: border shifts to sage (`#7a8c6e`), no glow. Mono labels above, body placeholder inside. Category and library filters use the `Select` dropdown, not a horizontal toggle pill row — toggle rows look broken in the active state when one pill has primary fill and the rest sit on transparent muted-surface, and they don't compress at small widths. Search inputs only appear when there are enough rows to need them (>~15 entries); below that, the dropdown alone is enough.

### Chips / Labels
DM Mono uppercase with 0.11em tracking. Muted-surface background (`rgba(196, 168, 130, 0.15)`), slate-muted text, rounded-sm, 4px 8px padding. Used for phase names, units, and filing-card metadata.

### Contact Card Avatar Picker
Post-signup step for adding Murph as a contact (`apps/web/src/components/murph/murph-contact-card-picker.tsx`, spec in `agent-docs/product-specs/murph-contact-card-picker.md`). Drawer under 768px, dialog above. Layout: contact preview (avatar circle + Fraunces "Murph" + mono kicker), then a scroll-capped radiogroup of avatar circles (3 columns, 4 from 380px up) with DM Mono labels (selected = 2px sage ring with offset), then a full-width primary "Add Murph to Contacts" CTA over a ghost "Skip for now". Headshot avatars come from `public/murph-headshots/`; the logo options are dot-grid mark rasters on slate (dark) and cream (light) circles in `public/brand-logos/`; the no-photo option is a sand circle with a serif M initial (Expert Card avatar treatment). The primary CTA downloads the member's real vCard from `/api/murph-contact-card`.

### About Intro Grid
A 3-column intro band that sits **above** the route tabs on biomarker (and similar concept) pages. Each column: small Quiver-style icon on the left at `size-8 text-primary/85` (icon style follows "Concept Icon Sets" below), mono uppercase eyebrow above a sans body paragraph on the right. Three slots that map to "Why it matters / How it's measured / What moves it" for biomarkers; the same pattern works for any concept-introduction surface. Body text is `text-muted-foreground`, not foreground — it should match the page summary band's tone, not compete with the H1.

### Tab Bar with Sticky Title
For long pages with route-driven tabs (Overview / Research / etc.), use a sticky bar that pins to `top-0` once the user scrolls past the page header. Track this with an `IntersectionObserver` on a 1px sentinel placed above the bar; when the sentinel exits the viewport, fade in the page title on the right side of the bar so users keep their orientation when they're 2,000px down the page. The tabs themselves use the shared `RouteTabs` component (sliding olive primary indicator under the active tab, view-transition-name for the indicator). The sticky bar background is `bg-background/95 backdrop-blur-md` with a single `border-b border-border` baseline — never a dropshadow.

### Icons
Lucide React (`lucide-react`) is the default. Lucide Animated (`https://lucide-animated.com`) is reserved for icons that specifically need motion — loaders, hover affordances. Install animated icons via `pnpm dlx shadcn@latest add https://lucide-animated.com/r/{icon-name}.json`. Icons serve comprehension; they never decorate.

### Concept Icon Sets
Bespoke iconography lives on its own track from Lucide. Two registers coexist:
- **Quiver-authored filled paths** (e.g. `public/icons/biomarker-about/*.svg` — the heartbeat, watch face, and bidirectional arrow used in the About Intro Grid). `fill="currentColor"`, complex multi-path, hand-lettered feel. Inline the markup with `dangerouslySetInnerHTML` so callers can drive color via the surrounding text class (`text-primary/85`).
- **Single-stroke line-art glyphs** (e.g. `apps/web/src/components/biomarkers/biomarker-icon.tsx`). The standard for concept identifier sets where every entry needs a distinct glyph (one per biomarker, one per protocol family, etc.). Spec, applied uniformly across the set: viewBox `0 0 100 100`, `stroke="currentColor" strokeWidth={2.5}`, `fill="none"` (committed across the whole set — don't mix in filled-shape members like a solid moon, the inconsistency reads as a bug), `strokeLinecap="round" strokeLinejoin="round"`, sized at `size-10` (40px) when used as a card anchor. Ship them as inline JSX paths/circles, keyed by the entity routeId, returning `null` for unknown ids so cards degrade gracefully.

When in doubt, prefer authoring a bespoke glyph over a generic Lucide pick. The "lucide-heart for resting heart rate, lucide-droplet for glucose" reflex is the SaaS-cliché tell — Murph's whole point is that the metaphor is hand-drawn.

### Transitions
View Transitions API (`<ViewTransition>` from `next/navigation`). No Framer Motion, no React Motion. Page transitions, tab switches, list reorders — all native. Subtle and fast; easing is exponential ease-out (quart/quint/expo). No bounce, no elastic.

### Brand Assets
- Logo (light): `apps/web/public/logo.svg`
- Logo (dark): `apps/web/public/logo-dark.svg`
- Favicon (auto dark mode): `apps/web/app/icon.svg`
- Dynamic OG image: `apps/web/app/opengraph-image.tsx` (1200×630, Fraunces + DM Sans, hero.jpg background)
- Canonical hero image: `apps/web/public/hero.jpg` (3583×2000)
- Supporting texture: `apps/web/public/warmglow.png` (1376×768)
- Live brand + component reference: `/design` (`?tab=brand`, `?tab=components`)

### Photography
Wide horizon, small human — spacious, warm, quietly cinematic. Amber-gold sunrise/sunset light, soft haze, low-contrast tonal transitions. One person held small in frame, off-center near an edge; preserve a calm side for copy. Use `public/hero.jpg` as the reference image when continuity matters.

**Master image prompt** (2K working / 4K final, 16:9 hero, 4:1 ultra-wide, 3:2 or 4:5 social):

> Create a wide, cinematic but minimal image for Murph, a calm health experiment brand. Use a warm amber-gold sunrise or sunset palette, soft atmospheric haze, expansive negative space, and one solitary human figure near the edge of the frame. The mood should feel grounded, observant, and quietly hopeful. Keep the world natural and believable: ridgelines, sky, rock, dust, distance, and breathable light. Avoid glossy wellness advertising, tech UI overlays, laboratory imagery, aggressive fitness cues, or saturated neon color.

**Social header prompt** (ultra-wide, 4:1):

> Create an ultra-wide social header for Murph. Keep a lone figure small on the right side of the frame and leave a calm, open copy area on the left. Use soft golden-hour light, low-contrast atmosphere, and a grounded natural landscape. The image should feel warm, spacious, and quietly intelligent, not epic or motivational.

Before shipping any Murph image, verify: (1) warm not hyped, (2) breathing room for copy, (3) real place with real light, (4) quiet human presence, (5) still feels like Murph without the logo.

## 6. Do's and Don'ts

### Do:
- **Do** use sage (`#5a6e32` for buttons, `#7a8c6e` for data) as the only affirmative accent.
- **Do** render every large number in Fraunces — stat cards, hero figures, result summaries.
- **Do** use DM Mono uppercase with 0.10–0.12em tracking for every small label, phase name, and unit.
- **Do** sit cards on cream paper with 1px warm hairline borders (`rgba(196, 168, 130, 0.25)`).
- **Do** keep motion native (View Transitions API) and fast — exponential ease-out, no bounce.
- **Do** let whitespace carry weight. 56px horizontal, 36–48px vertical content padding at desktop.
- **Do** quote real research, name experts, cite studies with OBS/RCT/MA badges. Depth is the product.

### Don't:
- **Don't** use ring charts, gamification, or "great job!" messages — these are the generic-health-app tell Murph explicitly rejects.
- **Don't** use gray boxes, corporate tables, or hero-metric templates — these are the SaaS-dashboard cliché.
- **Don't** use blue, teal, purple, or neon as UI accent color. Sage is the only affirmative accent.
- **Don't** use `#000`, `#fff`, or untinted gray. Every neutral is tinted warm.
- **Don't** cast drop shadows on cards. Flat-paper rule.
- **Don't** use side-stripe borders thicker than 3px; never use colored border-left/right as a decorative accent on arbitrary cards.
- **Don't** use gradient text (`background-clip: text` with a gradient). Emphasis is weight or size.
- **Don't** use glassmorphism or backdrop-blur as default decoration. Translucent card surfaces are the only sanctioned translucency.
- **Don't** use em dashes (—) in UI copy. Commas, colons, semicolons, periods, or parentheses instead. Also no `--`.
- **Don't** install Framer Motion or React Motion. Transitions are View Transitions API only.
- **Don't** import from `@radix-ui/*`. This project is shadcn on base UI (`@base-ui/react`).
- **Don't** nest cards. Always wrong.
- **Don't** explain what HRV means in a tooltip. Respect the user's intelligence.
- **Don't** add explanation tooltips to UI labels the user already understands. If a badge says `In range` next to `55–75 bpm`, a tooltip restating the band is redundant. Either the label is clear without help, or the label needs to be clearer; tooltips are not the fix.
- **Don't** use a diagonal up-right arrow (`ArrowUpRight`) on internal links. It reads as "opens in new tab / external" and misleads users on cards that navigate within the app. Use `ArrowRight` for forward navigation; for clickable cards, the surface itself is the affordance and no arrow is needed.
- **Don't** mix filled and stroked glyphs inside a single concept icon set. Pick one (line-art for biomarker identifiers, filled for the hand-drawn About Quiver register) and hold it across every member.
