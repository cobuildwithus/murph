# Add protected native Android hosted E2E

Status: completed
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Add a protected shared-backend controller for the real native Android hosted
  E2E journey without weakening or duplicating the existing native iOS trust
  boundary.

## Success criteria

- Trusted default-branch code binds the exact hosted Web deployment, Android
  commit and immutable tag, protected test identity lifecycle, and short-lived
  dispatch lease.
- PR identity reset and cleanup remain narrowly scoped and serialized with the
  existing destructive native iOS lane.
- Production canary mode is non-destructive and bound to the production origin.
- Deterministic tests cover dispatch, source binding, lifecycle, cleanup, and
  cancellation uncertainty; required CI and ReviewGPT gates pass on the exact
  PR head.

## Scope

- In scope: shared Privy identity helpers, Android controller/dispatch scripts,
  trusted GitHub workflow, focused tests, security/reliability/testing docs,
  and durable operations documentation.
- Out of scope: Android app implementation, protected secret values, GitHub
  Environment creation, private Android tag creation, and executing the live
  protected journey before both bootstrap patches land.

## Constraints

- Technical constraints: preserve native iOS behavior; use exact immutable
  source/deployment binding; never expose provider credentials, identity data,
  raw logs, or downloaded environment values; fail closed on ambiguous cleanup
  or dispatch state.
- Product/process constraints: use the task worktree/PR lane, keep the change
  internal-only for changelog purposes, run the preliminary coverage lens and
  final sensitive ReviewGPT gate, and document the two-repository rollout.

## Risks and mitigations

1. Risk: a destructive test identity reset races another native lane.
   Mitigation: reuse the current identity owner and globally serialize reset
   journeys across native iOS and Android.
2. Risk: protected Android code runs against an unreviewed app or stale Web
   deployment.
   Mitigation: bind full SHAs, an immutable private tag, the exact HTTPS origin,
   Vercel deployment proof, and a short dispatch lease at every boundary.
3. Risk: provider or identity details escape through CI output.
   Mitigation: keep raw output in bounded private temporary files, publish only
   allowlisted summaries, and remove all temporary state on every terminal path.

## Tasks

1. Reconcile and apply the ReviewGPT backend patch to current main.
2. Review the existing iOS controller and shared identity semantics; simplify
   or correct the Android lane where current owners already provide the needed
   primitive.
3. Update durable security, reliability, testing, and index documentation.
4. Run focused deterministic tests, syntax/source-policy checks, and parent
   review; commit and push the exact candidate.
5. Open the PR, launch preliminary coverage and final sensitive ReviewGPT in
   parallel with CI, resolve accepted findings, close the plan, and merge only
   after required gates pass.

## Decisions

- The backend remains the sole dispatcher and owns protected identity reset;
  the Android repository owns only live instrumentation and its closed result
  contract.
- Android and iOS share reset helpers rather than introducing a second Privy
  identity implementation.
- ReviewGPT round 1 found that a transmitted dispatch could lose its receipt
  before entering the known-run fence. The correction widens the existing
  fence to unreceipted possible dispatches; it adds no discovery loop, queue,
  or durable dispatch owner.
- ReviewGPT round 1 also proved that one installation token could expire inside
  the admitted deployment plus private-run window. The existing protected
  controller now owns an ephemeral repository-scoped token supplier, removes
  App credentials from its child environment, and refreshes before expiry.
- The non-destructive production canaries do not share reset authority, so the
  unnecessary Android-to-iOS production concurrency edge was deleted. The
  destructive PR jobs retain their required shared lock.
- The preliminary specialist findings were accepted: executable Android tests
  now call the dispatcher and workflow shell boundaries, and both native lanes
  advertise the existing exact-head Repo Hygiene retry helper as the one
  recovery owner.

## Verification

- `node --test scripts/native-android-hosted-e2e.test.mjs`: 12/12 passed.
- `node --test scripts/native-ios-hosted-e2e.test.mjs`: 42/42 passed; the
  shared helper changes preserve the existing iOS controller behavior.
- Combined native-controller suite: 54/54 passed.
- `node --check` passed for every changed JavaScript module, and both changed
  workflow files parse as YAML.
- `pnpm provider-requests:guard`, `pnpm docs:drift`, and
  `pnpm docs:gardening` passed; the gardening report contained zero issues.
- `git diff --check` passed.
- Remaining completion proof: exact-head required GitHub Actions plus the
  final sensitive ReviewGPT remediation round. Preliminary specialists returned
  findings with no patch artifact; every accepted finding has focused proof.
- Post-remediation focused proof: combined Android/iOS controller suite 65/65,
  Android workflow/cache trust-boundary guard 5/5, provider request guard,
  JavaScript syntax checks, workflow YAML parsing, and `git diff --check` pass.
- The protected live journey remains explicitly deferred until its GitHub
  Environments and immutable Android tag are configured after both repository
  patches land.
- Preliminary ReviewGPT returned two accepted findings and no patch artifact;
  final round 1 returned three accepted findings. The corrected full snapshot
  received `ROUND_OUTCOME: PASS` in substantive round 2 with zero unresolved
  accepted or actionable findings.
- One behavior-preserving rebase onto the then-current `main` was required by
  the exact-base bundle-budget guard. Merge-tree proof was clean, the two
  authored patch ids were unchanged across the rebase, the intervening base
  change touched only unrelated Cloudflare queue metrics, and every focused
  command above passed again afterward.
- Required GitHub Actions on the final plan-closure head remain the merge gate;
  this completed snapshot records implementation and review completion, not a
  substitute for those exact-head checks.
Completed: 2026-08-20
