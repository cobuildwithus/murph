# iMessage health primitives

Status: completed
Created: 2026-08-30
Updated: 2026-08-31

## Goal

- Let a member ask for a fixed seven-calendar-day wearable view and receive one
  deterministic, glanceable iMessage card whose day slots, averages, trend
  labels, values, sparklines, units, and HRV method come from trusted query
  code rather than model-authored formatting.
- Let the member save that metric selection for exact reuse without scheduling
  it, and inspect the latest occurrence of an existing automation without
  conflating configuration, generation, provider send, and handset delivery.

## Success criteria

- The seven-day query returns exactly seven ascending local calendar dates,
  preserves missing dates as null, caps future dates, computes averages from
  observed values, compares against the prior seven calendar dates, and keeps
  RMSSD and SDNN distinct.
- Sleep slots reuse the canonical eligible-night/date anchoring rules instead
  of treating naps or overlapping sessions as nightly sleep.
- The iMessage response is a read-only static card with one shared day axis and
  one to five metric rows. Each row contains only its label/method, average,
  neutral direction, seven values, and seven-position sparkline. There are no
  controls, metric icons, legends, pills, or explanatory footer copy.
- Card content and complete text recovery are built deterministically from the
  trusted query result. The assistant supplies only metric keys or a saved-view
  ID and cannot transcribe health values into the card payload.
- Capability failure or definitive pre-acceptance rejection uses the complete
  deterministic text recovery; notification/provider preview text contains no
  private values.
- A member can create, list, inspect, edit, delete, and use a typed saved health
  view. Saving never creates an automation and does not mutate the managed
  weekly digest.
- Existing automation inspection reports its next occurrence and a bounded,
  redacted latest-occurrence receipt. Provider dispatch is reported as sent;
  handset delivery remains unconfirmed unless a future authoritative receipt
  source exists.
- Complete, sparse, all-missing, method-specific HRV, and text/static fallback
  states have deterministic tests and synthetic design-route proof.
- A focused real-model assistant journey proves that a direct request selects
  the dedicated card tool and returns the card without duplicate prose.
- Relevant package tests, typecheck, exact-head final ReviewGPT, and repository
  finish checks pass before handoff.

## Scope

- In scope:
  - Query-owned fixed seven-day wearable snapshot for steps, total sleep,
    resting heart rate, HRV RMSSD, and HRV SDNN.
  - Typed response-card contract, deterministic formatting, static renderer,
    complete text recovery, and existing outbox/Linq delivery integration.
  - Typed saved-health-view preferences with stable IDs and bounded CRUD.
  - Dedicated assistant attachment tool accepting metric keys or saved-view ID.
  - Latest automation occurrence receipt projected into existing inspect output.
  - Synthetic design study, changelog, documentation, tests, and rollout notes.
- Out of scope:
  - Group-chat health cards, editable/tappable cards, a new scheduler or queue,
    automatic recurrence, or changes to managed weekly-digest prose.
  - Generic user-authored template languages or storing wearable values in
    preferences.
  - Causal or clinical claims, health scores, and better/worse judgments.
  - Native Messages-extension changes, provider image-fetch callbacks, or
    claiming handset delivery from provider dispatch alone.

## Constraints

- Technical constraints:
  - Query owns metric/date/trend semantics; presentation owns only formatting.
  - The fixed-card payload must be immutable, authority-free, bounded, and
    renderable without Browser Vault or runtime queries.
  - Existing outbox idempotency, route validation, capability probe, and
    ambiguous-mutation behavior remain authoritative.
  - Preferences remain backward-compatible when `savedHealthViews` is absent;
    empty collections are omitted and all existing writers preserve the field.
  - HRV always uses an explicit method-specific key and label.
