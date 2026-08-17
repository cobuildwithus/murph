---
name: Murph
description: A calm, scientific interface for a personal health assistant — warm desert palette, serif data, research-library density.
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

**The One Green Rule.** Sage is the only affirmative accent. If something needs to feel positive, it gets sage — and only sage. Blue, teal, and purple are prohibited as general UI color; they belong to other products. A bounded product-identity choice card may carry its illustration color through hover, selection border, and radio when the color distinguishes named peers rather than communicating positive status. Keep that exception local to the card and maintain non-text contrast.

**The No Gray Rule.** All structural neutrals are tinted warm. Borders use `rgba(196, 168, 130, 0.25)`, not `#e0e0e0`. Cards sit on cream, not on gray. If a surface looks cold, it's wrong. Literal gray may appear inside a bounded identifying illustration, such as the Luna artwork, but does not become a page surface or general neutral token.

**The Chalkboard Rule.** Data is presented on paper, as if written by hand. Stat numbers are serif (Fraunces), not the sans-serif dashboard default. Charts use dashed reference rules and solid data lines. Restrained flat semantic range bands are allowed when they clarify a reference interval; decorative filled series areas and gradients are not.

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
- **Label** (DM Mono, 500, 9–11px, letter-spacing 0.10–0.12em, uppercase): phase names (BASELINE · 14d), units (MS, BPM, %), card-header kickers ("CURRENT PHASE"), timeline event types.

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
- **Primary:** sage dark (`#5a6e32`) background, white text, 14px 24px padding, body-sans 500 weight. Used for "Start Experiment" and equivalent forward actions. Optional subtitle below in DM Mono ("14-day baseline · 14-day protocol").
- **Secondary:** slate (`#2d3436`) background, white text, 10px 18px padding. Used for header actions and neutral affordances.
- **Ghost / text:** slate text, no background, underline on hover. For low-priority links.
- **Hover / Focus:** primary shifts from sage-dark to sage. Focus ring uses `--ring` (`#7a8c6e`) at 2px offset 2px.

### Experiment Start Channel Picker
When more than one connected channel can continue a public experiment start,
use one compact dialog rather than a stack of large destination cards. Lead
with a mono `START EXPERIMENT · {N}-DAY PROTOCOL` line, then show the full
Fraunces protocol title without truncation and one sentence explaining that
Murph prepares a reviewable message. Channel links are flat 64–72px rows with
one muted icon tile, channel name, plain-language destination description, and
a right chevron. Do not repeat the protocol inside a nested card, add
availability counts, or show redundant channel badges. End with the quiet
review-before-send reminder. On phones the dialog sits above the safe-area edge;
on larger screens it centers at no more than 540px wide.

### Cards
- **Corner Style:** rounded-lg (10–12px).
- **Background:** `rgba(255, 252, 246, 0.9)` — translucent card surface, warmer than cream.
- **Border:** 1px `rgba(196, 168, 130, 0.25)` warm hairline. Never gray, never side-stripe.
- **Shadow Strategy:** none (see Elevation).
- **Internal Padding:** 24px default (`spacing.md`). 36px on larger feature cards.
- **Nesting:** prohibited. Nested cards are always wrong.

### Signal Cards
Large Fraunces stat number (the value) + DM Mono unit label + delta in sage green + expected range from protocol underneath. In finished state, show "was X" baseline value under the stat. One card per tracked signal; never grid five-abreast — prefer two or three across with room to breathe.

### iMessage Nutrition Card Image
Render the macOS and app-absent fallback as the compact default state of the
shipping SwiftUI balloon, not as a second nutrition dashboard. Keep the wide
cream field, large calorie value, calorie progress ring, and one-row protein,
carbohydrates, fat, and fiber readings visually aligned with the Messages
extension, with a clear pause between the calorie row and macro grid. The
bitmap stays rectangular because Messages owns the outer corner
mask, but the bitmap itself embeds the canonical Murph mark in the same 36×27pt
upper-left badge footprint as the native balloon. Installed extensions retain
their native icon; app-absent static cards omit the optional square App Store
artwork because the provider request has no App Store id. Status color may tint
nutrient values, while the safe text recovery preserves the complete status
outside the bitmap. The ring
draws quantitative progress only for a complete calorie total with an
assessed goal; V1, partial, null-goal, and unavailable-status cards keep only
the neutral track. The static image does not expose the native card's
tap-to-reveal target state. The provider caption retains only the date and meal
count; visible totals and goals are not repeated beneath the image. V1 renders
an unavailable fiber dash in the image without adding a fiber caption claim.

