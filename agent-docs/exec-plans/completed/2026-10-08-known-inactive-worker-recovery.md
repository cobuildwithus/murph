# Recover a trusted inactive Worker upload without activating it

Status: completed
Created: 2026-10-08
Updated: 2026-10-08

## Goal

Permit a protected operator to name a trusted failed upload as the secret
inheritance source for one fresh worker-only deployment. Never activate that
old upload or replace the live Worker's staging, runner or activation authority.

## Success criteria

- Both exact recovery inputs, worker-only mode and synchronized secrets are
  required. Normal deployments remain unchanged when both inputs are empty.
- The current Worker is the sole version serving 100%. The explicitly named
  inactive version has the exact expected tag and complete live secret name/type
  inventory, and the raw latest pair remains inactive/live before upload.
- Fresh upload, optional native secret PATCH, complete final inventory, live
  identity, smoke, activation and receipt checks retain their existing owners.

## Scope

- In scope: paired environment inputs at the existing public deployment CLI;
  metadata validation in its existing secret helper; focused tests and deployment
  documentation; separate private consumer coordination.
- Out of scope: provider APIs, resource configuration, secret reads, automatic
  discovery/retry/adoption, old candidate activation, production operations,
  dependency changes or new durable state.

## Constraints

- `HOSTED_EXECUTION_RECOVERY_VERSION_ID` and
  `HOSTED_EXECUTION_RECOVERY_VERSION_TAG` are step-local opt-in inputs. Empty
  defaults are absent; partial, padded or malformed identities fail closed.
- Require `HOSTED_EXECUTION_CONTAINER_ROLLOUT=worker-only` and synchronized
  payload inclusion. Keep canonical generated config and payload validation.
- Parent owns final review, ReviewGPT, CI, merge and any protected deployment.
  This work ends with a reviewed local candidate and draft PR handoff.

## Risks and mitigations

1. Name/type equality cannot prove opaque secret values are equal. The operator
   must choose a known trusted failed upload; current payload rotations apply.
2. Latest can drift after a read. Retain protected serialization and immediate
   pre/post history checks; they detect drift and are not atomic CAS.
3. A failed operation can leave another inactive version. Never discover or
   automatically approve it; a new exact operator selection is required.

## Tasks

1. Add paired option validation and narrowly scoped candidate metadata proof.
2. Override only the initial upload source after proof; retain live authority.
3. Exercise malformed options, metadata/inventory mismatch, drift, synchronized
   payload and fresh-candidate success through composed deployment owners.
4. Update the durable deploy contract and existing public-safe verification-gap
   Frog entry; run focused checks, parent review, close plan and open draft PR.

## Decisions

- Reuse provider reads and existing CLI environment plumbing; no new API or CLI
  flags. Restrict recovery to worker-only so it cannot alter the native rollout.
- Compare full secret inventories before excluding retired names. Build final
  expected inventory from the original live version plus current payload.

## Verification

- Passed 133 focused tests: 53 secret-helper and 80 deployment-CLI tests. The CLI
  suite also passes after correcting two test-only TypeScript annotations.
- Passed Cloudflare typecheck, complexity (no hotspots above 20; helper maximum
  19, CLI maximum 14), docs drift, privacy and diff checks. Frozen dependency
  installation and the existing Prisma generation prerequisite passed unchanged.
- Parent reviewed source and both test diffs without findings. Fetched current
  main merges cleanly; parent owns final docs/body review and exact-head CI.
- Provider-shaped tests prove metadata/ordering boundaries; only a later
  protected deployment can establish external acceptance.
Completed: 2026-10-08