- Product/process constraints:
  - Entry point is an explicit private-direct iMessage request. Recurrence is a
    separate existing automation action that requires an explicit request.
  - Missing data remains visibly missing and is never compressed or zero-filled.
  - Direction language is neutral: higher, lower, steady, or unavailable.
  - UI proof must represent common three-metric, sparse maximum-density, and
    all-missing states using synthetic data only.
  - This cross-owner feature follows the active-plan, Product UX, exact-head
    ReviewGPT, changelog, scoped-commit, and pull-request workflow.

## Product UX plan

- Outcome: a member can scan recent direction and daily variation without
  reading prose or asking the assistant to honor a fragile formatting template.
- Entry points:
  - Ask for a seven-day wearable trend in a private direct conversation.
  - Ask to save or reuse a named health view.
  - Ask when an existing automation ran or whether it sent.
- Primary states:
  - Complete three-metric data.
  - Sparse one-to-five-metric data with retained empty day slots.
  - All-missing data with truthful unavailable summaries.
  - Explicit RMSSD or SDNN HRV.
  - Rich static card, no-app/macOS text recovery, and definitive send rejection.
  - Saved view present, updated, deleted, or missing when an automation runs.
  - Automation configured but not observed, pending, sent, failed, skipped, or
    completed without a message.
- Accessibility and density:
  - Use one shared seven-consecutive-day axis, tabular numerals, sufficient contrast,
    and one neutral series accent.
  - The text recovery repeats the date range and each named day value; missing
    values read as no data rather than zero.
  - The raster sparkline is redundant with visible direction and daily values.
    Physical VoiceOver behavior is a rollout gate because native extension
    source and provider image accessibility are outside this repository.
- Walkthrough proof:
  1. Request steps, sleep, and HRV and receive exactly one compact response card.
  2. Compare all seven day columns and identify gaps without opening another UI.
  3. Save the ordered selection, reuse it, edit it, and verify no schedule was
     created.
  4. Explicitly schedule the saved view through the existing automation path.
  5. Inspect the automation and distinguish next run, latest outcome, provider
     send, and unconfirmed handset delivery.

## Risks and mitigations

1. Risk: Seven latest observations are mislabeled as seven calendar days.
   Mitigation: add a dedicated fixed-calendar query and tests for gaps,
   time-zone boundaries, future caps, and the prior calendar window.
2. Risk: The model again reformats or transcribes metric values.
   Mitigation: accept only metric keys/view ID in the assistant tool and build
   the final query result, card, average, and sparkline in deterministic code.
3. Risk: Generic HRV combines incompatible measurements.
   Mitigation: reject generic HRV and expose RMSSD and SDNN as distinct keys.
4. Risk: A static card is accepted but the image later fails or VoiceOver does
   not expose its contents.
   Mitigation: keep complete deterministic text recovery for known send
   failures and require physical installed-app, no-app, macOS, image-failure,
   and VoiceOver proof before broad rollout. Do not place private values in
   provider preview text.
5. Risk: Saving a display silently creates outreach or changes a managed digest.
   Mitigation: preferences store configuration only; recurrence remains a
   separate explicit action on the existing automation owner.
6. Risk: Provider dispatch is presented as handset delivery.
   Mitigation: use an explicit receipt projection whose terminal public state is
   sent with delivery unconfirmed unless authoritative delivery evidence exists.
7. Risk: Older strict preference readers reject the new optional field.
   Mitigation: align contracts/core/runtime release availability and document
   the minimum rollback floor after the first saved-view write.

## Tasks

1. Add the shared method-specific metric-key contract and fixed-calendar query.
2. Add the typed card contract, deterministic formatters, static raster route,
   delivery adapter, and complete text recovery.
3. Add saved-view preference CRUD, use-case/CLI surfaces, audit behavior, and
   preservation through every preferences writer.
4. Add the redacted latest-occurrence projection to automation inspection.
5. Add the dedicated assistant attachment tool and focused real-model journey.
6. Add synthetic design proof, changelog, rollout note, and regression tests.
7. Run focused and broad verification, exact-head final ReviewGPT, privacy/diff
   audit, finish-task, and the scoped pull-request workflow.