Compact-table and workout fallback images use the same chrome contract: keep
the bitmap rectangular, embed the canonical Murph mark in the native badge
footprint, place the title beside that mark in one shared header, and let
Messages supply only the outer corner mask and caption. The badge and title use
one optically centered row with a measured gap; optional supporting text uses
the card content inset below that row rather than participating in its
centering. Do not reserve a larger empty icon gutter. Keep structural rounding
only where it communicates an inner state, such as a progress track or
set-status marker.
When a generic table uses stacked fields, keep each measured header above its
full-width measured value so every contract-valid token remains contained. The
exact intrinsic width of the row-header, column-header, and value tracks plus
their gutters is the sole layout selector: use the single shared table header
whenever those tracks fit, including four-column cards, and repeat field labels
only for genuinely overwide content.

### iMessage Challenge Standings Card Image
Render the app-absent standings fallback as the static counterpart to the
shipping SwiftUI balloon. Keep the cream field, title, rank or collective
progress, and score hierarchy aligned with the native card. The bitmap remains
rectangular because Messages owns the outer chrome, while the canonical Murph
mark is embedded in the native upper-left badge footprint. Reuse the same
optically centered badge-and-title row as workout and compact-table cards, with
optional supporting text directly under the title. Preserve scorer-owned order,
scores, progress, and coverage while using the identity-free public
presentation defined by the challenge standings delivery contract.

### Shared iMessage Card Handoff
When a shared response-card URL reaches the public homepage instead of the
Messages extension, open one compact handoff dialog after hydration. Reuse the
standard Dialog and Button conventions without a logo, eyebrow, numbered step
grid, or promotional accent treatment. In one short description, tell the user
to install or open Murph and then return to Messages and tap the card again.
Use Open App Store as the primary action, Cancel as a ghost secondary action,
and the standard close control. Stack both actions at full width using the
large settings-dialog button convention so the App Store destination remains
the clear primary path. Give the short serif heading display-scale presence,
use readable body copy, and let the compact surface breathe with the wider,
roomier settings-dialog spacing. The dialog must not display or decode the
fragment, add device-specific branching, or turn the fallback into a signup
flow.

### Ops Weekly Growth Scorecard
On `/ops/growth`, lead with one large Fraunces weekly MRR growth rate and keep
current MRR, tracked fulfilled usage top-ups, paying-customer growth, active
usage, acquisition, activation, and conversion subordinate. Compare the
displayed one-decimal rate with the 10% weekly target so the number and verdict
cannot disagree. A hit uses primary sage. A miss uses Tailwind `red-700` as a
deliberate binary target exception because the standard sienna warning token
reads brown rather than the explicitly required red; always pair either color
with `10% target hit` or `Below 10% target` text. A missing comparison stays
neutral and must not claim that a snapshot exists. Keep **Messaged Murph today**
and **Messaged Murph · last 7 days** as prominent supporting readings beside the MRR
lead; both count distinct people across personal and attributable group chats.
Each person belongs to the UTC window when Murph durably receives their message,
not the provider-reported event time. Describe them as retained senders. Account
deletion removes personal and owned-group source rows; activity retained in
another member's shared-group container follows normal content retention
instead of an analytics-side deletion trail.
Active-user windows must not present intentionally retired group-sender evidence
as an exact count: prefix an affected today, WAU, or MAU count with `At least`,
explain the private evidence retirement in the supporting copy, and withhold a
week-over-week rate when either compared window is incomplete.

