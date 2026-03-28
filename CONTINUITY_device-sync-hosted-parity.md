Goal (incl. success criteria):
- Land the hosted device-sync parity patch behavior on the current branch without regressing overlapping hosted-control-plane or hosted-runtime work. Success means richer wake payloads, hosted snapshot/apply APIs, runner hydration/reconciliation, token-version fencing, and focused docs/tests are all present and verified.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits.
- Do not broaden into local-vs-hosted ownership policy or committed side-effect-journal redesign.
- Higher-priority tool policy blocks the repo's usual spawned audit subagents; note that explicitly in handoff if this remains unresolved.

Key decisions:
- Use the supplied patch bundle as behavior source, but merge surgically against live files rather than applying it blindly.

State:
- completed

Done:
- Read repo routing docs, verification docs, and device-sync parity review.
- Located and extracted the supplied hosted device-sync parity patch archive from the local downloads directory.
- Registered this lane in the coordination ledger and opened an execution plan.
- Merged the hosted device-sync parity contract/runtime/control-plane changes into `packages/hosted-execution`, `apps/web`, `packages/assistant-runtime`, and `apps/cloudflare`.
- Added hosted runtime snapshot/apply routes plus targeted docs/tests.
- Focused verification passed:
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - focused hosted web Vitest lane (`16` tests)
  - direct `tsx` assistant-runtime empty-vault bootstrap/maintenance assertion
- Repo-wide required checks were attempted and failed in unrelated pre-existing CLI worktree state:
  - `pnpm typecheck`: `packages/cli/src/assistant/automation/reply.ts` `TS2353` on existing `advanceCursor` properties
  - `pnpm test`: `packages/cli` build `ENOTEMPTY` while removing `packages/cli/dist/assistant`
  - `pnpm test:coverage`: same existing `packages/cli/src/assistant/automation/reply.ts` `TS2353`

Now:
- Prepare commit/handoff with exact verification results and repo-wide blocker notes.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the repo should later wire `packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts` into the root Vitest lane once the assistant-services subpath harness is standardized there.

Working set (files/ids/commands):
- local hosted device-sync parity review markdown
- local hosted device-sync parity patch archive
- `/tmp/device-sync-hosted-parity.0S6WNF/device-sync-hosted-parity-patches/*.patch`
