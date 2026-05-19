Goal (incl. success criteria):
- Finish the hosted runtime scheduling fix so projected runtime wakes never force an early full `idle_shutdown` snapshot, but due projected wakes can run another hot foreground pass before the idle checkpoint delay.
- Success means due provider/outbox cleanup wake work is serviced in-process, the idle checkpoint delay still controls full snapshots, and tests prove both.

Constraints/Assumptions:
- Keep Cloudflare thin: no new Durable Object wake semantics or host-side interpretation.
- Keep a single full checkpoint path: runtime-owned `idle_shutdown` checkpoint after idle delay or host checkpoint deadline.
- Preserve unrelated dirty working-tree edits.
- Avoid secrets, raw identifiers, message content, or local paths in committed artifacts.

Key decisions:
- Split dirty wait outcomes inside `packages/assistant-runtime/src/hosted-runtime.ts`.
- Treat projected runtime wakes as hot-pass triggers only, not checkpoint deadlines.
- At/after host checkpoint deadline, checkpoint instead of starting new projected work.

State:
- Active.

Done:
- Reviewed repo workflow, reliability, security, hosted runtime protocol, testing map, and assistant-runtime docs.
- Confirmed current dirty loop waits only for idle/deadline/external wake and ignores projected wake timing.
- Patched the dirty wait to distinguish external wake, projected runtime wake, idle checkpoint, and host-deadline checkpoint.
- Added assistant-runtime coverage for due projected hot pass servicing before checkpoint and host-deadline checkpoint behavior.
- Added hosted-local E2E proof that provider cleanup DELETE occurs without a runner nudge before any early idle snapshot.
- Addressed simplify audit findings by preserving the projected-wake serviced marker across unrelated external wakes and improving the E2E timeout failure message.
- Security/privacy audit reported no findings.
- Coverage audit reported coverage sufficient and made no edits.
- Final completion review reported no findings.
- Verification passed after post-audit fixes: `packages/assistant-runtime` typecheck; focused hosted-runtime entrypoint tests; hosted-local active-turn E2E no-snapshot/cleanup probe; `apps/cloudflare` typecheck; scoped `workspace-verify test:diff`; `pnpm test:smoke`; `git diff --check`; scoped privacy scan.

Now:
- Commit scoped changes.

Next:
- Hand off with commit id and deployment note.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `apps/cloudflare/test/hosted-local-active-turn-latency-e2e.test.ts`
- `agent-docs/exec-plans/active/2026-05-19-hosted-projected-wake-hot-pass.md`
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