Follow the scorecard with the existing two-column chart grid. Begin with one
full-width **People who messaged Murph** chart: a solid sage
trailing-seven-day line and a dashed sand completed-day line, both built from
anonymous daily snapshots. Keep the daily line above the rolling line so equal
values remain distinguishable without color. Then
show **Total messages sent**, a thin sage cumulative line seeded from the
established historical base, and **Messages sent per day**, restrained sage
bars for completed UTC days. Shift each snapshot's prior-day counts onto the
UTC date when Murph received the activity and always preserve the exact 30
completed-day UTC spine. Leave absent snapshots, incomplete sender windows, and
legacy unknown counts as chart gaps rather than zeros. Once message tracking has begun, an
unavailable day also ends the exact cumulative line until the missing evidence
is reconciled; later known daily bars may still render. State that the daily
message total combines inbound messages across supported channels with tracked
Linq replies. Give each keyboard-enabled chart one visible focus surface named
by its heading. Keep acquisition and revenue snapshots after the message charts.
End the grid with **Monthly revenue**: restrained sage bars where each bar
estimates one UTC month from the month's latest snapshot MRR plus fulfilled
live-mode top-up and group-sponsorship cash. The card copy must say it is an
estimate rather than invoices, that refunds are not subtracted, and that
account deletion can remove past purchase cash or leave an old one-time group
gift counted as a regular top-up, and it must name hover, tap, and focus as the
breakdown affordances. The bar carries only the total; the keyboard-reachable
tooltip lists personal subscriptions, family subscriptions, group sponsorship,
and usage top-ups with a summed total row, and labels the window-end month
"month to date". Months whose snapshots predate the subscription split columns
show one combined subscription line rather than an invented split; a recorded
split is trusted only when it sums to the snapshot's MRR total. A month with no
snapshot withholds its total ("Unavailable") and leaves a bar gap while still
listing its known one-time cash. Months before the first revenue evidence are
trimmed.

Below the chart grid, show trial-start provenance in one flat bordered surface:
30-day UTC totals for Direct iMessage, Website, Companion, and Unknown followed
by a recent-start ledger. Direct iMessage means an inbound iMessage initiated
the trial. The ledger may show only the persisted masked phone hint and must
pair the trial timestamp with the member-record creation date or age so delayed
activation is visible. Historical rows without event-time provenance stay
Unknown. Label raw member creation metrics as member records, never as proof of
an acquisition channel.

### Measured Biomarker Index
On `/biomarkers`, device-derived reading rows lead in a flat full-width notebook
band bracketed by warm one-pixel rules. Do not wrap that band in a rounded card
or give it a contrasting card background. Lab health areas follow as native
`<details>` disclosures, expanded by default, with a Fraunces area name and one
rotating chevron in the summary. Search and `All` / `Review` / `In range`
filters apply only to saved lab biomarkers. The opened contents are one
partitioned notebook surface rather than a stack of nested cards: one column on
every viewport, with one full-width biomarker row between warm one-pixel seams.
Each lab row uses a narrow 48px-tall semantic status rail beside the biomarker
name; length supplies rhythm while color carries the source-reported status.
On phones the name and result stack; from `sm` the name sits left and the
status/value sits right. Each row is one full-size link showing only the
biomarker name, source status, and latest value; flagged results sort before
in-range and unflagged results within their health area. Render `normal` in
sage, source flags that need review in sienna, and missing flags neutrally as
`Reported`.
Use explicit health-area classification; never show an `Other` dump, infer that
an unflagged result is in range, or turn a source flag into a diagnosis.

### Measured Biomarker Result Detail
On `/biomarkers/results/[metricKey]`, use a sparse reading order: biomarker name
and saved-history span, latest source status, value, collection date, then the
numeric history chart. Do not repeat the latest value in comparison, reference,
or count tiles above the chart. Use sage for a source-reported normal result,
sienna for flags that need review, and slate for an unflagged reported result.
Keep the complete result ledger below the chart, including the date, exact
reported value, source reference range, and lab/source label. Comparator,
qualitative, and incompatible-unit context stays explicit near the chart or in
the ledger. When the latest comparable result has a normalized lab range, place
one quiet `Latest lab range` legend above dashed boundary rules for its
two-sided band or one-sided limit. Preserve exact `<`, `<=`, `>`, and `>=`
source boundaries in the legend. Fit the vertical scale to the union of the
comparable results and the available range bounds. Shade the source range with
very light sage and the visible below/above regions with very light sienna; keep
the legend and dashed rules as non-color cues. Label source context as latest so
it does not imply that older labs shared the same range. If the latest comparable
result has no usable numeric source range, an exact-unit authored Health Commons
range may appear instead as `Published adult comparator`; it never changes the
source status and appears only when the result's normalized specimen kind is
explicitly eligible. State in the legend that the published comparator is not
the reporting lab's range, and render it with neutral dashed boundaries only,
without sage/sienna bands. Missing, mismatched, and context-dependent specimens
omit it. Keep the authored source label in the chart legend. Qualified source
ranges remain ledger-only and block a comparator from superseding more specific
source context. Do not add a visible chart title or single-result trend
instruction above or below this graph. Simplifying the hierarchy must not imply
that excluded values were plotted. The loading skeleton mirrors the same
latest-result, chart, and ledger structure rather than substituting a generic
card grid.

