# Restore hosted-web build env plumbing for release-check

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the GitHub release-check workflows provide the minimal non-secret hosted-web build env needed for `apps/web verify` to finish in CI, so `next build` no longer fails at route-module import time on missing hosted control-plane env.

## Success criteria

- `host-support.yml` and `release.yml` provide the same minimal hosted-web build env placeholders.
- The workflow guard tests encode that env contract.
- Local hosted-web build verification passes under CI-style placeholder envs.

## Scope

- In scope:
  - Workflow env blocks in `.github/workflows/host-support.yml` and `.github/workflows/release.yml`.
  - The release/host-support workflow guard tests.
  - Narrow hosted-web build verification with CI-style placeholder envs.
- Out of scope:
  - Broad hosted-web env or control-plane refactors.
  - Runtime database connectivity or device-sync provider auth.
  - Unrelated acceptance failures outside the hosted-web build boot contract.

## Constraints

- Preserve unrelated worktree edits.
- Keep `apps/web verify` truthful in CI rather than bypassing hosted-web build.
- Use deterministic non-secret placeholders only for env required to boot the build/import path.

## Risks and mitigations

1. Risk:
   Fixing `DATABASE_URL` alone could just uncover the next required hosted device-sync env on the following push.
   Mitigation:
   Trace the callback route import path now and include the full minimal hosted-web build boot contract in one change.

2. Risk:
   Workflow env drift between release and support workflows could reintroduce the failure later.
   Mitigation:
   Update both workflows and both workflow guard tests in the same change.

## Tasks

1. Trace the hosted-web build failure from the GitHub logs to the route import path.
2. Patch the release/support workflow env blocks with the minimal hosted-web build placeholders.
3. Update the workflow guard tests to lock that env contract.
4. Run scoped hosted-web verification under CI-style placeholder envs, then commit and watch GitHub.

## Decisions

- Keep the fix in GitHub workflow env plumbing rather than weakening hosted-web module-load failures.
- Use deterministic placeholder `DATABASE_URL` and hosted device-sync key material that are safe for CI build boot but unusable for real runtime data access.

## Verification

- Commands to run:
  - `env -u DATABASE_URL -u DEVICE_SYNC_ENCRYPTION_KEY -u DEVICE_SYNC_ENCRYPTION_KEY_VERSION DATABASE_URL=... DEVICE_SYNC_ENCRYPTION_KEY=... DEVICE_SYNC_ENCRYPTION_KEY_VERSION=v1 HOSTED_CONTACT_PRIVACY_KEYS=... NEXT_PUBLIC_PRIVY_APP_ID=... PRIVY_VERIFICATION_KEY=... pnpm --dir apps/web build`
  - `pnpm exec vitest run packages/cli/test/release-workflow-guards.test.ts packages/cli/test/host-support-workflow-guards.test.ts --no-coverage`
  - `pnpm typecheck`
- Expected outcomes:
  - All commands pass on the final tree.
Completed: 2026-04-09
