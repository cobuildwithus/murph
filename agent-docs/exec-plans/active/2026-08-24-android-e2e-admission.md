# Reduce Android hosted E2E queue latency

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Reduce Android hosted E2E completion latency by admitting only changes that
  can affect the native companion journey, without weakening the exact-head,
  shared-identity, deployment, or private-workflow proof.

## Success criteria

- The Android workflow no longer selects every `apps/web/**` change or unrelated
  runtime/package changes.
- Companion admission, authentication, onboarding, consent, sign-in-token,
  status, database, build, and shared Android-controller owners still select the
  live lane, including renamed paths.
- Representative UI, content, test-only, and unrelated runtime paths remain
  neutral under executable selector tests.
- The one shared destructive iOS/Android live lock and all current trust and
  cleanup boundaries remain unchanged.
- Focused contract tests, scoped repository verification, exact-head CI, and the
  required ReviewGPT specialist review pass.

## Scope

- In scope: Android workflow admission patterns, executable selector regression
  coverage, and living verification/operations documentation.
- Out of scope: parallelizing the shared destructive identity, changing the
  private Android instrumentation journey, weakening cleanup, reusing candidate
  deployments, or changing production canary behavior.

## Constraints

- Technical constraints: Android and iOS mutate the same protected identity,
  database, Junction namespace, and Vercel target, so their live executions must
  remain serialized. The trusted default-branch controller must continue to
  evaluate renamed files and exact PR heads.
- Product/process constraints: no user-facing behavior changes; keep evidence
  privacy-safe and preserve the current retry/status contract.

## Risks and mitigations

1. Risk: a companion-affecting change could be incorrectly filtered out.
   Mitigation: align Android with the already proven iOS companion dependency
   closure, retain Android/shared-controller owners, and add executable positive,
   negative, and broad-pattern mutation coverage.
2. Risk: queue speed is improved by weakening isolation.
   Mitigation: leave the shared live concurrency group, protected environment,
   exact-head revalidation, and lifecycle implementation untouched.

## Tasks

1. Capture recent queue and privacy-safe stage timing evidence.
2. Replace the broad Android selector with the actual companion route/runtime
   closure plus shared and Android-specific controller owners.
3. Expand the Android selector tests to prove representative admission,
   non-admission, rename handling, and rejection of a broad Web pattern.
4. Update living verification documentation to describe the narrowed Android
   admission contract.
5. Run focused checks, review and commit the candidate, open a draft PR, then
   run exact-head ReviewGPT concurrently with required CI.

## Decisions

- Recent successful runs spent about 43 and 134 minutes waiting for the shared
  live slot, while the live job itself took about 20 to 23 minutes. Within the
  live job, trusted setup was about one minute; the Web deployment and private
  Android journey dominated execution. The actionable queue multiplier is the
  Android selector's broad `apps/web/**` and unrelated package admission.
- Preserve serialization because the two native lanes share destructive state;
  reduce unnecessary arrivals instead of adding another identity or lifecycle.
- Reuse the iOS companion dependency closure because both native journeys call
  the same hosted companion routes; retain the Android and shared-controller
  files that uniquely affect this lane.

## Verification

- Commands to run:
  - `node --test scripts/native-android-hosted-e2e.test.mjs`
  - `node --test scripts/native-ios-hosted-e2e.test.mjs`
  - `pnpm test:diff .github/workflows/native-android-hosted-e2e.yml scripts/native-android-hosted-e2e.test.mjs agent-docs/operations/native-android-hosted-e2e.md agent-docs/references/testing-ci-map.md`
- Expected outcomes: all deterministic controller and selector proofs pass; the
  diff lane reports no architecture, privacy, workflow, or repository-tooling
  regression; exact-head PR CI and ReviewGPT resolve without accepted findings.
- Results to date:
  - Android controller contract: 23/23 passing, including exact selector parity
    with iOS after removing Android-only controller patterns.
  - Shared iOS lifecycle contract: 48/48 passing after installing the worktree's
    frozen dependency graph.
  - Scoped `pnpm test:diff`: shell/Node syntax, architecture/privacy guards,
    repository-tool TypeScript, and dependency policy passed; the repo-tools
    suite then hit nine local-only Frog fixture failures because the privacy hook
    rejects `automation@example.invalid`. Existing Frog entry
    `20260817182716-privacy-hook-rejects` already owns that unrelated friction.
    Exact-head CI remains the broad clean-runner proof.
