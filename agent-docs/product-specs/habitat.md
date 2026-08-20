# Habitat: Progressive Member Life-Context

Last verified: 2026-08-20

## Current State

Murph's durable member knowledge covers structured health records (goals, regimens, conditions, allergies, experiments) plus freeform memory. It knows almost nothing about the member's physical circumstances: bedroom conditions, home air and light, workspace ergonomics, or which recovery infrastructure and exercise options are actually within reach. Clinicians rarely ask about these either, yet they gate what advice is realistic. Without them Murph recommends protocols the member cannot run and misses cheap, high-leverage environmental fixes.

Habitat is the umbrella for this knowledge: durable, structured facts about the member's living context that Murph collects progressively — mostly as a side effect of normal conversations — and consults before making recommendations.

## Product Boundary

- Habitat is member-private canonical vault data, never Health Commons content and never assistant runtime state.
- Habitat stores circumstances (what surrounds the member, what they have access to, what they prefer), not medical facts. Diagnosed allergies stay in `allergy`; conditions stay in `condition`; supplement/medication regimens stay in `regimen`. Habitat records link to those where relevant (e.g. home allergen exposure ↔ allergy records).
- Wearables and data integrations are not Habitat. `health-devices` covers only standalone devices without integrations (BP cuff, scale, thermometer).
- Diet is explicitly out of scope for now.
- No gamification or streaks. Grading is a research audit derived from indicators, with per-grade reasoning and a transparent capability bonus (see Environment Audit below).
- Environment v1 describes one primary home. Multi-home and travel profiles are deliberately out of scope.
- The printable Environment report is an authenticated dashboard view. Its
  facts are read from the same private Browser Vault replica as `/environment`;
  no Habitat value is placed in public metadata or a public share asset. The
  separate Share action remains a generic card without member facts.

## Domains

| Domain | Scope | Owner | Status |
| --- | --- | --- | --- |
| `environment` | Home and bedroom: sleep conditions, air, light, water, recovery infrastructure, standalone health devices, home allergen exposure, location/climate. | riderway | Specified in this doc |
| `workspace` | Desk ergonomics and work patterns. Data-model-wise an attribute of the same family; whether it renders as its own page is a UI decision. | riderway | Specified in this doc |
| `exercise` | Sport equipment, venue access, movement preferences and dislikes, sports played and frequency. Massage gun / roller / massage ball belong here (peri-training gear), not in environment recovery. | Rocketman | Skeleton only |
| `supplements` | Maps onto the existing `regimen` family; no new storage. | — | Existing |

## Data Model

One new bank family: `habitat` (markdown registry under `bank/habitat/`, record class `bank`, same registry machinery as goals/conditions).

- **One file per aspect**, not per fact: `bank/habitat/sleep-environment.md`, `home-air.md`, `lighting.md`, `home-location.md`, `water.md`, `recovery-access.md`, `health-devices.md`, `allergens-home.md`, `workspace.md`.
- **Frontmatter carries atomic indicators.** Each indicator is independently `known | unknown (null) | declined`. Example:

```yaml
# bank/habitat/sleep-environment.md
night_temp_c: 19            # number | null
temp_control: ac            # ac | adjustable_heating | none
window_at_night: open       # open | closed | seasonal
co2_meter: none             # aranet | other | none
co2_typical_ppm: null
darkness: blackout          # blackout | partial | bright
updated: 2026-07-07
```

- **Indicator notes carry concise nuance beside each atomic value.** They keep
  explicit measurements, brands, models, setup details, limits, and exceptions
  that the catalog value cannot express. The note is a compact semantic summary,
  not a transcript. A later correction replaces the affected summary so the
  Markdown record does not accumulate contradictory history.
- **Body remains available for broader authored prose** that does not belong to
  one indicator.
- **Declined is a first-class value.** When the member does not want to answer, the indicator records `declined` with a date. Murph does not re-ask; UI shows "skipped" instead of "unknown"; the member can revisit anytime.
- **Freshness matters.** High-priority indicators carry dates; stale critical values are re-confirmed conversationally, not assumed.
- Location is stored at city-or-approximate-region precision, member-stated, declinable. Climate, season, daylight hours, pollen season, and ambient air quality are derived from it rather than asked separately.

