# Add assistant cron target read/write CLI surface

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Add a first-class CLI surface to inspect and update the single outbound delivery target for an existing assistant cron job without removing and recreating the job.

## Success criteria

- `assistant cron target show <job>` returns the current persisted delivery target cleanly.
- `assistant cron target set <job> ...` updates the persisted target in place while preserving the job id, schedule, prompt, enabled state, state binding, and run history.
- The target-update flow reuses the same cron delivery validation rules as job creation, including saved self-target resolution and email identity requirements.
- Assistant daemon routing supports the new read/write surface so CLI and daemon-backed flows stay aligned.
- Focused CLI/runtime/daemon tests cover the new commands and mutation behavior.

## Scope

- In scope:
- `packages/cli` contracts, cron service layer, CLI command tree, daemon client, and tests needed for cron target inspection/update.
- `packages/assistantd` HTTP/service routing needed for daemon-backed cron target inspection/update.
- Out of scope:
- Multi-target cron delivery, schedule editing, prompt editing, or bulk retargeting.
- Changes to onboarding or preset-install behavior beyond using the new command later.

## Constraints

- Technical constraints:
- Keep the cron model single-target for now.
- Preserve existing cron job ids and run history; do not implement retargeting as remove-and-recreate.
- Reuse existing route vocabulary and validation (`channel`, `identityId`, `participantId`, `sourceThreadId`, `deliveryTarget`).
- Product/process constraints:
- The command should make current delivery targets easy to inspect.
- Audience changes should avoid stale session continuity conflicts.

## Risks and mitigations

1. Risk: Retargeting could leave stale session continuity that later conflicts with the new audience.
   Mitigation: Clear stored `sessionId` when the effective target changes and expose whether continuity was reset in the result.
2. Risk: CLI-only mutation could diverge from daemon-backed behavior.
   Mitigation: Thread the same operation through `assistantd` and reuse shared service-layer helpers.
3. Risk: Overlapping edits in `packages/cli/src/assistant-cli-contracts.ts` could conflict with another active lane.
   Mitigation: Keep the contract diff narrow, read current file state before patching, and avoid unrelated refactors.

## Tasks

1. Add cron-target result schemas and service-layer operations for reading/updating a job target in place.
2. Add `assistant cron target show` and `assistant cron target set` commands with explicit-route, `--to-self`, and `--copy-from` inputs.
3. Extend assistant daemon HTTP/client/service routing for the new read/write operations.
4. Add focused runtime, CLI, and daemon tests plus a direct built-CLI scenario check.
5. Run repo verification and required completion-workflow audits, then close the plan and commit.

## Decisions

- Keep cron jobs single-target in v1.
- Model the mutation as full target replacement, not partial patching.
- Add an easy-read `target show` command alongside the mutation command.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused direct CLI scenario with the built binary for `assistant cron target show/set`
- Expected outcomes:
- All required checks pass and the direct CLI scenario shows the target before and after an in-place update.
- Results:
- `pnpm typecheck`: passed.
- `pnpm test`: failed in unrelated existing tests under `packages/cli/test/assistant-channel.test.ts` that assert legacy outbox payload shapes and now see `replyToMessageId: null` from another active lane.
- `pnpm test:coverage`: after precreating `coverage/.tmp` to avoid a harness ENOENT, failed in unrelated existing tests under `apps/cloudflare/test/outbox-delivery-journal.test.ts` that assert legacy delivery journal shapes and now see `providerMessageId` / `providerThreadId` fields from another active lane.
- Direct CLI scenario: passed with the built CLI, including `assistant cron target show`, `assistant cron target set --toSelf email --dryRun`, and persisted in-place retargeting with continuity reset.
Completed: 2026-03-31