### Home Experiment History Cards
Completed experiment cards on `/home` are compact index entries, not miniature
results pages. Use three columns at wide desktop widths, two at small desktop
and mobile-landscape widths, and one where the open desktop sidebar constrains
the content column.
Inside each card, keep the category and title, then show every comparable result
as a small primary-first grid of mono labels and Fraunces deltas. Positive
evidence uses sage, unfavorable movement uses Tailwind amber-700 rather than the
lighter decorative amber grain token, and neutral movement stays slate so mixed
results remain distinguishable. Keep the date, but omit the
redundant Completed badge, circled privacy lock, Baseline-to-Latest block, and
visible View arrow. The entire card remains the link to the detailed result.
Active and paused cards keep the larger progress-first treatment, and stopped
runs keep the standard history-card treatment. Keep privacy legible with a small
unbordered lock beside the date rather than a separate header control.

### Library List Pattern (Hero / Standard / Table)
For long lists of recommendations (e.g. experiments-that-may-move-this-biomarker, recipes, protocols), break the rhythm into three tiers instead of an identical-card grid:
1. **Hero rows (top 1–2)** — full-width row, image on the left (320px on desktop, 16:9 above on mobile), content on the right. Category eyebrow + serif h3 title + qualitative fit label top-right + mechanism prose + 4-stat band (`Exp. change` · `Duration` · `Burden` · `Evidence`). Optional small mono pill over the image (`RECOMMENDED FOR YOU`). The whole card is the link — no diagonal up-right arrow (it reads as "external" and is misleading); no "Open the experiment" CTA strip — the card surface itself is the affordance.
2. **Standard cards (next 3)** — `lg:grid-cols-3` grid. Image-on-top (16:9), content stacked below. Category eyebrow + serif title + qualitative fit label on a row, mechanism `line-clamp-3`, divided 3-stat footer with smaller `text-sm` values so longer ranges (`↓ −3 to −5%`) fit on one line. Fit tone is semantic: `Strong` / `Good` use primary, `Context` uses foreground, and `Exploratory` uses muted text.
3. **Dense table (the rest)** — single rounded card surface with a mono uppercase header row (`EXPERIMENT · EXP. CHANGE · DURATION · BURDEN · EVIDENCE · FIT`). Each row: 40px square thumbnail (rounded-md, `object-cover`, fallback to a 3-letter category chip) + serif title + category subline + tabular columns + chevron. Hover = `bg-muted/30`.

The shape compresses gracefully: before `md:` only title + fit label stay; at `md:` the full grid expands. This is the standard answer to "we have 14+ items to show on one page" — an identical card grid is the lazy alternative and is banned.

### Progress Bar (Experiment Phases)
Three phases: **Baseline · 14d ✓ → Active · Day X of Y → Analysis**. DM Mono labels, sage-green fill over sand track, active phase bold. One row, full width of the surface.

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

**Saved outcome comparison.** A completed outcome can retain trustworthy baseline and intervention window averages without retaining raw daily points. Keep the ordinary experiment trend-chart frame instead of introducing a bespoke comparison graphic: render only the flat baseline and intervention window averages, label the card `WINDOW AVERAGES`, show `Baseline average` and `Experiment average`, and disclose measured-day coverage for both windows. Use a stable padded Y-domain so a small delta cannot fill the chart height. Never imply that the aggregate points are daily measurements.

