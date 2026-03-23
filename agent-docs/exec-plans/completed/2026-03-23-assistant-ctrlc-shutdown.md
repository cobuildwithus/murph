Goal (incl. success criteria):
- Make foreground `healthybob run` stop reliably on local `Ctrl+C` instead of hanging indefinitely while waiting for assistant daemon teardown.
- Success means a first local `SIGINT` triggers graceful abort, a short grace period is allowed for cleanup, and focused tests cover the forced-exit fallback without changing upstream-abort behavior.

Constraints/Assumptions:
- Keep the fix scoped to the foreground assistant loop unless a narrower dependency cannot support it.
- Preserve normal graceful shutdown and existing result semantics when teardown completes promptly.
- Do not change unrelated assistant runtime, provider, or inbox persistence behavior.

Key decisions:
- Treat this as a bounded shutdown problem in both the assistant signal bridge and the generated shell shim, because a real `SIGINT` against the live Node PID still failed to stop the process in this environment.
- Keep upstream aborts non-fatal; only locally handled `SIGINT`/`SIGTERM` should arm forced exit behavior.
- Add focused tests around the signal bridge helper and the generated shell shim instead of broad integration changes.

State:
- completed

Done:
- Traced signal handling through `runAssistantAutomation`, the assistant signal bridge, and the inbox daemon bridge.
- Confirmed local `SIGINT` abort wiring exists already; the hang happens while awaiting daemon teardown after abort.
- Ruled out the obvious iMessage SDK startup path as the primary blocker by inspecting the installed SDK implementation.
- Confirmed a real `SIGINT` sent to the live `healthybob run` Node PID still leaves the process running, so an app-only fix is insufficient here.
- Added bounded forced-exit handling to the assistant signal bridge for local `SIGINT` and `SIGTERM` while keeping upstream aborts non-fatal.
- Updated generated CLI shims to supervise child shutdown and force-stop stubborn child processes after a short grace period.
- Added focused tests for signal-bridge forced exit behavior and shell-shim child supervision, then rebuilt the CLI successfully.
- Verified a PTY `Ctrl+C` exits `healthybob run` with code `130`, and `healthybob run --once` succeeds immediately afterward.

Now:
- None.

Next:
- Monitor whether the fallback forced exit should also clean daemon state instead of leaving a recoverable `stale` marker.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether `vault-cli inbox run` needs any additional runtime-side shutdown work beyond the launcher supervision.
- UNCONFIRMED: whether the stale inbox-daemon marker after forced `Ctrl+C` should be cleaned synchronously inside the runtime instead of relying on stale-state recovery on the next run.

Working set (files/ids/commands):
- `packages/cli/src/assistant/automation/shared.ts`
- `packages/cli/src/setup-services/shell.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- `packages/cli/test/setup-cli.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/completed/2026-03-23-assistant-ctrlc-shutdown.md`
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts packages/cli/test/setup-cli.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/cli build`
- live verification: foreground `healthybob run` interrupted with `Ctrl+C`, then `healthybob run --once`
