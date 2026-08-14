# Reconstruct Junction history safety on current main

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Preserve current main's Junction catalog, pagination, dense/workout policies,
  compact 13-slot matrix, and recent follow-up behavior while restoring the
  exact-source lifecycle and sparse-history safety invariants that were unique
  to superseded PR #1696.

## Success criteria

- Every reconnect admission owner advances the exact Junction source lifecycle
  once and clears only that source's schedule-time coverage. Read fences stop
  known-stale jobs before provider discovery, fetch, preparation, or import;
  a lifecycle change observed after import stops continuation and certification.
- Extended sparse history offers at most one uncovered coordinate per scheduler
  pass, preserves current main's bounded continuation behavior, and emits no
  history root once every admitted coordinate has completion coverage.
- Current main's 13-slot `m1` mapping/defaults, pagination, dense/workout
  exclusions, and post-#1698/#1736 ownership remain unchanged unless focused
  proof shows a direct incompatibility.
- Focused SQLite/hosted/runtime proofs, package suites, typechecks, runner bundle
  limits, preliminary specialist ReviewGPT, final ReviewGPT, and required PR CI
  are green on the exact replacement-PR head.

## Scope

- In scope:
  - Source lifecycle epoch persistence, hydration/projection/admission fences,
    schedule-time job binding, and pre-import/post-import rereads.
  - Deterministic cap-one scheduling of uncovered sparse-history coordinates.
  - Existing SQLite/Postgres schema, hosted hint, runner, and direct proof
    surfaces required by those invariants.
- Out of scope:
  - Replacing or remapping current main's compact matrix.
  - New provider resources, query/tool surfaces, dense samples, workouts, ECG,
    prompts, frontend, or member-visible copy.
  - Wholesale commits, trees, docs, tests, migrations, or abstractions from the
    unrelated-history #1696 branch.
  - Rolling verification or late-fact recovery after a coordinate's existing
    completion bit is set; the composed provider load is not acceptable without
    a separate bounded ownership design.

## Constraints

- Technical constraints:
  - The reconstruction started from exact origin/main snapshot `96d23af` and
    then integrated current main through `fc954786c9` before candidate proof;
    port behavior manually into current owners and treat the old branch only as
    a reference.
  - Reuse the existing source row, job queue, metadata slots, scheduler cadence,
    and immediate SQLite enqueue transaction. Add no table, cursor owner,
    manager, queue, lifecycle service, or permanent verification process.
  - Keep provider/network work outside database transactions and quantify
    maximum admitted-cardinality fanout.
- Product/process constraints:
  - Preserve current sync, onboarding, reconnect, canonical import, billing,
    consent, and hosted/local rollout invariants.
  - Keep the old #1696 PR open until the replacement PR exists.
  - Use the PR worktree lane, exact-head ReviewGPT specialist/final gates, scoped
    commits, and plan closure through `scripts/finish-task`.

## Risks and mitigations

1. Risk: copying obsolete #1696 shapes could regress newer pagination or the
   13-slot matrix.
   Mitigation: diff owners and focused tests concept-by-concept; never cherry-pick
   the old commits or transplant whole files.
2. Risk: scheduling every coordinate forever would compose to unacceptable
   provider load at maximum cardinality.
   Mitigation: preserve the compact completion-bit gate and offer only one
   uncovered coordinate per scheduler pass; all-covered accounts emit none.
3. Risk: lifecycle repair can create another state owner or clear sibling/source-
   first coverage.
   Mitigation: keep epoch and coverage mutation on the exact existing source-row
   admission transactions and fence provider/fetch/import decisions with live reads.
4. Risk: late sparse facts remain outside this foundation after initial
   completion.
   Mitigation: state that limit explicitly and defer recovery until a separately
   reviewed design proves a bounded trigger and ownership model.

## Tasks

1. [completed] Inventory current main's Junction resource policy, matrix, pagination,
   lifecycle schema, scheduling, continuation, hydration, hosted hint, and tests;
   compare only the unique safety mechanisms in old head `e6b6340`.
2. [completed] Implement lifecycle epoch persistence and every hosted/local/source/job fence;
   add migration, atomicity, replay, hydration, and stale-work proof.
3. [completed] Add deterministic cap-one scheduling for uncovered coordinates while
   preserving current pagination, completion-bit suppression, and retry owners.
4. [completed] Audit rolling verification and reject it from this foundation because
   its composed maximum-cardinality provider load is unacceptable.
5. [completed] Run focused and comprehensive verification, bundle/type boundaries,
   privacy scans, scope/shape review, and update durable docs only where current
   owner contracts materially change.