**Biomarker trend + tile pair (single-phase).** Used on the biomarker overview tab. Recharts AreaChart paired with two stacked stat tiles in a `md:grid-cols-[minmax(0,1fr)_300px] md:items-stretch` grid (chart fills, tiles each `flex-1`, heights match). Anchor the visible Y-domain on the typical band, not the data — `extraPad = bandSpan × 0.5` above and below, so the user sees headroom. Hide the Y-axis (`<YAxis hide />`) — the dashed `Typical {min}` / `Typical {max}` reference lines (sage at 50% opacity, 4-4 dash, mono labels via `insideBottomLeft` / `insideTopLeft`) carry the context. Range band is an Area at `fillOpacity={0.14}`. Series fill gradient runs `0.32 → 0.04` opacity; stroke is solid sage `2.5px`. First/last date footer in `text-[10px] text-muted-foreground` below the chart. Timeframe selector (30D / 90D / 1Y) sits top-right as a rounded pill group, active = primary fill. The two tiles: **Average tile** (mono uppercase label that adapts to timeframe — `30-DAY AVERAGE` / `90-DAY AVERAGE` / `1-YEAR AVERAGE` — Fraunces value, sans unit, sentence sub-line that reads as a finding: `"Down 4 bpm from where you started the past month."`, primary color when direction matches `goodDirection`) and **Range tile** (`55–75 bpm` Fraunces + `healthy adults` sub + right-aligned `In range` / `Out of range` pill with bg-primary/15 or bg-destructive/15 — never with an explanatory tooltip).

### Conclusions Block (Finished State Only)
Four stacked cards, vertical:
1. **What Worked** — sage-green 3px left accent.
2. **What Didn't Change** — neutral card, no accent.
3. **Key Insights** — bullet points, Body text.
4. **Recommendations** — sage-green 3px left accent, each item prefixed with `→`.

On sparse saved outcomes, use one flat report hierarchy instead of repeating the same conclusion across cards: saved headline and plain-language read, confidence chip, measured-change charts, one limitations list, then the experiment log. Keep the report centered at a readable desktop width and let warm dividers establish sections.

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

### Murph Safe Search and Product Evidence
The public `/search` page uses the editorial paper system without an app-shell
dashboard. Lead with one direct question, one large explicit-submit field, and
short privacy/evidence framing. Group results by Supplements and Branded foods;
each flat row shows identity, source, and exact-linked test count without a
safe/unsafe badge. Detail pages read like evidence files: identity, tests,
ingredients, nutrition, unknowns, provenance, correction contact. Use sienna
only for genuine warnings or failures. Evidence gaps stay neutral and explicit.
At phone widths, metadata wraps under identity and long product/source strings
must break without horizontal scrolling.

### Choice Cards
Use the shared `ChoiceCard` with `RadioGroup` when a member must compare two to
five consequential options. Each card has one short title, one brief purpose
phrase, and an optional mono metadata line. Product-specific inline artwork can
sit behind the content when one quiet, familiar visual cue replaces explanatory
copy; keep it flat, `aria-hidden`, and subordinate to the text. Selected cards
normally use the sage selection tint and warm border, but a quiet accent drawn
from product-specific artwork can carry through the border, tint, and selection
check. Keep the semantic radio visually hidden and place the visible check at
the right edge of the card; do not add a leading radio dot.
Unavailable choices stay visible but disabled, with the plan or access
requirement named directly.
When a choice materially changes included-capacity drawdown,
state that difference before save and keep it visible beside the saved
selection. It may appear in the option copy or the immediate pending-selection
summary; do not hide it in a tooltip or mention it only after save.
Keyboard focus rings the whole card. Keep actions outside the card label so the
full card remains one predictable radio target. Stack on narrow screens and use
a compact grid only when the options are true peers. Do not use choice cards as
navigation or as a substitute for ordinary buttons.

### Group Join Sharing Choices

The group join consent checkpoint may request the complete selectable sharing
catalog. Keep every requested choice selected for a new invitee until they
explicitly uncheck it, state the selected count when the catalog is long, and
place the checklist in one bounded, keyboard-scrollable region so the primary
join action remains visible. Beside a long-catalog count, include one quiet
button that clears all optional sharing so joining without health or email
sharing is a single action; members can then re-enable exact choices below.
Each row stays a full-width checkbox card with its
plain-language scope description; do not compress a consequential permission
into a dense table, hide choices behind categories, or imply that the defaults
have already been granted. Existing members reopen the same surface with only
their currently active shares selected, and the list includes both the current
group request and every older share that member can still revoke.

