# Persist assistant tool/error audit entries into transcript replay

Status: completed
Created: 2026-04-26
Updated: 2026-04-26

## Goal

- Persist compact assistant tool/provider audit entries in local assistant transcript state and replay them into bootstrap context so the assistant can see recent tool successes/failures and provider errors across turns.

## Success criteria

- Bound-tool status/failure summaries are appended to assistant transcripts without raw secrets, local paths, or contact identifiers.
- Provider failure messages are persisted as transcript audit entries before terminal/failover handling drops the in-memory error context.
- Bootstrap transcript replay includes audit entries as explicitly labeled context while preserving ordinary user/assistant replay behavior.
- Focused assistant-engine tests cover persistence and replay.

## Scope

- In scope:
  - `packages/operator-config` transcript kind contract.
  - `packages/assistant-engine` provider-turn, finalizer, transcript persistence/replay tests.
  - A durable architecture note for assistant runtime transcript audit state.
- Out of scope:
  - Hosted web/cloudflare run-log forwarding.
  - Canonical vault audit records.
  - Raw provider transcript storage beyond bounded local assistant runtime audit summaries.

## Constraints

- Technical constraints:
  - Assistant runtime state remains non-canonical under `.runtime/operations/assistant/**`.
  - Stored audit text must be bounded and sanitized.
  - Preserve provider-native resume behavior where possible; only bootstrap/fallback replay gets local transcript audit context.
- Product/process constraints:
  - Preserve unrelated dirty work and active hosted/Health Commons lanes.
  - Do not log or fixture real identifiers, secrets, local paths, or private contact details.

## Risks and mitigations

1. Risk: Audit entries leak sensitive identifiers into local transcript files or UI.
   Mitigation: Use existing portable-state sanitization, length bounds, and focused redaction tests.
2. Risk: Synthetic audit context is mistaken for a new user instruction.
   Mitigation: Replay only audit-marked rows as structured untrusted diagnostic data, with a regression test for instruction-like error text.

## Tasks

1. Extend transcript kind support for persisted status entries.
2. Add bounded provider/tool audit transcript builders and persistence call sites.
3. Replay status/error audit transcript entries in bootstrap context.
4. Add focused tests and docs note.
5. Run package verification and required audit passes.

## Decisions

- Follow the Codex CLI shape at the concept level: append-only per-session transcript items with bounded/sanitized tool output summaries. Murph will keep using its existing assistant transcript store rather than introducing a second rollout file.

## Verification

- Commands run:
  - `pnpm --dir packages/operator-config build` passed.
  - `pnpm --dir packages/operator-config typecheck` passed.
  - `pnpm --dir packages/assistant-engine typecheck` passed after the final review fixes.
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-service-runtime.test.ts test/assistant-transcript-audit.test.ts test/provider-turn-runner.test.ts` passed.
  - `pnpm typecheck` failed on unrelated `packages/cli/test/search-command-coverage.test.ts` fixture drift.
  - `bash scripts/workspace-verify.sh test:diff <touched paths>` failed on the same unrelated `packages/cli` typecheck target.
  - `pnpm --dir packages/assistant-engine test:coverage` ran but failed on unrelated provider/channel test drift plus the existing unrelated `src/assistant/execution-context.ts` branch threshold; touched files were above thresholds in the coverage report.
Completed: 2026-04-26