## Decisions

- Use a dedicated health-trend card rather than packing opaque strings into the
  generic compact-table schema; realistic seven-value rows do not fit its
  intended horizontal layout and cannot enforce metric semantics.
- The card is static, immutable, and non-tappable. Existing provider capability
  and text-recovery behavior remains the delivery owner.
- Query data uses seven ascending local dates. Averages use observed values;
  trend requires adequate observations in both current and prior seven-day
  windows and otherwise reports unavailable.
- Saved views live in typed preferences and store ordered configuration only.
- Automation status extends the existing inspect action with a projection; it
  does not add another receipt record or public error surface.
- Production card planning is exact-value default-off behind
  `MURPH_WEARABLE_TREND_CARDS_ENABLED=1`. The candidate may land dormant, but
  enabling remains blocked on the physical installed-app, app-absent, macOS,
  image-failure, and VoiceOver checks already named above.
- Terminal delivery reconciliation stores one bounded reason variant in the
  existing run journal before clearing the outbox pointer, preserving exact
  non-dispatch, provider-dispatch, and ambiguous evidence without a new store.

## Scope-anomaly retrospective

- Original requirement: build all three durable primitives behind the compact
  seven-day health-template request: trusted card generation, a reusable saved
  metric view, and truthful inspection of the latest scheduled occurrence.
- Candidate shape: 3,524 authored-source additions and 97 deletions (3,621
  lines of source churn), plus 4,119/101 tests, 403/9 docs, 13/1 config, and
  189/1 generated lines. Review-driven growth added explicit provider-dispatch
  receipt states and their tests; the final complexity pass then extracted
  small helpers without changing behavior. The largest source owners remain
  the bounded card contract, read-only occurrence projection, static renderer,
  fixed-window query, and typed preferences extension rather than repeated
  copies of one mechanism.
- Decision: continue as one product-indivisible feature. Although the files are
  mechanically separable, the requested acceptance journey is one contract:
  ask for a trusted view, save and reuse that exact selection, schedule it only
  on explicit request, then inspect whether its latest occurrence reached the
  provider without claiming handset delivery. Splitting at this point would
  expose partial cross-version contracts across assistant guidance, saved-view
  references, response-card delivery, and automation inspection, and would
  duplicate sensitive rollout/review gates without deleting an owner.
- Complexity check: the implementation reuses the existing query projection,
  preferences lock/audit writer, automation journal/runtime/outbox evidence,
  response-card outbox, V7 static renderer, and CLI generator. It adds no new
  queue, store, scheduler, lease, retry loop, or reconciliation mechanism.
  Obsolete generic-template handling was not retained. The exact complexity
  guard passes; the two largest touched assistant files reduced their debt or
  maximum complexity after mechanical helper extraction. Further substantive
  review growth or another owner would reopen the split/delete decision.

## Verification

- Commands to run:
  - Focused tests for contracts, query, core/preferences, use cases, CLI,
    operator config, assistant engine/runtime, and Web card rendering.
  - Static renderer snapshots/raster containment and design-route tests.
  - `pnpm test:assistant:live -- --test "<unique health-view journey>"`.
  - Repository typecheck and the broadest relevant workspace test command.
  - Final exact-head ReviewGPT with the repository-default wait.
  - Repository finish-task checks and a final privacy/diff audit.
- Expected outcomes:
  - All automated checks pass with no value/date/model transcription drift.
  - Real-model output contains the dedicated card and no competing prose.
  - Review findings are resolved or explicitly documented as rollout gates.
  - Physical-device checks remain a clearly identified pre-rollout item rather
    than an unverified claim in the pull request.

### Verification results on the final code candidate

- UI: 19/19 wearable-card image, design-study, and raster-containment tests
  pass. The reviewed card component did not change during remediation.
