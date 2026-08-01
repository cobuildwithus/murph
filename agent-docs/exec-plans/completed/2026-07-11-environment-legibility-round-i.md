# Environment page legibility — Round I (grades, one fact list, fewer categories)

Status: completed
Owner: Codex (implementation), Fable (plan, review, verification, commit)
Branch: `environment-ui` (worktree `~/Development/murph-what-murph-knows-ui`; root checkout stays on `main`)

Our utmost priority is clean, simple, long term maintainable and composable architecture with minimal complexity.

## Why

riderway reviewed the current `/environment` page and rejected it as noisy: two tables
per category ("Targets" + "Other facts & gaps"), a "Known" label repeated on every row,
identical icons on every fact, a "Target score 2/3 verified" metric nobody understands,
attention/missing chips, a "Next: …" line, and an overview card full of counters. The page
must answer two questions instantly: **how good is my environment (a grade)** and
**how much does Murph know (coverage)** — per page and per category — then show one
ranked fact list per category with color/status doing the work instead of text.

Decisions made with riderway (2026-07-11):

- Grade scale: **letter + percent** (A ≥90, B ≥75, C ≥55, D ≥35, E <35). Badge colors:
  A/B olive (`primary`), C amber (`chart-4`), D/E terracotta (`destructive`).
- Grading breadth: **extend mock evaluators** so most non-informational facts grade;
  purely informational facts stay neutral.
- Collapsed category card: **compact row** — small sprite thumbnail (~48px), title,
  grade badge, coverage % + thin bar, chevron. Nothing else. Full visual only expanded.
- **Delete the `/environment/3d` spike** (kills the one accepted typecheck error).
- Categories: **remove Training** (Rocketman owns exercise), **merge Health devices
  into Recovery**, **dissolve Home into the hero context strip**. Five cards remain:
  Sleep, Air & water, Light, Recovery & devices, Workspace.

All UI copy in English. Everything stays mock-driven (`MOCK_HABITAT_VALUES`); catalog in
`@murphai/contracts` is NOT touched.

## Files to touch

All under `apps/web/app/(dashboard)/environment/` unless noted.

### 1. `home-model.ts`

- Delete the `training` and `home` category defs.
- Merge devices into recovery: `id: "recovery"`, `title: "Recovery & devices"`,
  `aspectIds: ["recovery-access", "health-devices"]`; move the `scale` and `bpcuff`
  objects into its `objects` (adjust `lx/ly` so the shelf reads well; shelf layout is
  forgiving).
- Add a `thumbnail: ObjectSprite` field to `CategoryDef`/`ResolvedCategory` — the one
  signature sprite shown in the collapsed row: sleep → `bed.svg`, air → `purifier.svg`,
  light → `lamp.svg`, recovery → `plunge.svg` (reads better at 48px than sauna-glass),
  workspace → `desk.svg`.
- Five categories remain: sleep (vignette), air (shelf), light (shelf), recovery (shelf),
  workspace (vignette).

### 2. `category-notes.ts` — unified rows + grades

Replace the `checks`/`facts`/`unknown`/`skipped` + `nextGoal` shape with:

```ts
export type CategoryNote = {
  id: string;
  title: string;
  known: number;
  total: number;
  grade: CategoryGrade;          // { letter: "A"|"B"|"C"|"D"|"E"|null, pct: number|null, met: number, graded: number }
  rows: FactRow[];               // known facts only, sorted (see below)
  unknownLabels: string[];       // for the compact footer line
  skippedLabels: string[];
};

export type FactRow = {
  indicatorId: string;
  label: string;
  value: string;                 // humanized
  target: string | null;         // shown muted inline when the row grades
  met: boolean | null;           // null = neutral/informational
  priority: HabitatIndicatorPriority;
  detail: string | null;         // tooltip content (merged sub-fact), e.g. "Measured with Aranet"
};
```