## Domain Catalog

A typed, versioned catalog in `packages/contracts` (product spec, not per-member state) defines: domains → aspects → indicators, and per indicator: id, value type/enum, priority (`high | medium | low`), an example conversational question, and an optional evidence target (e.g. `co2 < 1000 ppm`). Low priority means: never proactively asked; filled only when context surfaces it.

Questions in the catalog are conversation starters, not form fields. One natural question ("do you sleep with the window open?") routinely fills several indicators at once; the agent extracts every indicator the answer contains.

Natural speech never has to repeat a catalog enum token. The visible prompt and
field labels provide the question context. When one field remains, a concise
answer that is valid for that field maps to it even when the member omits the
label or uses a sentence fragment. For enum fields, the extractor normalizes
synonyms, natural descriptions, and more specific equivalent terms to the
matching canonical value. With several fields, it saves a concise answer only
when the meaning identifies the field clearly. Ambiguous answers remain
unknown. The UI marks a field complete only after the canonical value is
accepted for persistence.

The catalog remains the source of truth for allowed values. Do not maintain a
separate synonym list for every indicator unless measured ambiguity proves that
the general semantic rule is insufficient.

If the catalog grows editorial weight (long "why it matters" copy), migrate it to the health-commons authored-content pattern; start as a plain typed constant.

## Coverage

`computeHabitatCoverage(vault, catalog)` is a pure derivation: per domain and aspect, which indicators are known / unknown / declined / stale. No stored scores, no new state. Two consumers:

1. **Assistant prompt** — a compact coverage summary injected through the existing `assistantContextSnapshotPrompt` layer: what is known plus the top high-priority gaps.
2. **Web UI** — domain pages and the future home visualization read the same derivation from the browser-vault replica.

## Collection Rules

Ordered by importance:

1. **Opportunistic (primary).** When the member raises a topic ("sleeping badly"), Murph first reads what it already knows (mattress, temperature, CO2, screens…), uses it in the answer, and asks about a missing indicator only when the answer would improve the current help — the question is part of the advice, never a survey. When the value is not obvious, Murph explains the context dividend.
2. **Photos as input.** During onboarding or gap-filling the member can send a photo of the bedroom, desk, home gym, or sauna; Murph extracts indicators from the image (darkness, LED sources, monitor height, equipment) and saves them like any other answer. This is an input mechanism for all aspects, not a separate feature.
3. **UI handoff.** A web zone showing "unknown" (or a weak audit grade) offers "Fill this in with Murph": a deep link into the member's chosen channel (iMessage/Telegram) with a prefilled opener; the member writes freely and Murph parses and saves all indicators at once.
4. **Realtime voice walkthrough.** The authenticated Environment page streams
   microphone audio through a short-lived Realtime session while showing one
   topic at a time. With no resolved facts, the script covers all five
   categories. A partial profile asks only for unresolved high- and
   medium-priority facts. Once those facts are resolved, the script becomes one
   free-form update prompt. The extractor saves explicit catalog values and an
   optional concise note for useful detail that the value cannot express. It
   receives the prior note during updates, preserves details that remain true,
   and removes contradicted details. Raw audio and the live transcript are not
   Habitat records or conversation history. Ambiguous details remain unknown.
   Notes never retain a precise home address. The page refreshes its private
   Browser Vault replica after accepted writes. It waits for a newer replica
   before it marks the update complete, so saved details appear without a full
   page reload. A member can also start the same walkthrough for one category;
   that script includes every unresolved field in the category, including
   optional context. Delayed processing does not close the interview surface.
5. **New-member onboarding.** Ask a Habitat question only when it supports the selected first thread. Ask at most one; there is no universal environment checkpoint or Habitat survey.
6. **Scheduled nudges (rare, supplementary).** Coverage gaps are advisory evidence, not a question queue. An ordinary turn started by an authorized scheduled automation may pick one high-priority gap only when the answer would unlock useful help, subject to `agent-docs/operations/imessage-deliverability.md` pacing and quiet hours.
7. **Write-through.** Every answer saves immediately to `bank/habitat/<aspect>.md` via the habitat CLI command, with dates.

## Environment v1 — Aspects and Indicators