### Group Usage Funding
An authenticated group funding link opens its relevant funding control
immediately: monthly sponsorship for an unsponsored chat, one-time contribution
for an already sponsored chat, or payment recovery when a purchase is in
progress. Use `GroupUsageFundingShell` only as the quiet reopen surface beneath
that control. Do not add a second sales card, decorative status badge, duplicate
headline, or explanatory paragraph. Retain `Back to Murph` as the quiet
secondary action.

A signed-out funding link first shows one neutral sign-in handoff and returns to
the exact funding URL after authentication. Do not reveal whether the group or
the viewer has a private sponsorship relationship before that handoff. An
authenticated payer keeps the cancellation path even when the group is no
longer eligible for new funding; authenticated non-payers see the ordinary
unavailable state. After cancellation, replace the action with a durable receipt
that confirms future automatic refills stopped and existing usage credit stays
with the group. Do not reload into an unrelated unavailable state.

For a signed-in active group participant, append one quiet **Supporters** list
beneath the funding action when a current monthly sponsorship or recent
one-time contribution exists. Use only a public alias entered after the dialog
discloses its signed-in-group audience and active-monthly-or-recent-20 duration,
and only after verified settlement preserved the sponsor's group authority;
otherwise use `Anonymous`. Label each row only as
`Monthly sponsor` or `One-time contribution`. Do not show amounts, monthly
maximums, dates, payer identity, payment status, or automatic-refill history.
Signed-out visitors and non-participants never see the supporter list. Keep the
list absent when there is nothing to recognize. Stream it beneath the complete
primary action in its own best-effort Suspense boundary with a null fallback so
recognition cannot delay funding, management, cancellation, or recovery. Render
its real component with synthetic states in both the components catalog and
this section study.

Use `GroupSponsorshipDialog` for the primary monthly choice. Present $5, $10,
and $20 as visually prominent monthly maximums. On desktop, use the shared
choice cards. On phones, use a near-full-height bottom drawer with one large
circular cap slider. The handle follows a pointer anywhere around the arc and
snaps to the nearest available maximum on release; Arrow keys and Home/End
provide the same three-stop selection. Keep the opening explanation to
`Choose your monthly sponsorship limit.` The explicit sponsor action authorizes
the initial $5 activation purchase, whose amount is shown before payment;
selecting a maximum alone does not charge the card. Keep both funding actions
available at every current group-capacity state; capacity changes urgency and
automatic refill timing, not the ability to fund. Keep an explicit one-time
contribution as the secondary action. On phones, open that contribution in the
same bottom-drawer pattern as monthly sponsorship; keep the centered dialog on
larger screens. Customer-facing amount choices say `usage`; cost weighting is
an accounting detail, not interface copy. Keep the contribution action at the
drawer's safe-area edge while its body scrolls. Dollar amounts remain usage
capacity, never an owned or promised number of messages. Every cap increase
requires fresh payer confirmation. Keep the alias, note, and eligible temporary
running bit in one collapsible `Add a note` section, open by default, and attach
them only to the activation or one-time purchase, never to automatic refills.
Optional text fields use the sage focus border without an outer glow. The
drawer body owns overflow while the sponsor action stays available at the safe
area edge, so expanded note fields never become unreachable. Preserve visible
focus and selection states. Render the production activation,
active-management, near-cap/recovery, paused, and one-time states at desktop and
mobile sizes on `/design` with controls inert, including content rendered
through a dialog or drawer portal.

When group funding is fulfilled, switch from the payment-status composition to
one confident success hierarchy: a compact sage confirmation mark and mono
`NICE ONE` label, the Fraunces headline `This group has more Murph`, one
sentence confirming that the contribution is ready, then a warm-divider handoff
to **Open Messages**. State that Messages opens without a group deep link and
the member must choose the group. Do not repeat the confirmation in a bordered
status card, keep payment-pending copy visible, invent an amount, or add
celebration graphics. Once fulfillment is verified, do not carry frozen sponsor
details or their payment-recovery instructions into the success receipt.