6. [completed] Commit and push a candidate, open a replacement PR with exact intent/load/
   deployment/shape/proof metadata, then run preliminary specialist and final
   ReviewGPT concurrently with CI.
7. [completed] Complete and record the required round-2 anomaly retrospective:
   reject tactical alias guards and a raised 420-key bound, and choose one
   catalog-derived semantic lifecycle identity with no new persisted owner.
8. [completed] Collapse Apple Health alias/canonical lifecycle ownership at the
   existing source boundaries; prove legacy coexistence, reconnect, hydration,
   scheduling, execution fencing, certification, and hosted apply end to end.
9. [in_progress] Re-run focused/comprehensive proof, push the remediated head, obtain
   a later ReviewGPT PASS plus exact-head green CI, perform parent final review,
   close this plan with `scripts/finish-task`, and land.

## Decisions

- Use current main as sole architecture authority; old #1696 is behavioral
  evidence only.
- Port lifecycle safety before history terminality so every later job proof is
  bound to the real source epoch.
- Preserve the current `m1` 13-slot layout and current pagination by default.
- Completion coverage is monotonic initial-obligation evidence, not a claim of
  permanent provider completeness.
- The final pre-import lifecycle read prevents known-stale imports but is not an
  atomic importer-write fence. A reconnect racing after that read can overlap an
  import; the post-import read still prevents stale continuation or certification.
- Use an intentional intermediate `scripts/committer` checkpoint before merging
  the newer current-main device-sync changes; keep this plan active until the
  integrated candidate completes its PR review gates.
- Changelog is not applicable: this is internal lifecycle/scheduling hardening,
  not a new member-visible capability, interaction, or safely distinct public
  outcome.
- Maximum schedule-time candidate cardinality remains 396 source/resource
  reconnect obligations: 33 source slots multiplied by 12 schedule-time
  resource/version coordinates. Blood pressure remains the thirteenth matrix
  slot, but its independent source-first roots are not cleared by reconnect.
  Each due pass performs one bounded SQLite membership query over at most 396
  dedupe keys, prioritizes an inactive reopened-lifecycle coordinate, and
  offers at most one current-day root for the account; fully covered or already
  active candidate sets offer none. Dead keys become eligible again. Rolling
  verification remains out of scope because it would reintroduce unbounded
  composed provider work.
- A maximum-cardinality current-day execution performs six source-authority
  reads in the tested order `[target, all, target, all, target, target]`: four
  exact-source lifecycle fences, one shared projection snapshot, and one shared
  import-preparation snapshot. Neither shared read scales with provider count.
- The specialist request for a member-visible “restoring history” state is
  rejected as scope expansion. Settings freshness is the current sync/action
  projection, history completion is intentionally redacted, reconnect and
  backfill are separate automatic stages, and there is no member recovery
  action to present. Exposing coverage would require a new product projection.
- Cross-package Web-to-runner-to-apply behavior remains proven at package-owned
  seams instead of a coupled mega-test: Web persists lifecycle epoch two in its
  bounded snapshot, assistant hydration clears only superseded local
  schedule-time bits before merge, the scheduler emits an epoch-two root, and
  reconciliation proves the cleared bit is not emitted back to Web.
- Deploy the additive Prisma migration first, then the Cloudflare runner and
  confirm new runner builds are active before deploying Web. The Web write
  guard rejects missing lifecycle observations for epochs above one and protects
  against old-runner stragglers; Web-first is unsafe because it can clear
  schedule-time coverage before the cap-one runner behavior is active.
- Round 2's full-snapshot audit is accepted as a requirement-level
  `RETROSPECTIVE_REQUIRED` signal. Independent static and executable proof
  confirmed that the current scheduler constructs 420 active-dedupe keys when
  canonical Apple Health plus both admitted aliases coexist, exceeds the 396
  guard, and can resurrect unpublished alias coverage after a canonical
  reconnect. The same split leaves old alias-bound work admissible.
- Retrospective decision: the Connect route catalog is the sole lifecycle
  identity owner. Its canonical route slug defines source-instance identity,
  reconnect admission, hydration, scheduling/dedupe, lifecycle fences,
  continuation/certification, and hosted projection. Raw slugs may remain only
  as provider transport facts where needed. Existing alias rows collapse at
  the ordinary Web/SQLite source-owner transaction, not through a migration
  manager, repair loop, new table, second lifecycle, or raised raw-alias bound.