Priorities: **H** = proactively collectable, **M** = ask when nearby topic arises, **L** = context-only, never proactively asked.

### `home-location` — location and climate

| Indicator | Values | Priority |
| --- | --- | --- |
| `location` | city or approximate region (member-stated, declinable) | H |
| `area_type` | urban_center / suburbs / rural | M |
| `travel_pattern` | mostly_home / frequent_travel | L |

### `sleep-environment` — bedroom and sleep

Evidence anchors: 18–22°C air temperature (~−0.16% sleep efficiency per +1°C above range); CO2 < 1000 ppm (preferably < 800); noise < 35 dB; full darkness; 40–60% RH.

| Indicator | Values | Priority |
| --- | --- | --- |
| `night_temp_c` + `temp_control` | number; ac / adjustable_heating / none | H |
| `window_at_night` | open / closed / seasonal | H |
| `co2_meter` + `co2_typical_ppm` | device enum; number | H |
| `darkness` + point light sources | blackout / partial / bright; LEDs, standby lights, streetlight | H |
| `noise` + sources + countermeasures | subjective quiet/moderate/loud; street, partner, pets; earplugs, white noise | H |
| `humidity` + humidifier/dehumidifier | known %, unknown; device | M |
| `mattress` (age, firmness, satisfaction) + `bedding` (duvet too warm/ok, pillow fit, night overheating) | structured + prose | M |
| `co_sleepers` | partner / kids / pets in bed or room | M |
| `screens_in_bedroom` | TV; phone by the bed vs another room | M |

### `home-air` — air quality

Evidence anchors: WHO indoor PM2.5 guidance; gas stoves emit NO2; mold/damp is a high-priority respiratory risk.

| Indicator | Values | Priority |
| --- | --- | --- |
| `ventilation` | mechanical_recuperation / mechanical / windows_only | H |
| `damp_or_mold` | problems / none | H |
| `air_purifier` | hepa / other / none; which zone | M |
| `air_quality_meter` | pm25 / co2 / none | M |
| `stove` | gas / induction / electric; extractor hood use | M |
| `smoke_sources` | indoor smoking, fireplace, frequent candles | L |
| `radon` | tested / not; only asked in risk region + ground floor/basement | L |

### `lighting` — light environment

Evidence anchors: morning daylight anchors circadian rhythm (10–30 min within 1h of waking); evening light ≤ 2700–3000K dimmed; cool bright light suppresses melatonin.

| Indicator | Values | Priority |
| --- | --- | --- |
| `evening_light` | warm ≤3000K / cool / mixed; dimmers; last-2h routine | H |
| `morning_light_access` | balcony / garden / east windows / none; outdoor routine | H |
| `daytime_light` | window workspace / bright 5000K+ / dim | M |
| `bulb_cri` | CRI ≥90 where evenings are spent; surfaces when member asks for bulb advice | L |
| `light_therapy_lamp` | present / none; winter context | L |

### `water`

| Indicator | Values | Priority |
| --- | --- | --- |
| `drinking_water` | tap / filtered (filter type) / bottled | L |

### `recovery-access` — recovery infrastructure

| Indicator | Values | Priority |
| --- | --- | --- |
| `sauna` | home / gym / nearby / none; dry/steam/IR; realistic frequency | H |
| `cold_exposure` | cold_shower / plunge / winter_swimming / none; seasonality | M |
| `red_light` | panel (model → dosing) / access / none | M |

Massage gun / roller / massage ball: `exercise` domain, not here.

### `health-devices` — standalone measurement devices

| Indicator | Values | Priority |
| --- | --- | --- |
| `devices` | scale (smart?), BP cuff, thermometer, pulse oximeter, CGM without integration | M |

### `allergens-home` — home allergen exposure

Links to `allergy` records; exposure lives here, diagnoses there.

| Indicator | Values | Priority |
| --- | --- | --- |
| `exposure` | pets (which), carpets/rugs, mold-prone plants, regional pollen | M |

## Workspace v1 — Indicators

Evidence anchors: top of screen at eye level, 50–75 cm viewing distance, desk at elbow height, Cornell 20-8-2 sit/stand/move pattern; sit-stand alternation reduces upper-body discomfort 20–32%.

