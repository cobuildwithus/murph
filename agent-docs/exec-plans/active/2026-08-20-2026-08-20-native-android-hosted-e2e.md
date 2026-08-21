# Add protected native Android hosted E2E

Status: active
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
  preliminary coverage and final sensitive ReviewGPT gates.
- The protected live journey remains explicitly deferred until its GitHub
  Environments and immutable Android tag are configured after both repository
  patches land.