- **Extended evaluators** (UI-level mock; never grade catalog-`informational` indicators —
  keep a guard). Keep the existing six and add:
  - sleep: `night_noise === "quiet"`; `humidity_known !== "unmanaged"`;
    `bedding_overheating === "never"`; `temp_control !== "none"`;
    `phone_by_bed === false` (target text "out of the bedroom");
    `tv_in_bedroom === false` (target text "no TV"). `window_at_night` stays neutral.
  - air: `ventilation !== "windows_only"` (target text "mechanical / recuperation");
    `damp_or_mold === "none"`; `smoke_sources === "none"`.
  - light: `morning_light_access !== "none"`; `daytime_light !== "dim"`.
  - recovery: `sauna_access !== "none"`. Everything else there is informational → neutral.
  - workspace: `standing_desk === "adjustable_used"`; `screen_at_eye_level === true`;
    `screen_setup !== "laptop_only"` (target text "external monitor");
    `breaks === "systematic"`; `wrist_complaints === false`; `chair === "ergonomic"`;
    `external_keyboard === true`.
  - Where the catalog has a `target` string, reuse it as the inline target text; where it
    doesn't, add a short UI-side target string in one colocated map (single source for
    evaluator + target text per indicator, e.g. `{ met(value), goal: "…" }`).
- **Merged pairs** (kills noise rows; fold only when the sub-fact is known):
  - `co2_meter` folds into the `co2_typical_ppm` row as `detail` ("Measured with Aranet").
  - `sauna_type` folds into `sauna_access` (value "home · dry").
  - `red_light_model` folds into `red_light` when known (mock: skipped → stays in
    skipped footer).
  - `mattress_age_years` folds into `mattress_satisfaction` when known (mock: unknown →
    stays in unknown footer).
  - Folded indicators must not double-count: they still count once in known/total
    coverage, but never appear as their own row.
- **Sorting** of `rows`: unmet first (priority rank, then catalog order), then the rest
  by priority rank, then catalog order. This puts "what's wrong" and the key facts on top.
- **Grade**: `pct = Math.round(100 * met / graded)`; letters per the scale above;
  `graded === 0` → `letter: null` (badge renders "–").
- Export a tiny `overallGrade(notes)` + reuse for the hero (sum met / sum graded).
- Delete `nextGoal` derivation entirely.

### 3. `environment-components.tsx` — rewrite

Delete: `HabitatOverview`, `OverviewMetric`, `ContextStrip`, `CompactScore`,
`CompactCoverage`, `StatusCounts`, `TargetTable`, `TargetRow`, `FactsPanel`, old
`FactRow`, `VisualPanel` header chrome. Build:

- **`EnvironmentHero`** — one card, three zones:
  - Grade: large serif letter in a colored badge + "84%" beside it, small label
    "Environment grade".
  - Coverage: "Murph knows 20 of 25" + percent + thin progress bar, label "Coverage".
  - Context row (merged old ContextStrip + dissolved Home): Location "Lisbon"
    (from `MOCK_HABITAT_VALUES["home-location"].location`; `area_type` "urban center" as
    tooltip/detail), Weather "24°C · Sunny" (mock ambient), Nights "Quiet", Outdoor air
    "PM2.5 low", Pets "cat" (from `allergens-home.pets_at_home`). `travel_pattern` and
    `carpets` disappear from the page and from the counts.
  - No "N Habitat facts", no "Within target", no "Still missing", no skipped counters.
- **`GradeBadge`** — cva variants: olive (A/B), amber (C), terracotta (D/E), muted ("–"
  when letter null); sizes `sm` (category row) and `lg` (hero).