| Indicator | Values | Priority |
| --- | --- | --- |
| `work_mode` + `desk_hours` + commute | remote / office / hybrid; hours/day | H |
| `desk` | standing_adjustable (used standing?) / fixed | H |
| `screen` | laptop_only / external; top vs eye line; distance; count | H |
| `chair` | ergonomic / ordinary / varies (couch); lumbar support | M |
| `keyboard_wrists` | external keyboard/mouse with laptop; neutral vs bent wrists; complaints | M |
| `breaks` | none / irregular / systematic (pomodoro, walks) | M |

## Environment Audit

Zone/aspect grades (A–E or `unknown`) render on the home visualization — specified now, built only after the foundation ships. Framing: research audit, not gamification — every grade traces to named indicators, ships with reasoning and a concrete "what to improve" list; no points, streaks, or celebratory copy. Grading rubrics live in the catalog (versioned product spec), evidence-anchored per aspect. All thresholds below are tunable defaults.

**Scale.** A = optimized (high-priority indicators known and on target) · B = good (minor gaps, no high-impact issue) · C = needs attention (≥1 high-impact indicator off target) · D = poor (several off target) · E = act now (a red-flag indicator with documented health risk, e.g. visible mold, indoor smoking, or a known high-radon result; red flags also cap the grade) · `unknown` = coverage below threshold; first-class state that invites the UI handoff.

**Levels (all derived, never stored):**

1. Indicator status: each gradeable condition evaluates against its catalog rule to on-target / off-target / unknown / declined. Informational facts never become off-target conditions.
2. Context and access status: facts without a universal healthy target — including window habits, ventilation type, stove type, work mode, and equipment — stay informational. Selected capabilities can add a positive catalog-owned bonus. Missing, absent, or declined capabilities remain neutral.
3. Zone grade: coverage = known gradeable conditions ÷ all gradeable conditions; below 50% the zone is `unknown`. Base score = on-target ÷ known, mapped ≥90% A · ≥75% B · ≥55% C · ≥35% D · else E. `declined` is excluded from the denominator — declining is respected, never penalized. The overall Environment score adds the catalog's deduplicated capability bonus, capped at 15 percentage points and 100% total. Related indicators share a capability group so one device counts once. Zone grades remain condition-only.
4. Red-flag cap: a known urgent exposure such as visible mold, indoor smoking, or a high-radon result forces an E once enough gradeable conditions are known to issue a grade. Missing, declined, and `not_tested` radon remain neutral. The UI still discloses the raw within-target proportion and names the cap instead of disguising it as a lower percentage.
5. Domain/home grade: the same formula runs over all gradeable conditions in the domain and is always displayed with its coverage so confident grades and thin-data grades never look alike.

## Environment UI

- `/environment` reads the private Browser Vault replica. Production UI never substitutes fixtures for missing member data.
- Zero-data members see a benefit-led empty state with voice and chat entry points. Sparse records keep the report visible and offer a voice script derived from unknown, non-declined high- and medium-priority facts, including useful informational context such as city, ventilation, and work mode. Once those collection-eligible facts are resolved, the fill-gaps action becomes a free-form voice or chat update. Each category also offers one voice action that covers all its unresolved fields, including optional context. There are no edit forms. The open page waits for a newer Browser Vault replica after accepted voice writes and updates the visible report without a full reload.
- The page shows derived A–E grades only after at least 50% of gradeable conditions are known. Missing and declined data never lower the grade. The overall score shows its condition base and positive capability bonus separately. Optional access can improve the score, but its absence is neutral.
- Assessment coverage always names its known gradeable conditions. It remains
  distinct from the larger set of optional and conversational details that a
  voice walkthrough can still collect.
- Each zone offers a conversational handoff.
- Current outdoor weather and air quality derive transiently from the member-stated city through a server-owned provider key. The browser sends only that city to the authenticated same-origin endpoint; results are not persisted as Habitat facts and outdoor air is never presented as indoor air.
- Public Open Graph previews remain generic. An authenticated, member-started
  share action can create a personal image with the derived score and coverage.
  That image excludes location, answers, notes, and other private Habitat facts.
- The existing `/context` ("What Murph knows") page becomes the umbrella; domains grow their own pages.

## Phasing

