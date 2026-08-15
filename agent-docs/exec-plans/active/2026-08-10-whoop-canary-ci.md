# Restore the live Junction WHOOP canary

Status: active
Created: 2026-08-10
Updated: 2026-08-15

## Goal

- Restore the protected-main GitHub canary so it can start the hosted-local
  stack and complete the real Junction-sandbox WHOOP sign-in, consent,
  callback, persisted reload, and cleanup journey.

## Success criteria

- The workflow exposes the exact workspace Codex CLI installed by the frozen
  dependency graph before hosted-local model-catalog preparation.
- The existing workflow contract test prevents removal or version drift of that
  preflight while preserving the secret and artifact boundaries.
- Focused tests, typecheck, workflow syntax validation, and privacy review pass.
- A PR is open from a clean isolated worktree and required checks evaluate its
  exact head.
- WHOOP's documented rendered `GRANT` control remains actionable when the live
  page assigns it a different accessible name, without broadening the positive
  action vocabulary or weakening denial rejection.
- The stale GitHub environment-gated run is handled without overlapping WHOOP
  authorization sessions; a protected-main run is used for the live proof once
  the workflow fix is present on `main`.

## Scope

- In scope: `.github/workflows/junction-wearable-canary.yml`, its focused
  workflow contract test, the wearable browser driver and focused real-browser
  proof, the CI/verification owner docs, the ReviewGPT audit manifest needed to
  inspect the affected owners, and operational inspection of the canary queue.
- Out of scope: provider implementation, production Junction credentials,
  GitHub secret values, Oura browser automation, and weakening protected-main
  or environment restrictions.

## Constraints

- Technical constraints: reuse the workspace CLI installed by the root frozen
  dependency graph. Its current exact pin matches the independently owned
  runner-base pin; do not add a second installer or workflow-local version.
- Product/process constraints: keep repository permissions read-only, secrets
  step-scoped, Junction sandbox-only, provider sessions serialized, and all
  browser artifacts disabled.

## Risks and mitigations

1. Risk: a duplicated Codex install path drifts from the hosted runtime.
   Mitigation: expose the existing exact workspace dependency, keep both
   current pins visible to review, and avoid fetching another copy.
2. Risk: clearing the stale queue starts overlapping provider sessions.
   Mitigation: inspect exact run/job state and cancel only an exact proven stale
   pre-authorization run; retain non-canceling concurrency for active work.
3. Risk: credentials leak into setup or diagnostics.
   Mitigation: keep setup credential-free, preserve the existing final-step
   secret checks, upload no artifacts, and inspect the final diff for identifiers.

## Tasks

1. [x] Confirm the failure boundary from GitHub run/job logs and current workflow.
2. [x] Add the pinned Codex CLI preflight and focused regression coverage.
3. [x] Run focused tests, typecheck, syntax, and diff/privacy checks.
4. [x] Complete the original workflow-fix review and PR workflow.
5. [x] Collect protected-main evidence through WHOOP sign-in and consent.
6. [ ] Ship the denial-safe rendered-label correction through the required PR,
   ReviewGPT, and exact-head CI gates.
7. [ ] Collect one protected-main green canary proving callback, persisted
   reload, disconnect, and cleanup.

## Decisions

- Reuse the workspace-bin exposure already proven by the live hosted Stripe
  workflow; root frozen dependency installation remains the only acquisition
  owner.
- Do not add GitHub's larger concurrency queue: a dedicated WHOOP account must
  not accumulate overlapping or stale authorization sessions.
- Keep the live provider proof on protected `main`; pull requests prove only
  the workflow contract and other hermetic checks.
- Keep the existing accessible-name action path first. When it finds no action,
  allow only visible, enabled button/link text or values matching the same
  ordered positive vocabulary, with the same combined-label denial veto. This
  targets WHOOP's officially documented `GRANT` action without clicking an
  arbitrary unknown control.

## Verification

- Commands to run: focused Vitest for the workflow contract; hosted-local
  harness typecheck; YAML parse/actionlint-equivalent repo guard;
  `git diff --check`; exact-head GitHub required checks.
- Expected outcomes: the workflow exposes and smoke-checks the installed
  workspace Codex CLI without secrets or another registry fetch, and all
  existing trust-boundary assertions remain green.
- Passed: focused workflow Vitest (4 tests), hosted-local harness typecheck,
  docs drift, YAML parsing, and `git diff --check`.
- Passed direct preflight: the installed workspace CLI reported
  `codex-cli 0.147.0` and completed `codex debug models --bundled`.
- GitHub evidence: cancelled exact stale run `31121742224` before it had a
  runner or any steps. The released latest-main run `31424039548` reproduced
  `spawnSync codex ENOENT` with all six tests skipped, confirming that WHOOP
  authorization was never reached and that the patch addresses the active
  failure boundary.
- Confirmed ReviewGPT dependency: npm `latest`, the manifest/lockfile, and the
  installed package all resolve to `@cobuild/review-gpt@0.5.124`.
- Preliminary ReviewGPT attempt 1 was tooling-invalid because the guarded ZIP
  omitted `Dockerfile.cloudflare-hosted-runner-base`; the corrected retry
  passed with no findings. Final ReviewGPT round 1 then found that the initial
  separate npm install duplicated the workspace dependency acquisition. The
  accepted correction reuses the existing workspace bin and removes that
  installer and its temporary-prefix lifecycle.
- Final ReviewGPT round 2 attempt 1 was not attested because its marked response
  completed below the trust floor. Its diagnostic result also identified that
  the declared full snapshot omitted the runner-base Dockerfile required to
  verify the documented current workspace/image version match. The audit
  context now includes that exact owner path and locks it with packager coverage.
- PR #1874 merged the smaller content-free terminal diagnostic after a
  zero-finding ReviewGPT round and required exact-head CI. Protected-main run
  `31905637471` then reached `id.whoop.com/consent` and reported two visible,
  enabled, non-negative main-page controls outside the accessibility-name
  vocabulary, with no checkbox or child-frame blocker. WHOOP's current official
  OAuth guide still identifies the affirmative rendered control as `GRANT`,
  proving the remaining boundary is rendered labeling versus the computed
  accessible name rather than a missing or disabled consent control.
- The rendered-label correction passed 15 focused unit tests, all three headed
  Chromium boundary scenarios, the hosted-web prepared typecheck, targeted
  ESLint, and `git diff --check`. The headed regression proves that a negative
  control is rejected even when its rendered text says `GRANT`, while a neutral
  enabled control with that rendered text completes the authorization redirect.