### Hosted AI Usage Activity
On authenticated Settings, keep this read-only surface mission-first and
compact. Do not add an explanatory hero or use a wide ledger table. Each
mission row shows its title, status, concise deadline, reward, and reward owner;
keep qualification requirements and selection date in one native `details`
disclosure. Follow with flat purchase-credit history rows showing source, date,
and added amount, plus one short clarification that the amounts are not the
current balance. Keep the existing Murph conversation handoff beside the
Missions heading, and hide it when the member has no supported conversation
route or new missions are disabled.

Personal and owner-seat Family usage-credit checkout returns reconcile against
the authenticated beneficiary's existing aggregate meter without opening a
success confirmation when that meter is present. Expose the fulfilled transition
through one visually hidden polite status region that is mounted before
reconciliation and receives the verified result once, but do not add a
post-purchase messaging handoff.
Keep those returns visually quiet while payment is confirming and
after fulfillment; if the bounded status check fails, remains unresolved, or
reports a terminal failure, open only the compact payment-recovery dialog with
its safe check/retry and close actions. Another active Family member and
former-member recovery keep one compact target-specific result because their
meter is not present. The Family roster owns an exact returned member's status
without requiring Manage to be opened, and those off-meter results remain
visible until Close owns their terminal refresh. A personal return whose usage
status is unavailable follows that same close-owned compact pattern and confirms
only that the durable credit reached the account. Group funding keeps its
separately owned fulfillment receipt and Messages handoff.

### Spinner
Use the shared `Spinner` for compact pending feedback inside buttons or beside a
short status label. Pair it with a disabled control and visible action copy such
as `Saving`; the spinner never replaces the label or becomes a full-page loader.
Use `MurphPulseLoader` for branded account setup states instead.

### Chips / Labels
DM Mono uppercase with 0.11em tracking. Muted-surface background (`rgba(196, 168, 130, 0.15)`), slate-muted text, rounded-sm, 4px 8px padding. Used for phase names, units, and filing-card metadata.

### Contact Card Avatar Picker
Post-signup step for adding Murph as a contact (`apps/web/src/components/murph/murph-contact-card-picker.tsx`, spec in `agent-docs/product-specs/murph-contact-card-picker.md`). Drawer under 768px, dialog above. Layout: contact preview (avatar circle + Fraunces "Murph" + mono kicker), then a scroll-capped radiogroup of avatar circles (3 columns, 4 from 380px up) with DM Mono labels (selected = 2px sage ring with offset), then a full-width primary "Add Murph to Contacts" CTA over a ghost "Skip for now". Headshot avatars come from `public/murph-headshots/`; the logo options are dot-grid mark rasters on slate (dark) and cream (light) circles in `public/brand-logos/`; the no-photo option is a sand circle with a serif M initial (Expert Card avatar treatment). The primary CTA downloads the member's real vCard from `/api/murph-contact-card`.

### Cross-platform first-run sequence

The website and native companion present the same ordered content: contact card
when text routing is available, four numbered personality steps, then the
welcome state only after this surface wins the completion write. Native uses
the same warm-desert palette, Fraunces display hierarchy, DM Mono progress
labels, sage selection treatment, option order, descriptions, and button copy.
Voice rows always provide a separate, labeled play/stop control. Save failures
keep selections visible and offer retry; a stale surface closes quietly rather
than showing a duplicate welcome. The companion may adapt dialog/drawer layout
to a full-height native screen, but it must not reorder or invent options.

### About Intro Grid
A 3-column intro band that sits **above** the route tabs on biomarker (and similar concept) pages. Each column: small Quiver-style icon on the left at `size-8 text-primary/85` (icon style follows "Concept Icon Sets" below), mono uppercase eyebrow above a sans body paragraph on the right. Three slots that map to "Why it matters / How it's measured / What moves it" for biomarkers; the same pattern works for any concept-introduction surface. Body text is `text-muted-foreground`, not foreground — it should match the page summary band's tone, not compete with the H1.

