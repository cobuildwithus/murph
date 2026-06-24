Goal (incl. success criteria):
- Fix `vault-cli research scout` input-shape friction so assistant runs can reach the real Exa provider path without local validation dead ends.
- Success: CLI accepts safe profile payloads predictably, date bounds are agent-friendly, managed automation instructions show the exact payload shape, and focused tests cover the behavior.

Constraints/Assumptions:
- Preserve the compact non-identifying tag profile boundary.
- Do not widen Exa provider egress beyond the existing bounded research-scout request shape.
- Do not persist Exa output or profile payloads.
- Keep the fix narrow; no broad research orchestration redesign.

Key decisions:
- Treat raw profile JSON as the canonical CLI `--input` body.
- Allow a `{ "profile": ... }` wrapper as an ergonomic compatibility shape.
- Keep generic `tags` unsupported and surface bucketed fields instead.
- Clamp future `--until` timestamps to the current runtime time before calling Exa.

State:
- Ready to close.

Done:
- Read required workflow, architecture, invariant, security, reliability, and product docs.
- Identified mismatch between contract full-request shape and CLI raw-profile input parsing.
- Added `research payload-schema`, CLI profile-wrapper parsing, date-bound normalization, managed automation guidance, and focused tests.
- Verified the scoped patch in a clean temp worktree with focused CLI and assistant automation tests plus package typechecks.

Now:
- Close the plan and create a scoped commit.

Next:
- Handoff.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/cli/src/commands/research.ts`
- `packages/cli/test/research-scout.test.ts`
- `packages/assistant-engine/src/assistant/managed-automations.ts`
- `packages/assistant-engine/test/managed-automations*.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/research-scout.test.ts packages/cli/test/payload-schema-command.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/managed-automations.test.ts test/managed-automations-core.test.ts`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
