# Logged nutrition without required targets

Status: completed
Final closure-head CI remains a PR acceptance gate, recorded in PR #3347.
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
estimated logged-so-far card, no target writes. First suitable card includes
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
small-card label sizing. A first-summary replay ended immediately after attachment; the existing attachment success response now reminds the model to include the fixed invitation when eligible.

- Contracts, operator-config and assistant-engine typechecks: passed.
- Web typecheck and changed-component ESLint: passed.
- Operator card/Linq/parity tests: 105 passed after correcting two stale expectations.
- Assistant prompt/skill, attachment, invitation and outbox tests: all selected
  assertions passed across the initial run and focused correction reruns.
- CLI authoring compatibility: 5 passed. Canonical goal resolver: 21 passed.
- Web image component: 25 passed. Changelog page: 10 passed.
- Browser production-component study: passed at 390px and 1440px; parent inspected
  both synthetic captures. The deployed preview study and actual 1200×539 image route returned HTTP 200; the generated PNG was inspected. Handset composition remains unavailable.
- Real subscription journeys on gpt-5.6-terra: six focused scenarios passed:
  reminder meal reply, first summary, prior decline, number-sensitive logging,
  unrelated incomplete breakfast, and managed closeout retry. Parent reviewed
  replies, one-card/suppression counts and absence of Goal mutations: Ready.
  First-summary/decline were rerun after attachment feedback was clarified.
- Complete first-provider request measurement, identical synthetic fixtures:
  direct 177109 -> 177400 UTF-8 bytes (+291, +0.164%); group 161198 -> 161198
  (0). Excludes only prompt_cache_key. Exact Terra tokenizer unavailable, so
  no token totals are claimed.
- Complexity diff: pass; no increase in debt above 20. Existing dispatch/parser
  hotspots remain unchanged in responsibility; no broad refactor is justified.

## Remaining completion gates

- [x] Final focused live reply and suppression review.
- [x] Draft PR #3347, source PR reference and inspected screenshot attachments.
- [x] Current reviewer-openable design preview build.
- [x] Parent candidate review.
- [x] Final ReviewGPT: round 1 PASS at 37596f907d7724754e3b06f19c7504b5a99059b2.
- [x] ReviewGPT round 2: PASS at 420dda78cf5da27262d47c876291d8f50088f7e6.
- [x] Current-base mergeability: clean merge-tree against verified main
  962252727c573702e44f0f284c1f152b1379a061.
- [x] Close implementation plan; retain final-head CI evidence in PR #3347.

No live member delivery or production mutation was performed. Rollout must
verify actual provider/handset composition; local HTTP contracts and browser
component captures do not prove a received Messages or Telegram balloon.

## Final review disposition

ReviewGPT round 1 used the full guarded snapshot on Eragon. The exact accepted
turn and completed response were captured after more than six minutes; tool model
evidence confirms gpt-6-pro. The reviewer checked all 41 changed blobs against
the patch and traced the core authoring, rendering, delivery and confirmation
paths. Result: PASS; zero findings received, accepted or rejected, so no
review-requested remediation was required. This was source-and-test inspection,
not test execution by ReviewGPT. Parent review concurs with that disposition.

Broad CI subsequently found six stale expectations and two real provider-schema
regressions: a nested goal union erased concrete nested definitions in native
and code-mode Codex discovery. A comparison using the prior goal shape isolated
the cause. Flat nullable goal fields plus an if/then/else bundle constraint
preserve all-null/all-five validity while keeping generated declarations concrete.
The canonical compatibility check exercises all 32 presence combinations. The
real App Server checks now pass for native table fields, code-mode nutrition
fields, valid card attachment and mixed-bundle rejection. Updated only stale
prompt budgets/snapshots, progress copy and channel argument expectations.

The corrected first-summary live replay passed with one card and the exact
invitation, no progress preamble and no Goal writes. First-input recapture remains
177400 bytes direct and 161198 bytes group. Operator, CLI compatibility, real
provider contracts, card-tool and progress checks passed; types and complexity
passed.

All other first-candidate CI checks passed; the corrected candidate requires a
second full ReviewGPT review and its own required CI. The second review passed
after 368 seconds on gpt-6-pro, verified by captured model identity, exact-turn
hash and completion marker. Snapshot round metadata confirms the immutable
first-reviewed head and both ancestry checks. The reviewer checked all 47 changed
blobs and independently exercised the source-extracted schema across all 32
combinations plus malformed values. Zero findings were received, accepted or
rejected. Parent final review concurs. The final closure commit changes only
explanatory docs and links; no further substantive review is required. Final
closure-head CI and refreshed-base mergeability are recorded in PR #3347.
Updated: 2026-09-11
Completed: 2026-09-11
