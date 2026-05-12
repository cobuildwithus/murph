# Remove hosted container egress probe from hot path

## Goal

Remove the default external egress probe from the hosted container workspace invocation path so production runner invocations and idle-shutdown checkpoints do not make diagnostic public network calls before running workspace work.

Success means:

- `apps/cloudflare/src/container-entrypoint.ts` no longer probes public URLs before `runHostedWorkspaceInvocationWithProcessIsolation`.
- There is no default-on `MURPH_HOSTED_CONTAINER_EGRESS_PROBE` behavior in the container entrypoint.
- Focused Cloudflare tests prove a normal workspace invocation does not call the entrypoint fetch dependency.
- Required verification and completion audits are run or any unrelated blocker is recorded.

## Constraints

- Preserve existing hosted-runner architecture: deploy-smoke and worker/container control surfaces stay unchanged.
- Do not add new production configuration or hidden runtime dependencies.
- Do not touch unrelated active hosted-runner lanes.
- Preserve unrelated dirty worktree edits.

## Files

- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`

## Plan

1. Remove the egress probe constants, helper functions, and pre-invocation call.
2. Remove the now-unused `fetchImpl` runtime dependency from the entrypoint.
3. Add focused regression coverage that a workspace invocation succeeds without calling a supplied fetch dependency.
4. Run focused Cloudflare verification, required audits, then close this plan with the scoped commit path if the dirty worktree allows it.

Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
