# Crabbox Secret Boundary Hardening

## Goal

Prevent canonical local verification from exposing ambient local credentials to
the Crabbox CLI, and ensure candidate-controlled repository code starts only
after a trusted default-branch Testbox entrypoint has erased ambient Actions and
Blacksmith environment state. Remove GitHub repository-level production-secret
access that an alternate workflow ref could request.

## Threat model

- A local verification process may inherit production credentials or broad
  environment variables that Crabbox does not need.
- Candidate code and scripts are untrusted until they run inside the synthetic
  verification environment; they must not be the first process to receive the
  Testbox orchestration environment.
- GitHub/Blacksmith session credentials are orchestration authority, not test
  inputs.
- Mutable local Crabbox profiles/config and alternate workflow refs are
  untrusted routing inputs.
- Repository-scoped GitHub Actions secrets are available to any workflow that
  explicitly references them; production credentials therefore belong only in
  a protected environment.
- An operating-system process that can already read a secret and make arbitrary
  network calls can exfiltrate it without Crabbox. This task hardens the canonical
  Murph path; it does not claim to sandbox a compromised local account.

## Constraints

- Keep the verification commands limited to `test:diff` and
  `verify:acceptance`.
- Do not add workflow secrets, environment attachment, OIDC authority, or local
  environment forwarding.
- Preserve dirty-checkout synchronization for ordinary candidate source and
  tests.
- Keep the trusted entrypoint installed from the default-branch hydration
  workflow rather than synced candidate files.
- The workflow bootstrap change must be verified locally until it exists on the
  default branch; remote proof can run only after that trust root lands.

## Plan

1. Replace the inherited local Crabbox CLI environment with a minimal allowlist
   required for local config, authentication lookup, and command execution.
2. Pin the direct provider's organization, `main` ref, workflow, and hydration
   job independently of mutable local config.
3. Install a root-owned, non-workspace Testbox verification entrypoint from the
   trusted hydration workflow and route canonical delegated commands through it.
4. Have that entrypoint validate the bounded command and launch candidate code
   under `env -i` with only safe host paths and synthetic-test bootstrap state.
5. Add regression tests that prove local credentials are absent, the trusted
   entrypoint is mandatory, and the workflow cannot acquire production-secret
   authority.
6. Restrict the GitHub production environment to protected branches and remove
   repository-scoped copies only when an environment-scoped duplicate already
   supplies every current workflow use.
7. Update security and verification documentation, then run canonical local
   verification. Record the required post-landing remote proof.
8. Keep `.crabbox.yaml` in the guarded ReviewGPT package even when a patch
   changes only its consumers, so exact-head security review can inspect the
   provider/ref trust root its tests and docs rely on.

## Adversarial validation rubric

| ID | Candidate bypass | Required proof |
| --- | --- | --- |
| `CBX-LOCAL-ENV` | Ambient local credentials or user env-forwarding config reaches Crabbox/Blacksmith | A fake-CLI integration captures the exact child env and proves credentials, `CI`, `NODE_OPTIONS`, config overrides, and forwarding controls are absent. |
| `CBX-ROUTING` | A local profile/config changes provider, organization, ref, workflow, or job | Invocation tests prove every security-relevant Blacksmith route is a pinned command argument and the profile is fixed. |
| `CBX-CANDIDATE-ENV` | Synced candidate code runs before ambient Testbox state is erased | Workflow ordering plus entrypoint tests prove the default-branch copy is installed before delegation and candidate children receive only the synthetic environment. |
| `CBX-WORKFLOW-AUTH` | The hydration workflow acquires production authority | Static workflow proof requires only `contents: read`, no environment, secret expression, OIDC permission, alternate privileged trigger, or unpinned action. |
| `CBX-GITHUB-SCOPE` | An alternate workflow ref explicitly requests production secrets | Live metadata proof requires production environment protected-branch policy and zero production credentials at repository scope. |

## Live GitHub hardening

- Production environment branch policy now permits protected branches only.
- Three repository-scoped credentials that had exact production-environment
  duplicates were removed; the 33 environment-scoped values were untouched.
- One repository-scoped production deploy hook has no environment copy. The
  legitimate job now attaches the production environment, but the credential
  must be re-entered there and its repository copy removed before
  `CBX-GITHUB-SCOPE` can pass. GitHub does not expose stored secret values, so
  this migration cannot be completed by copying the existing value through the
  API.

## Verification

- Focused tests: `pnpm exec vitest run --config scripts/vitest.config.ts
  --no-coverage scripts/verification-dispatch.test.ts
  scripts/crabbox/run-verification.test.ts
  scripts/crabbox/trusted-verification-entrypoint.test.ts` passed (24 tests).
- ReviewGPT packaging owner: `pnpm exec vitest run --config
  packages/cli/vitest.workspace.ts --no-coverage
  packages/cli/test/release-script-coverage-audit.test.ts` passed (40 tests,
  1 skipped).
- Tools typecheck: `pnpm exec tsc --noEmit -p tsconfig.tools.json` passed.
- Workflow syntax: both edited GitHub Actions files parsed successfully through
  Ruby YAML; `actionlint` and repository-local Prettier are unavailable.
- Canonical local `pnpm test:diff ...` waited ten minutes for an unrelated
  workspace-verification lock and was stopped without signaling its owner.
  Pre-landing Crabbox is not a truthful fallback because the new trusted
  entrypoint does not exist on `main`; focused local proof plus CI is the
  bootstrap fallback, followed by mandatory post-landing Testbox proof.
  A later retry encountered the same still-active unrelated lock and stopped
  promptly rather than beginning another ten-minute wait.
- `CBX-GITHUB-SCOPE`: blocked on the remaining deploy-hook secret migration.
- Preliminary ReviewGPT attempt 1 was below the minimum trusted duration and
  discarded. Attempt 2 returned `SPECIALIST_OUTCOME: INVALID` because the
  guarded archive omitted `.crabbox.yaml`; the packager now includes it
  explicitly and requires a same-head retry.
- Preliminary ReviewGPT completed on `9386cc0175` with three coverage findings.
  Its tests-only `reviewgpt-coverage.patch` was inspected, applied, and passed
  the focused repo-tools/typecheck and CLI packaging-owner suites. Per policy,
  the substantive preliminary pass is not rerun after accepted coverage fixes.

Status: active
Updated: 2026-07-22