1. **Foundation:** `habitat` bank family in `packages/contracts` (family id, descriptor, frontmatter/upsert schemas, registry definition) → `packages/query` canonical family + replica inclusion → `vault-cli habitat save/show` via the health-command-factory pattern → coverage derivation → tests per the family-addition checklist.
2. **Agent behavior:** coverage summary through `assistantContextSnapshotPrompt`; opportunistic-collection guidance; onboarding hook (1–2 questions); photo-extraction guidance; declined handling.
3. **Environment UI:** domain page over replica data; UI→channel handoff CTA.
4. **Audit + home visualization; scheduled nudges.**

## Decisions Log

- 2026-07-07 — Umbrella named **Habitat** ("setup" sounded one-off; "context" is overloaded in AI). Family id `habitat`.
- 2026-07-07 — Four domains confirmed: environment, workspace (same family, `domain` attribute; page split is a UI call), exercise (Rocketman), supplements (existing `regimen`).
- 2026-07-07 — Location stored at city-or-approximate-region precision, declinable.
- 2026-07-07 — Massage gun / roller → exercise domain.
- 2026-07-07 — Declined answers are recorded with a date and respected permanently (member can reopen).
- 2026-07-07 — Audit grades: specified now, built after the foundation; research-audit framing to stay inside the no-gamification boundary.
- 2026-07-07 — Photos are a general input mechanism for all aspects, not a standalone ergonomics-assessment feature.
- 2026-07-23 — Environment v1 supports one primary home; travel and multiple-home profiles stay out of scope.
- 2026-07-23 — Habitat is not added as a universal onboarding survey. Collection is opportunistic, conversational, or a user-started voice walkthrough.
- 2026-07-23 — Grades measure known conditions and habits. Optional equipment and access are neutral when absent; missing and declined facts are excluded until coverage is sufficient.
- 2026-07-23 — Live weather and outdoor air quality are transient city-level context, not stored member truth.
- 2026-07-29 — Every non-informational catalog indicator must have an evaluator. Context without a universal target stays informational, while visible mold, indoor smoking, and a known high-radon result cap a sufficiently covered audit at E.
- 2026-08-20 — Selected informational capabilities can add value-specific positive credit to the overall Environment score. The catalog owns each coefficient and deduplication group. The bonus is capped at 15 percentage points and the final score at 100%; absence stays neutral, and red-flag grade caps still win.
- 2026-07-30 — The voice walkthrough uploads privately to the authenticated Murph path. Audio is staged application-encrypted, processed by a silent Habitat-only turn, deleted after the canonical checkpoint, and covered by a 24-hour R2 lifecycle backstop; no iMessage, Telegram, or browser share sheet is part of the primary flow.
- 2026-07-30 — Voice guidance has three modes: five-category first walkthrough, catalog-derived gap filling for unknown high- and medium-priority facts that excludes declined facts, and one free-form update prompt once those collection-eligible facts are resolved. Grade coverage does not select the script.
- 2026-07-30 — Every ordinary Habitat write and live-conditions egress may retain or send only a member-stated city or approximate region; precise addresses are rejected and unsafe legacy values fail closed before provider egress.
- 2026-07-30 — First-seen Environment voice uploads use the existing AI-usage gate, one unconsumed recording per member, and a server-enforced three-minute media cap. Exact retries remain idempotent, and the open page polls Browser Vault long enough to show the processing result.
- 2026-07-31 — `/environment/print` is authenticated and derives its printable
  report from the signed-in member's Browser Vault data. The public Share card
  remains generic and contains no private Habitat facts.
- 2026-08-11 — Before uploading an Environment recording, the page captures its displayed Habitat values. After durable processing finishes, the page explicitly requests a Browser Vault refresh; the provider treats that request's response as the admission boundary and waits for a later replica reference before reporting completion. The delayed notice retains that original fence. Environment-owned runtime-refresh observation stops after a bounded five-minute window; independent session-freshness polling may continue when the server reports its own pending work, but it cannot replace or re-signal that fence. Check again ordinary-reads first, then conditionally sends one idempotent refresh signal for the same boundary when no newer replica exists. Repeated checks in that window cannot create duplicate refresh pressure, and a newer ordinary-read replica completes without another signal or recording.