### Tab Bar with Sticky Title
For long pages with route-driven tabs (Overview / Research / etc.), use a sticky bar that pins to `top-0` once the user scrolls past the page header. Track this with an `IntersectionObserver` on a 1px sentinel placed above the bar; when the sentinel exits the viewport, fade in the page title on the right side of the bar so users keep their orientation when they're 2,000px down the page. The tabs themselves use the shared `RouteTabs` component (sliding olive primary indicator under the active tab, view-transition-name for the indicator). The sticky bar background is `bg-background/95 backdrop-blur-md` with a single `border-b border-border` baseline — never a dropshadow.

### Changelog Archive Pagination
The public changelog shows seven dated editions per server-rendered archive window. Page one keeps the clean `/changelog` URL and opens on the latest seven days; older windows use a stable `?edition=YYYY-MM-DD` cursor, and every item permalink includes the edition that owns its anchor. Navigation sits below the window on a plain warm hairline divider: Newer and Older text links at the edges, a compact current-page window with first and last page on larger screens, and `PAGE N OF N` in mono on phones. The current page uses the slate affirmative block; inactive pages stay flat and warm with no enclosing card. Major feature cards may include one compact explanatory mock from the changelog visual primitives when it makes the shipped behavior easier to understand.

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
- Static iMessage response-card image: `apps/web/app/imessage/card/v1/[payload]/route.tsx` (1200px wide, content-sized, DM Sans, canonical Murph badge, immutable bounded V1-V5 snapshot)
- Canonical hero image: `apps/web/public/hero.jpg` (3583×2000)
- Supporting texture: `apps/web/public/warmglow.png` (1376×768)
- Live brand + component reference: `/design` (`?tab=brand`, `?tab=components`; nutrition and compact-table image studies live on the components tab)

### Photography
Wide horizon, small human — spacious, warm, quietly cinematic. Amber-gold sunrise/sunset light, soft haze, low-contrast tonal transitions. One person held small in frame, off-center near an edge; preserve a calm side for copy. Use `public/hero.jpg` as the reference image when continuity matters.

**Master image prompt** (2K working / 4K final, 16:9 hero, 4:1 ultra-wide, 3:2 or 4:5 social):

> Create a wide, cinematic but minimal image for Murph, a calm health experiment brand. Use a warm amber-gold sunrise or sunset palette, soft atmospheric haze, expansive negative space, and one solitary human figure near the edge of the frame. The mood should feel grounded, observant, and quietly hopeful. Keep the world natural and believable: ridgelines, sky, rock, dust, distance, and breathable light. Avoid glossy wellness advertising, tech UI overlays, laboratory imagery, aggressive fitness cues, or saturated neon color.

**Social header prompt** (ultra-wide, 4:1):

> Create an ultra-wide social header for Murph. Keep a lone figure small on the right side of the frame and leave a calm, open copy area on the left. Use soft golden-hour light, low-contrast atmosphere, and a grounded natural landscape. The image should feel warm, spacious, and quietly intelligent, not epic or motivational.

Before shipping any Murph image, verify: (1) warm not hyped, (2) breathing room for copy, (3) real place with real light, (4) quiet human presence, (5) still feels like Murph without the logo.

### Personal Patterns Matrix

Use one flat paper surface for repeated action-to-outcome comparisons. Put Quiver-style factor illustrations on rows and next-day outcomes on columns. Circle size shows the size of the difference. Fill color shows the evidence stage: amber for a new clue, sage for a link seen again, and dark sage with a ring for a link worth testing. The plus or minus sign shows direction. Color must not label higher values as good or lower values as bad.

Keep the copy observational. Use “lined up with” or “was associated with.” Never use “caused,” “proved,” or a moral label. Show matched-day counts and comparison means in the cell detail. On narrow screens, keep the row labels readable and scroll the matrix horizontally.

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
- **Don't** use gray boxes, gray-gridded corporate data tables, or hero-metric templates — these are the SaaS-dashboard cliché. A warm, purposeful comparison IS allowed when it genuinely clarifies a choice (e.g. Murph vs a general chatbot): keep it on cream/sand paper surfaces, use serif + mono type with hairline `#c4a882` dividers instead of a gray grid, and let one side carry the sage affirmative treatment.
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