- **`CategoryCard`** — `<details>`/`<summary>` like today:
  - Summary row ONLY: 48px sprite thumbnail (`category.thumbnail`, plain `<img>` or
    inline svg wrapper — no ring, no state), serif title, `GradeBadge sm`, coverage
    ("87%" + thin bar, small "13/15" allowed as muted detail), chevron. No sub-line,
    no chips, no "Next" line, no "Target score".
  - Expanded: visual panel (diorama or shelf on `bg-muted/60`, no "Room setup /
    Visual summary" header row) + the fact list.
  - Fact list rows (one list, no section headers): status glyph — ✓ olive when `met`,
    ✗ terracotta when `met === false`, small neutral dot when `met === null` — then
    label (medium), value (foreground), target muted inline ("target 18–22°C") only when
    the row grades, and when `detail` is set an unobtrusive affordance (dotted underline
    on the value or a tiny info icon) revealing a tooltip. NO "Known" column, NO
    per-row database icons.
  - Footer, one muted compact line (not rows): `Not known yet: mattress age · noise
    countermeasures` and, when present, `Skipped: red light model`. Unknown before
    skipped; separators "·".
- Tooltip: reuse the project's existing tooltip component if one exists under
  `apps/web/src/components/ui/`; otherwise add the shadcn (base UI) tooltip via
  `cd apps/web && pnpm dlx shadcn@latest add tooltip` (project style `base-nova`;
  invoke the repo shadcn skill conventions — no `@radix-ui/*`).
- Mobile: summary keeps one line (thumb, title, badge, coverage %); fact rows may wrap
  value/target beneath the label. Verify at ~375px.

### 4. `category-shelf.tsx`

- Remove the uppercase state word line under tiles (`STATE_LABELS` / "KNOWN" etc.).
  Ring + label + value carry the state. Keep the "?" and "–" glyphs inside rings.

### 5. `page.tsx`

- Wire hero + five category cards. Compute overall grade and coverage from the five
  notes plus the hero-tracked home facts (location, area_type, pets count toward
  coverage; travel_pattern and carpets do not — exclude them explicitly rather than
  counting the whole aspects).
- Keep `PageHeader` as-is.

### 6. Delete the 3D spike

- `git rm -r "apps/web/app/(dashboard)/environment/3d"`.
- Remove now-unused deps from `apps/web/package.json` (`three`, `@react-three/fiber`,
  `@types/three` — verify each is unreferenced elsewhere first with a repo grep), then
  run `pnpm install` so the lockfile updates in the same change.
- Expectation after deletion: `pnpm typecheck` in `apps/web` is FULLY GREEN (the single
  accepted `sidebar.tsx` error was caused by r3f's global JSX augmentation).
- Delete tracked sprites that become unreferenced (`dumbbells.svg`, `sofa-cat.svg`,
  `tree.svg` — re-grep before deleting). Do NOT touch untracked svgs in
  `public/design-assets/habitat/` (bookshelf, bush, coffee-table, fridge, gym-mat,
  kitchen-counter, lounge-chair, treadmill, wall-art) — they are riderway's working files.

## Edge cases

- Category with `graded === 0` → badge "–", no percent; do not render "target …" text
  on neutral rows.
- Folded sub-facts: only fold when known; unknown/skipped sub-facts stay in the footer
  line; never double-count coverage.
- `note.rows` empty but unknowns exist (nothing known yet) → show only the footer line;
  the card must not render an empty table frame.
- Shelf categories with unknown tiles keep the dashed "?" ring tiles (they still make the
  gap visible pre-list).
- `<details>` must stay keyboard-accessible: summary focus ring preserved; grade badge
  needs an `aria-label` like "Grade B, 82 percent".
- Progress bars keep their `role="progressbar"` attributes.

## Verification

Codex sandbox cannot run `pnpm typecheck:prepared` or hit the dev server — the
supervisor (Fable) runs gates outside the sandbox:

1. `cd apps/web && pnpm typecheck` → 0 errors (3d spike gone).
2. `pnpm lint` (scoped to apps/web if the repo script allows).
3. Live check at `https://local.withmurph.ai:3443/environment` — desktop + ~375px:
   hero shows grade+coverage+context; five compact category rows with sprite thumbs;
   expanded sleep shows one sorted fact list (CO₂ unmet on top), tooltip on the CO₂ row,
   compact unknown/skipped footer; no "Known" labels anywhere; shelf tiles have no
   uppercase state words.

## Round I.2 — riderway live feedback + supervisor findings (2026-07-11)

Round I shipped and verified (typecheck 0 errors, 4/4 tests, live page renders).
riderway reviewed live and requested these fixes; supervisor added token findings:

1. **Status glyphs → colored dots.** The ✓ / ✗ / · text-glyph column "says nothing"
   (riderway). Replace with small round dots (~8-10px, inline SVG circles or spans):
   met → filled olive (`bg-primary`), unmet → filled terracotta (`bg-destructive`),
   neutral/informational → hollow dot (border `border-muted-foreground/50`, no fill).
   Keep an `aria-label`/sr-only text per state ("within target", "needs attention",
   "known"). No lucide check/x icons, no unicode glyphs.
2. **Unknown + skipped back into the list as rows** (not the compact footer line).
   riderway: "niech bedzie na liscie, ale pokazane ze nieznane". Append after known
   rows: unknown rows = dashed-outline dot, muted label, muted "not known yet" in the
   value slot; skipped rows = hollow gray dot with a small "–", muted label, muted
   "skipped" in the value slot. No per-row icons beyond the dot, keep rows visually
   quiet (muted-foreground). Delete the footer line. Update the test that asserted
   the footer copy ("Not known yet: Mattress age") to assert the new row form.
3. **Grade badge C is indistinguishable from A/B.** In this theme `--chart-4` is
   brown `#7d5a3a`, nearly identical to `--destructive` `#8b5d3f`, and at `/15`
   opacity olive and brown both read as the same tan. Fix: C uses a one-off warm
   amber (FRONTEND.md allows one-off arbitrary values), e.g. text `#a8720d`-family
   ochre with matching `/15` background — pick a value that clearly separates from
   both olive `#5a6e32` and terracotta `#8b5d3f` on the cream background and keeps
   AA contrast for the letter. A/B stay `primary`, D/E stay `destructive`.
4. **Drop the "target sauna access" inline text** on the Sauna row (goal text adds
   nothing there); the row still grades (dot color carries it). Same rule anywhere
   else a goal text would merely restate the label.
5. **Bedding overheating goal text** → "never" instead of "no overheating".
6. **Kill the repeated word "target".** riderway: the word repeats 10× per list.
   Restructure each fact row into three columns: `[dot + label] [value] [goal]`,
   goal right-aligned and muted, WITHOUT any "target" prefix. Add one micro column
   header above the list, right-aligned, text-xs muted, reading "Target" — rendered
   once per category and only when the category has at least one goal. On mobile the
   goal wraps under the value, still muted, still no prefix.

Everything else from Round I stays as shipped.

## Round I.3 — impeccable audit fixes (2026-07-11, score 17/20)

Audit passed contrast (all badges ≥4.5:1, muted text 5.22:1), anti-patterns (flat
cards, serif numerals, no AI tells), performance, and overflow (no horizontal scroll
at 375/768/1280). Apply these findings, all in
`apps/web/app/(dashboard)/environment/environment-components.tsx` unless noted:

1. **[P1] Fact-list goal column is too narrow and the "Target" micro-header collides
   with the first row.** On desktop the CO2 goal ("<1000 ppm, ideally <800") wraps to
   3 lines and merges visually with the header. Fix in `FACT_ROW_GRID` +
   `CategoryFactList`: widen the third column (e.g.
   `sm:grid-cols-[minmax(150px,0.9fr)_minmax(90px,0.55fr)_minmax(150px,1fr)]`), and
   separate the header row (e.g. `pb-1.5 mb-1 border-b border-border` on the header
   row, removing `first:pt-0` from the first fact row so the divider rhythm holds).
2. **[P2] The "Target" header renders on mobile** where goals sit inline under values
   (no right column) — orphaned word top-right. Hide it below `sm` (`hidden sm:grid`).
3. **[P2] Hero grade/coverage split at `sm:` is cramped at 768px** with the 256px
   sidebar ("Murph knows 43 of 49" wraps to 3 lines). Move the split to `md:`
   (`md:grid-cols-2`, `md:border-l md:border-t-0`).
4. **[P2] Em dash in UI copy** (repo DESIGN don'ts ban em dashes): page description
   "What Murph knows about your home—and what to check next." in
   `page.tsx` (both `createMurphPageMetadata` and the `PageHeader` description).
   Rewrite without the em dash, e.g. "What Murph knows about your home, and what to
   check next."
5. **[P2] `GradeBadge` uses `aria-label` on a plain `<span>`** — unreliable for
   screen readers. Render the label as an `sr-only` span inside and `aria-hidden` the
   letter glyph (or give the span `role="img"` with the label).
6. **[P3] Duplicate value/goal text** — Overheating row renders value "never" and goal
   "never". In `category-notes.ts`, suppress `target` when it equals the humanized
   value (case-insensitive) so the goal column stays empty there.

## Out of scope

- No catalog (`@murphai/contracts`) changes, no vault/live data wiring.
- No new shared components outside the environment folder (except a shadcn tooltip if
  missing).
- No commit from Codex — Fable reviews and commits via `scripts/finish-task`.
Updated: 2026-07-11
Completed: 2026-07-11
