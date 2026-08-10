# Restore the live Junction WHOOP canary

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Restore the protected-main GitHub canary so it can start the hosted-local
  stack and reach the real Junction-sandbox WHOOP sign-in journey.

## Success criteria

- The workflow exposes the exact workspace Codex CLI installed by the frozen
  dependency graph before hosted-local model-catalog preparation.
- The existing workflow contract test prevents removal or version drift of that
  preflight while preserving the secret and artifact boundaries.
- Focused tests, typecheck, workflow syntax validation, and privacy review pass.
- A PR is open from a clean isolated worktree and required checks evaluate its
  exact head.
- The stale GitHub environment-gated run is handled without overlapping WHOOP
  authorization sessions; a protected-main run is used for the live proof once
  the workflow fix is present on `main`.

## Scope

- In scope: `.github/workflows/junction-wearable-canary.yml`, its focused
  workflow contract test, the CI/verification owner docs, the ReviewGPT audit
  manifest needed to inspect the workflow's version source, and operational
  inspection of the canary queue.
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
4. [ ] Complete the required review and PR workflow.
5. [ ] Reconcile the stale canary queue and collect protected-main live evidence.

## Decisions

- Reuse the workspace-bin exposure already proven by the live hosted Stripe
  workflow; root frozen dependency installation remains the only acquisition
  owner.
- Do not add GitHub's larger concurrency queue: a dedicated WHOOP account must
  not accumulate overlapping or stale authorization sessions.
- Keep the live provider proof on protected `main`; pull requests prove only
  the workflow contract and other hermetic checks.

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
