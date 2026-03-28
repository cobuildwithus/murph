# 2026-03-28 Hosted CLI Device-Sync Followups

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Close the three requested follow-ups by proving the CLI edit ownership boundary for `food` and `recipe`, proving hosted Prisma-store id generation at the persistence boundary, and finishing the small hosted helper cleanup without changing intentionally different hosted behavior.

## Success criteria

- `food edit` and `recipe edit` CLI regressions prove `--set` and `--clear` cannot replace or remove the selected record id.
- Hosted Prisma store regressions prove new connection and agent-session ids still use the hosted random-id helper shape (`dsc_...`, `dsa_...`) at real store call sites.
- Remaining exact-match hosted helper duplication is removed or made explicitly hosted-local, with tests still green.
- Focused relevant tests pass, followed by required repo checks and required completion-workflow audits.

## Scope

- In scope:
  - `agent-docs/exec-plans/active/{2026-03-28-hosted-cli-device-sync-followups.md,COORDINATION_LEDGER.md}`
  - `packages/cli/test/{cli-expansion-provider-event-samples.test.ts,vault-usecase-helpers.test.ts}`
  - `apps/web/src/lib/device-sync/{auth.ts,shared.ts}`
  - `apps/web/test/{device-sync-shared.test.ts,prisma-store-oauth-connection.test.ts,prisma-store-agent-session.test.ts}`
- Out of scope:
  - Any broader CLI record-mutation redesign
  - Any hosted device-sync id-format changes
  - Any cross-package helper-sharing redesign beyond a tiny local cleanup

## Constraints

- Technical constraints:
  - Preserve adjacent dirty worktree edits and avoid overlapping active lanes outside the listed files.
  - Keep hosted id generation intentionally different from `device-syncd` ULID-style ids.
  - Keep fixes narrowly scoped to tests plus minimal helper cleanup unless a test exposes a real functional bug.
- Product/process constraints:
  - Use the coordination ledger for this repo-code lane and remove the row when done.
  - Run required repo checks unless a credible unrelated pre-existing failure blocks them.
  - Run mandatory `simplify`, `test-coverage-audit`, and `task-finish-review` subagent passes before handoff.

## Risks and mitigations

1. Risk: overlapping dirty edits in nearby CLI or hosted device-sync areas could make assumptions stale.
   Mitigation: read live file state before editing, keep the write set narrow, and preserve adjacent changes.
2. Risk: store-boundary tests could accidentally assert daemon id semantics instead of hosted semantics.
   Mitigation: mock random bytes directly and assert the exact hosted prefix plus non-ULID shape.

## Tasks

1. Inspect the current CLI and hosted device-sync tests/helpers to confirm the exact missing proof gaps.
2. Add focused CLI boundary regressions for `food edit` and `recipe edit` id preservation through `--set` and `--clear`.
3. Add focused hosted Prisma-store regressions for new connection and agent-session id generation.
4. Collapse or clarify the remaining exact-match hosted helper duplication in `auth.ts` and `shared.ts`.
5. Run focused tests, then required repo checks, then completion-workflow audits before commit.

## Decisions

- Start with boundary tests first; only expand production changes if a new regression test exposes a real missed call site or behavior bug.

## Verification

- Commands to run:
  - Focused Vitest runs covering the touched CLI and hosted web tests
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Focused tests prove the missing trust-boundary invariants directly.
  - Required repo checks pass, or any unrelated pre-existing blocker is documented with a defensible causal separation.
Completed: 2026-03-28