- Assistant behavior: 103/103 route-planning cases and 31/31 focused card,
  prompt-gate, and occurrence-receipt cases pass. A wider assistant-engine run
  passed 4,303 tests with one combined-branch digest mismatch; after updating
  that deterministic expectation, the exact 103-case file passed.
- Runtime and packaging: 76/76 hosted-execution, 67/67 assistant-runtime,
  6/6 focused CLI, 518/518 focused Cloudflare, and 43/43 runner-bundle budget
  tests pass. The exact packaged bundle measured 11,738,413B total, 67,653B
  entry, and 2,001,470B static boot closure across 21 chunks; only the measured
  total baseline moved, while all startup-specific limits stayed fixed.
- Data and contracts: 360/360 contracts/artifact checks, 26/26 core preference,
  7/7 saved-view use-case, 7/7 seven-day query, and 6/6 response-card adapter
  checks pass.
- Typecheck passes for assistant-engine, assistant-runtime, CLI, Cloudflare,
  and Web. The focused real-Codex journey passes with ordered steps, total
  sleep, and RMSSD metrics, one trusted wearable card, and no competing prose.
- The exact hosted-local scheduled-message scenario is blocked before Murph
  starts on this ARM development host: the current amd64 runner image exits in
  `tini -s` because subreaper mode is unavailable under local emulation. The
  image builds, the bundled CLI starts in an independent parity check, and
  Docker/Temporal are healthy, but neither Murph nor the bundled CLI starts
  inside the failing smoke container. This is not a feature-path failure;
  exact container E2E remains a Linux CI gate.
- Exact-head GitHub Actions pass, including the required macOS and Ubuntu CLI,
  release, billing, Temporal, runner-bundle, package-coverage, privacy, and PR
  evidence checks. The optional Vercel preview also passes.
- Final full-snapshot ReviewGPT on `4aa647626a` returned
  `ROUND_OUTCOME: PASS` with no findings. Its exact-turn capture ran past the
  documented fallback floor and records the compatible `gpt-5-6-pro` response
  model for the requested `gpt-5.6-sol` lane. The reviewer noted that the ZIP
  lacked a readable raster; parent review independently inspected the synthetic
  maximum-density card and confirmed the tested hierarchy, alignment, gaps,
  averages, trends, and separate RMSSD/SDNN labeling.
- After `main` advanced, its newer bounded-memory and normalized-wearable prompt
  guidance was preserved alongside the default-off health-card guidance. The
  resolved merge passes 103/103 planning tests, 31/31 focused health-card and
  prompt tests, assistant-engine typecheck, and the complexity guard.
- Physical installed-app, app-absent, macOS, image-failure, and VoiceOver proof
  remains required before enabling the exact-value rollout flag.

### Provider-input measurement

- A paired base/head capture drove the pinned real Codex App Server against a
  local scripted Responses endpoint with identical synthetic direct and group
  automation prompts, `gpt-5.6-terra`, low reasoning, and production code mode.
  `gpt-tokenizer` 3.4.0 `o200k_harmony` measured the normalized serialization of
  `include`, `input`, `parallel_tool_calls`, `text`, and `tool_choice`;
  `instructions` and `tools` were absent. Volatile UUIDs, Codex-home/workspace
  paths, and runtime-root paths were normalized. Model selection, reasoning,
  store/stream flags, prompt-cache/client metadata, and transport metadata were
  excluded identically.
- Direct changes from 33,085 tokens / 154,590 UTF-8 bytes to 33,361 / 155,620:
  +276 tokens (+0.8342%) and +1,030 bytes. Group changes from 25,641 tokens /
  118,904 bytes to 25,694 / 119,199: +53 tokens (+0.2067%) and +295 bytes.
  Only the selected `input` field changed. Direct adds the trusted-card catalog
  entry plus health-view and occurrence-receipt guidance; group adds only the
  occurrence-receipt guidance. Measurement-only instrumentation was removed.
Completed: 2026-08-31
