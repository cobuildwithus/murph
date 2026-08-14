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
6. [pending] Commit and push a candidate, open a replacement PR with exact intent/load/
   deployment/shape/proof metadata, then run preliminary specialist and final
   ReviewGPT concurrently with CI.
7. [pending] Resolve accepted findings, perform parent final review, close this plan with
   `scripts/finish-task`, and land only after ReviewGPT PASS plus required CI.

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
  slot, but its source-first history is not cleared by reconnect and therefore
  is not one of those 396 obligations. The account scheduler offers one
  deterministic uncovered root per pass and fully covered accounts offer none.
  Rolling verification remains out of scope because it would reintroduce
  unbounded composed provider work.
- Deploy the additive Prisma migration first, then the Cloudflare runner and
  confirm new runner builds are active before deploying Web. The Web write
  guard rejects missing lifecycle observations for epochs above one and protects
  against old-runner stragglers; Web-first is unsafe because it can clear
  schedule-time coverage before the cap-one runner behavior is active.

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
    10,219,811/10,251,013 total bytes, with no budget ratchet.
  - Final diff check plus privacy, secret, local-path, and stale-symbol scans
    passed immediately before the scoped candidate checkpoint.
  - PR #1800's first clean release-app lane exposed one missing explicit Web
    source alias for the new public device-sync subpath. The package export was
    correct, but a prebuilt local `dist` had allowed focused Web typecheck to
    resolve it without the Web-owned alias. Adding the exact source mapping
    makes clean and prebuilt resolution agree; Web `typecheck:prepared` and the
    repo workspace-source-resolution suite (7 tests) pass after remediation.