- Rejected an assistant-only alias match because it repeats the same mechanism
  while leaving admission, scheduling, execution, and hosted apply split.
  Rejected raising the lookup guard to 420 because one visible source must own
  one lifecycle and one set of obligations. Rejected a persisted canonical-ID
  column because the code-owned catalog already provides the identity.
- The ordinary Web and SQLite source owners now collapse catalog-equivalent
  rows on their bounded read/write paths. The collapse keeps the maximum epoch,
  applies fail-closed same-epoch status and disconnect-fence authority, preserves
  earliest/most-recent observation timestamps, unions bounded availability
  deterministically, writes the canonical row before deleting legacy aliases,
  and adds no migration, repair loop, or second identity owner.
- All extended-history roots, including blood pressure, now carry the exact
  lifecycle epoch. Blood pressure remains source-first and independently bounded
  at 33 roots; the schedule-time active-key lookup remains exactly 33 by 12, or
  396. Filtered local reads expand only the catalog-equivalent slugs so legacy
  alias-only rows participate in pre-provider admission and arrival stamping.

## ReviewGPT evidence and finding ledger

- The valid preliminary `completion-specialists` retry reviewed exact head
  `e46164ab9afafd14755b10c5612a89686081a30a` with `gpt-5-6-pro` for about
  38 minutes 26 seconds (04:06:32 attachment through 04:44:58 capture) in
  [its review thread](https://chatgpt.com/c/6a7e9449-f58c-83ea-8763-a060e29a011b).
  It returned `SPECIALIST_OUTCOME: FINDINGS` and was valid.
- Valid final ReviewGPT round 1 reviewed exact head
  `37ab85e625df815e3b62c246bb8e3fcf76d21233` with `gpt-5-6-pro` for 65
  minutes 17 seconds in
  [its review thread](https://chatgpt.com/c/6a7e7812-469c-83ea-b23b-70481500c1f3).
  It returned `ROUND_OUTCOME: FINDINGS` and `REVIEW_COMPLETE`.
- Accepted and fixed: project `lifecycleEpoch` from the bounded Web raw SQL and
  prove it against real Postgres; clear exact per-provider local coverage before
  assistant hydration merges a newer hosted epoch; preserve the pending Link
  source timestamp while a queued local job projects disconnected state; make
  the stale source-start callback a terminal fresh-start response; keep
  blood-pressure roots independent of the cap-one schedule-time lane; use active
  queue ownership to prioritize reopened inactive work; prove the 396-coordinate
  ceiling and maximum scheduler behavior; share the `projectJunctionSources`
  source snapshot so projection is O(N) with the exact six authority reads;
  prove exact 33-by-13 coverage clearing; and instrument the maximum locked path.
- Rejected the specialist suggestion to expose a member-visible “restoring
  history” state. The cited headline/detail/guidance is not rendered by the
  current cards; fresh sync is not history completeness; the unchanged UI only
  promises connected/learning; catch-up is automatic; and completion metadata
  is intentionally redacted. A truthful state would require a separate product
  projection, UI/catalog work, and changelog rather than leaking this internal
  safety mechanism into the current patch.
- Rejected one cross-owner Web-to-runner mega-test because it would couple
  package internals without proving more authority. The remediation instead
  strengthens the Web, assistant-runtime, device-sync, SQLite, and Postgres
  owner seams individually.
- Accepted the round-2 Apple Health identity finding and the independent
  remediation audits: Web now collapses before semantic status filtering and
  uses deterministic availability order; assistant hydration preserves a
  same-epoch disconnect fence and bounded availability across all aliases;
  local filtered reads and arrival stamping include semantic aliases; and
  blood-pressure work is lifecycle-bound before provider access. Redundant
  importer, diagnostic, and second-owner rewrites were removed from scope.

## Verification

- Commands to run:
  - Focused lifecycle, provider, history, store, hosted-runtime, hosted-Web, and
    assistant-runtime tests selected after the owner inventory.
  - `pnpm --filter @murphai/device-syncd typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - Complete `@murphai/device-syncd` tests once focused proof is stable.
  - Supported Cloudflare runner assembly and parity/bundle checks.
  - `git diff --check`, privacy scan, stale-symbol scan, and current-base
    `git merge-tree --write-tree` proof.
- Expected outcomes:
  - All selected checks pass on the exact candidate; any unrelated blocker is
    named with the narrow reproducer and direct proof that the diff did not
    cause it.
- Results on the integrated candidate before PR creation:
  - Integrated current main through `fc954786c9` without conflicts, preserving
    its configurable Junction summary/timeseries resource ownership.
  - Focused Junction lifecycle/backfill proof: 1 file, 87 tests passed.
  - Assistant hosted-device-sync runtime: 1 file, 100 tests passed.
  - Hosted Web runtime authority, wake, migration, and Prisma source owners:
    4 files, 230 tests passed.
  - Full `@murphai/device-syncd`: 47 files, 1,079 tests passed.
  - Device-sync, assistant-runtime, and Web typechecks passed; Prisma schema
    validation and workspace package cycles passed. Device-sync package-boundary
    coverage is included in the green full package suite.
  - Workspace boundary verification reports an unchanged current-main sibling
    test import violation outside this branch's diff; current-main contains the
    same offending line.
  - Supported production runner assembly rebuilt workspace artifacts and passed
    all six parity probes. The vault bundle measured 9,086,709/9,100,000 total
    bytes and 791/20,000 entry bytes. The runner measured 1,701,391 entry bytes,
    8,088,219/8,088,470 static-closure bytes, and
    10,223,826/10,251,013 total bytes, with no budget ratchet.
  - Final diff check plus privacy, secret, local-path, and stale-symbol scans
    passed immediately before the scoped candidate checkpoint.
  - PR #1800's first clean release-app lane exposed one missing explicit Web
    source alias for the new public device-sync subpath. The package export was
    correct, but a prebuilt local `dist` had allowed focused Web typecheck to
    resolve it without the Web-owned alias. Adding the exact source mapping
    makes clean and prebuilt resolution agree; Web `typecheck:prepared` and the
    repo workspace-source-resolution suite (7 tests) pass after remediation.
  - Required GitHub Actions passed on pushed head
    `e46164ab9afafd14755b10c5612a89686081a30a` while the ReviewGPT gates ran.
  - Final uncommitted remediation proof: the three focused device-sync files
    passed 255 tests; assistant hosted-device-sync runtime passed 100 tests;
    scoped Web Prisma-source and hosted-wake files passed 139 tests; and the
    isolated migrated Postgres resilience file passed all 6 tests.
  - Device-sync, assistant-runtime, and prepared Web typechecks all pass on the
    remediation candidate. Workspace package-cycle verification passes.
    Workspace-boundary verification still reports only the origin/main-identical
    sibling Web-test import outside this diff.
  - The exact production runner assembly after remediation passed all six parity
    probes without a budget ratchet: vault total 9,086,709/9,100,000 bytes;
    runner entry 1,701,391 bytes; static closure 8,088,219/8,088,470 bytes; and
    total 10,223,826/10,251,013 bytes.
  - The hosted stale-residue guard, final diff check, and added-line secret,
    privacy, local-home-path, and email-identifier scans pass on the remediation
    candidate.
  - Final ReviewGPT round 2 used a fresh sensitive full snapshot of exact head
    `cf1229b6526daa87c4f017946cfb90907af1635a`. Two earlier staging attempts
    failed before send, and the prior round-1 URL was unavailable across managed
    profiles; the valid Mountain retry submitted once in a new full-audit
    conversation. Response capture reached its three-hour guard, then the
    read-only thread export recovered one substantive marked response with
    `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` and `REVIEW_COMPLETE`.
  - Independent validation reproduced the retrospective trigger: 35 admitted
    raw slugs produce 420 current-day keys and trip the 396-key store guard;
    alias epoch-one unpublished coverage survives canonical epoch-two
    pre-hydration clearing, suppresses replacement scheduling, and an old alias
    job reaches provider fetch. The PR body records the required retrospective
    and continuation decision before further remediation.
  - Final alias-ownership remediation proof passes: device-sync provider/store/
    service coverage is 4 files and 519 tests; assistant hosted-device-sync is
    1 file and 102 tests; hosted Web source/runtime/wake coverage is 3 files and
    226 tests; and the isolated real-Postgres resilience lane remains 6 tests.
    Device-sync, assistant-runtime, and prepared Web typechecks pass.
  - Workspace package-cycle verification passes. Workspace-boundary verification
    still reports only the unchanged sibling Web-test import already present on
    the candidate head and outside the PR-authored diff.
  - Production runner assembly passes all six parity probes without a budget
    ratchet: vault total 9,086,709/9,100,000 bytes and entry 791/20,000 bytes;
    runner entry 1,701,391 bytes, static closure 8,088,460/8,088,470 bytes, and
    total 10,238,240/10,251,013 bytes.
  - The hosted stale-residue guard, final diff check, and added-line credential,
    privacy, local-home-path, and email-identifier scans pass on the remediated
    candidate before its scoped commit.
