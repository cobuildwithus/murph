# Assistant self-chat mode

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Make the iMessage-backed assistant safe and usable for a dedicated self-chat thread by handling Messages-db permission failures cleanly and by letting opted-in self-authored captures drive the assistant through text or parsed attachment content.

## Success criteria

- `vault-cli assistant run` exposes explicit `--allowSelfAuthored` and `--sessionRolloverHours` options.
- Assistant auto-reply can build prompts from message text, audio transcripts, and extracted OCR/document text.
- Self-authored captures only trigger auto-reply when explicitly opted in, and recent assistant echoes in the same thread are suppressed.
- Conversation-key session reuse can roll over after a caller-supplied age threshold without changing explicit `sessionId` or alias behavior.
- iMessage delivery and inbox daemon startup fail with one operator-facing Full Disk Access message instead of a raw `chat.db` stack trace.
- Focused assistant/inbox tests cover the new behavior, followed by the repo-required checks.

## Scope

- In scope:
  - `packages/cli/src/assistant/{automation,service,store}.ts`
  - `packages/cli/src/{commands/assistant,inbox-services,outbound-channel,imessage-readiness,bin,incur.generated}.ts`
  - targeted assistant/inbox tests
  - command/runtime docs needed to keep the new CLI surface truthful
- Out of scope:
  - new non-iMessage delivery channels
  - multimodal semantic image understanding beyond existing OCR/transcript inputs
  - broader assistant architecture changes outside the self-chat and readiness slice

## Constraints

- Preserve the current dirty assistant-session and inbox-runtime refactors already in flight.
- Keep assistant-state and inbox runtime file layouts unchanged.
- Do not make self-authored auto-reply the default; it must remain explicit opt-in.
- Keep canonical inbox triage semantics unchanged aside from the added `assistant run` options.

## Risks and mitigations

1. Risk: self-authored auto-reply could loop on the assistant's own outbound iMessages.
   Mitigation: compare recent self-authored captures against the latest assistant transcript entry within a short echo window and skip exact echoes.
2. Risk: session rollover could break existing explicit session or alias workflows.
   Mitigation: apply age-based rollover only on conversation-key reuse, not explicit `sessionId` or alias matches.
3. Risk: readiness preflight could diverge between inbox ingestion and outbound delivery.
   Mitigation: move the Messages-db probe and permission mapping into one shared helper and reuse it from both paths.
4. Risk: CLI errors could still print as raw stacks at the bin entrypoint.
   Mitigation: print `IncurError` messages directly at `bin.ts` so `VaultCliError` guidance stays operator-readable.

## Tasks

1. Add the shared iMessage readiness helper and wire it into outbound delivery and inbox daemon startup.
2. Extend assistant auto-reply with self-authored opt-in, attachment-derived prompt building, parser deferral, and recent echo suppression.
3. Add session age rollover to conversation-key resolution and thread the option through `sendAssistantMessage` and `assistant run`.
4. Update focused tests plus command/runtime docs for the new self-chat behavior.
5. Run completion-workflow audits, repo-required checks, and commit only the scoped files.

## Decisions

- Use the existing assistant transcript as the source of truth for echo suppression instead of persisting separate outbound-channel history.
- Treat pending/running attachment parsing as a defer signal so the same capture can be retried once transcripts or OCR complete.
- Reuse the existing conversation-key binding model for self-chat rather than introducing a separate self-thread identity concept.

## Outcome

- Added a shared iMessage Messages-db readiness helper and reused it from outbound delivery and inbox daemon startup.
- Added `assistant run --allowSelfAuthored` and `--sessionRolloverHours`, plus self-authored attachment-derived prompt building and recent echo suppression for dedicated self-chat threads.
- Added focused assistant/inbox regression coverage for session rollover, self-authored attachment prompts, and inbox-startup permission failures.
- Refreshed the command-surface and README docs for the new self-chat behavior.

## Verification

- Commands to run:
  - `pnpm exec vitest run packages/cli/test/assistant-channel.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/inbox-cli.test.ts --no-coverage --maxWorkers 1`
  - completion workflow audit passes
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Focused assistant/inbox tests prove the new self-chat path without regressing existing iMessage readiness behavior.
  - Required repo checks are green, or any unrelated blocker is documented with clear causal separation.

## Completion workflow

- Simplify pass: no additional behavior-preserving simplification was needed after the shared readiness helper and session-lookup changes were in place.
- Test-coverage audit: added the highest-impact missing regression tests for self-authored attachment prompts, session rollover, and inbox-startup permission failures.
- Task-finish review: no new findings in the touched self-chat/readiness slice; residual risk remains in the unrelated pre-existing Ink chat worktree errors that block repo-wide builds.
Completed: 2026-03-18
