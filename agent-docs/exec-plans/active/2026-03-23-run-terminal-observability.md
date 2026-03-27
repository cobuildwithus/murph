Goal (incl. success criteria):
- Make foreground `murph run` / `vault-cli run` terminal output useful for live monitoring by surfacing connector startup, newly imported inbox messages, and daemon/runtime failures as they happen.
- Success means the assistant foreground loop can print concise message-arrival summaries for email/iMessage/Telegram captures, surface daemon failures immediately, and keep existing command schemas/result payloads unchanged.

Constraints/Assumptions:
- Preserve the existing root `run` alias and `assistant run` / `inbox run` command schemas and returned result envelopes.
- Keep the behavior scoped to foreground terminal observability; do not change connector sync semantics, parser behavior, or assistant auto-reply policy.
- Avoid broad cross-package refactors if local connector instrumentation inside the CLI layer is enough.

Key decisions:
- Instrument connector `backfill` / `watch` activity in `packages/cli/src/inbox-services.ts` instead of changing the lower-level `@murph/inboxd` package API unless testing proves that insufficient.
- Thread inbox-daemon events into the assistant run loop through a dedicated callback rather than overloading the existing assistant scan event type.
- Add focused tests for inbox event emission and assistant daemon-event forwarding/output behavior.

State:
- completed

Done:
- Read the repo routing, verification, and completion-workflow docs for this CLI patch.
- Compared the local checkout with the provided zip and isolated the intended source/test deltas.
- Registered the active-work ledger row for the foreground observability slice.
- Ported the source changes for inbox connector instrumentation, assistant daemon-event forwarding, and shared terminal log formatting.
- Ported focused regression tests for inbox foreground events and assistant daemon-failure forwarding.
- Ran the targeted Vitest slice for `assistant-runtime` and `inbox-cli`, which passed.
- Ran the required repo commands; `pnpm typecheck` and `pnpm test` / `pnpm test:coverage` are currently blocked by unrelated pre-existing failures outside this patch.

Now:
- Ready for handoff and scoped commit.

Next:
- If desired, repair the unrelated workspace failures in `packages/web` / `packages/query` and the pre-existing CLI typecheck issue so the full required repo checks can go green again.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether startup/backfill imports should be logged with distinct wording from steady-state watch events to reduce operator confusion.

Working set (files/ids/commands):
- `packages/cli/src/inbox-services.ts`
- `packages/cli/src/assistant/automation/{run-loop,shared}.ts`
- `packages/cli/src/commands/{assistant,inbox}.ts`
- `packages/cli/src/run-terminal-logging.ts`
- `packages/cli/test/{assistant-runtime,inbox-cli}.test.ts`
- `agent-docs/exec-plans/active/2026-03-23-run-terminal-observability.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
