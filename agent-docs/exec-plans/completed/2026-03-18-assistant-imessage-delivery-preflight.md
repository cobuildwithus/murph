# Assistant iMessage delivery preflight

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Make `healthybob` / `vault-cli assistant deliver` fail cleanly when local iMessage delivery cannot read the Messages database.
- Keep the change narrowly scoped to outbound delivery so the rest of the assistant and inbox runtime behavior stays unchanged.

## Success criteria

- `assistant deliver` returns a CLI-owned `ASSISTANT_IMESSAGE_PERMISSION_REQUIRED` error instead of surfacing raw adapter/database exceptions when `~/Library/Messages/chat.db` is unreadable.
- The iMessage path probes actual SQLite readability before constructing the adapter runtime.
- Focused assistant-channel tests cover both preflight failure and adapter database-open failure.
- Required repo checks are rerun after the change, with any unrelated pre-existing failures recorded explicitly.

## Scope

- In scope:
  - `packages/cli/src/outbound-channel.ts`
  - focused `packages/cli/test/assistant-channel.test.ts` coverage
  - the active coordination ledger entry and this plan file
- Out of scope:
  - changing the overall iMessage packaging strategy for `@photon-ai/imessage-kit`
  - inbox connector behavior outside the outbound assistant delivery path
  - unrelated repo-wide red checks not caused by this slice

## Constraints

- Do not revert unrelated dirty worktree edits.
- Preserve existing assistant session metadata writes and delivery-target semantics.
- Avoid exposing raw local account paths or other personal identifiers in error messages, tests, or docs.

## Outcome

- Added an outbound iMessage SQLite-readability preflight before adapter construction.
- Mapped both preflight and adapter database-open failures to a single operator-facing remediation error that tells the user to grant Full Disk Access and restart the terminal/app.
- Added focused tests covering both failure modes.

## Verification

- Focused checks run:
  - `pnpm exec vitest run packages/cli/test/assistant-channel.test.ts --no-coverage`
  - `pnpm exec tsx packages/cli/src/bin.ts assistant deliver test --channel imessage --delivery-target '<REDACTED_TARGET>' --format json --verbose`
- Repo checks:
  - `pnpm typecheck` fails in `packages/contracts/scripts/verify.ts` because that pre-existing script expects `@healthybob/contracts` exports that are not currently present.
  - `pnpm test` initially failed on the repo-level active-plan gate before this plan file existed, then failed in the pre-existing `packages/contracts` verify path because `packages/contracts/dist/index.js` was missing after the contracts build step.
  - `pnpm test:coverage` first failed non-representatively because it was run in parallel with `pnpm typecheck`; rerun serially, it instead failed in the pre-existing parsers/inboxd build path (`packages/parsers/src/inboxd/*` against missing `packages/inboxd/dist/index.d.ts` and related type drift).

## Completion workflow

- Simplify pass: no additional behavior-preserving simplification was needed beyond the final helper shape in `outbound-channel.ts`.
- Test-coverage audit: added the two highest-impact failure-mode tests for the new iMessage readiness path.
- Task-finish review: no additional findings in the touched assistant delivery path; residual risk is limited to repo-level unrelated red checks outside this slice.
Completed: 2026-03-18
