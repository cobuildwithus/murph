# Hosted activation duplicate-commit divergence

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Reproduce and fix the hosted Cloudflare duplicate-commit failure triggered during repeated activation/re-signup flows when the same logical assistant welcome delivery is regenerated with a different local outbox intent id.

## Success criteria

- A focused local repro demonstrates the duplicate-commit divergence with stable assistant-delivery fingerprints and changed effect ids.
- The Cloudflare duplicate-commit equivalence logic accepts that replay shape when the delivery fingerprint set is otherwise identical.
- Scoped verification passes for the touched Cloudflare path, including the local hosted e2e lane if it remains truthful for the change.
- Handoff explains the root cause in terms of durable commit semantics rather than only symptoms.

## Scope

- In scope:
- `apps/cloudflare` duplicate-commit comparison and focused tests
- Minimal supporting repro coverage in hosted runner/e2e tests when needed
- Out of scope:
- Broad hosted onboarding redesign
- Web-side member lifecycle cleanup for manually wiped production state unless the repro proves it is required

## Constraints

- Treat delivery fingerprints as the authoritative idempotency identity unless code evidence proves otherwise.
- Preserve existing side-effect journaling and post-commit replay behavior.
- Keep the fix narrow to duplicate-commit equivalence and direct proof unless a deeper invariant is broken.

## Risks and mitigations

1. Risk: Relaxing duplicate-commit checks too far could hide real side-effect divergence.
   Mitigation: Only accept replays where the authoritative delivery fingerprint set is unchanged; keep mismatched fingerprints as hard errors.
2. Risk: The local repro may sit below the real failure boundary.
   Mitigation: Pair a focused unit/integration repro with the existing hosted local e2e lane.
3. Risk: Existing dirty worktree edits could overlap the same Cloudflare files.
   Mitigation: Keep the write scope narrow and avoid unrelated cleanup.

## Tasks

1. Add the active coordination row for this investigation.
2. Reproduce the duplicate-commit failure locally with a focused Cloudflare test.
3. Patch duplicate-commit equivalence if the repro confirms `effectId` is non-authoritative across retries.
4. Run scoped verification for the touched Cloudflare files, including the hosted local e2e lane when appropriate.
5. Complete required audits/commit workflow after implementation.

## Decisions

- Treat the assistant-delivery fingerprint as the durable replay identity under investigation; the local outbox `effectId` is suspected to be ephemeral across retried welcome-intent recreation.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare test:node`
- `pnpm --dir apps/cloudflare test:e2e:local`
- `pnpm typecheck`
- `pnpm test:diff apps/cloudflare/src/execution-journal.ts apps/cloudflare/test/execution-journal.test.ts apps/cloudflare/test/hosted-local-e2e.test.ts`
- Expected outcomes:
- Duplicate commits with the same assistant-delivery fingerprint set no longer diverge solely because a regenerated local outbox id changed.
Completed: 2026-04-14
