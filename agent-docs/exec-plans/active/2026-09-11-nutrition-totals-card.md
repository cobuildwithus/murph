# Logged nutrition without required targets

Status: active. Implementation and focused checks complete; PR review in progress.
Date: 2026-09-11

## Outcome

An ordinary private meal-log reply (including a reply to a scheduled check-in),
an explicit daily summary, or an eligible managed closeout receives the owned
nutrition card when canonical same-date totals and numeric suitability permit.
Missing accepted goals selects totals-only presentation, never goal creation.

## Owners and authority

- Contracts and operator-config: all-null or all-five fresh V2 authoring;
  historical nullable readers unchanged; deterministic text and channel layout.
- Query meal totals/goal resolver: sole totals and selected-date target authority;
  conflict, incompatible and capacity are not missing or acceptance.
- Food journal: verified meal mutation, incomplete-meal recovery and numeric
  preferences. Nutrition strategy: explicit target proposal/explanation/acceptance.
- Automatic meal capture: occurrence date, capture cleanup and bounded questions;
  scheduled work cannot propose or mutate goals.
- Assistant final reply/outbox: only fixed nutrition introduction, one effect,
  private audience and retry/fallback ownership. Canonical memory records an
  invitation only after owned successful send evidence, not tool staging.
- Web static renderer + Linq/Telegram adapters: honest totals-only presentation.
  Native Swift is external to this snapshot and is not changed.

## UX journeys and non-goals

Invented lentil-lunch check-in reply -> canonical meal readback -> one dated,
estimated logged-so-far card, no target writes. First suitable card may include
one fixed optional-goals introduction. Subsequent cards and prior declines do not
repeat it. Explicit target-setting remains proposal then acceptance; silence and
meal replies never accept. Incomplete unrelated breakfast -> short fallback, no
repair on ordinary lunch reply. Explicit partial request retains partial coverage.
Number-sensitive context -> nonnumeric capture; group and compound-request gates
remain. Compatible five-goal and legacy readers retain behavior.

No new store, scheduler, dependency, guessed physiology, or sharing surface.

## Execution and decisions

- [x] Trace attachment -> semantic reply -> outbox -> provider -> confirmation.
- [x] Implement all-null authoring, owned presentations and bounded introduction.
- [x] Update skills, generated-guidance sources, spec, owner docs and changelog.
- [x] Add deterministic and focused real-Codex journeys; self-review full diff.
- [x] Verify patch applies to the supplied snapshot.

Invitation suppression uses canonical memory, not staging as delivery evidence.
No claim of handset receipt: a provider-confirmed send is the evidence boundary.
Confirmation retries reuse the existing outbox reconciliation path. Cross-turn
in-flight concurrency and recovery limits must be documented in the product spec.

## Skew / deployment

Deploy updated static renderer and delivery adapters before enabling new authoring.
V2 wire version is unchanged. Totals-only uses Linq interactive:false so old native
extensions do not draw a goal ring. Goal-aware native cards are unchanged. Old
server authoring validators reject new null authoring; old renderers can show
unavailable goals, so mixed server versions are not product-compatible.

## Verification

ReviewGPT authored the implementation patch against the task base. Parent review
corrected stale goal-required assertions, compared stable memory records instead
of generated empty-document timestamps, refined invitation copy, and improved
small-card label sizing.

- Contracts, operator-config and assistant-engine typechecks: passed.
- Web typecheck and changed-component ESLint: passed.
- Operator card/Linq/parity tests: 105 passed after correcting two stale expectations.
- Assistant prompt/skill, attachment, invitation and outbox tests: all selected
  assertions passed across the initial run and focused correction reruns.
- CLI authoring compatibility: 5 passed. Canonical goal resolver: 21 passed.
- Web image component: 25 passed. Changelog page: 10 passed.
- Browser production-component study: passed at 390px and 1440px; parent inspected
  both synthetic captures. Static provider/handset composition remains unavailable.
- Real subscription journey on gpt-5.6-terra: reminder meal reply passed, one
  totals-only card and no Goal writes. A repeat caught an unnecessary progress preamble; tightened the existing routine-meal progress guidance. Focused reply review remains in progress.
- Complete first-provider request measurement, identical synthetic fixtures:
  direct 177109 -> 177254 UTF-8 bytes (+145, +0.082%); group 161198 -> 161198
  (0). Excludes only prompt_cache_key. Exact Terra tokenizer unavailable, so
  no token totals are claimed.
- Complexity diff: pass; no increase in debt above 20. Existing dispatch/parser
  hotspots remain unchanged in responsibility; no broad refactor is justified.

## Remaining completion gates

- [ ] Final focused live reply and suppression review.
- [ ] Draft PR, current reviewer-openable design evidence and source PR reference.
- [ ] Parent candidate review, final ReviewGPT and exact-head CI.
- [ ] Close this plan and verify base mergeability.

No live member delivery or production mutation was performed. Rollout must
verify actual provider/handset composition; local HTTP contracts and browser
component captures do not prove a received Messages or Telegram balloon.
