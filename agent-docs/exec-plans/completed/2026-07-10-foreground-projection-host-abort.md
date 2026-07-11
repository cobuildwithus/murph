# Foreground Projection Host-Abort Ownership

Status: completed
Updated: 2026-07-10

## Goal

Fix the returned PR review finding that host cancellation can release a hosted
runner slot while mailbox projection/import work or Codex config preparation is
still mutating the warm workspace.

Success criteria:

- Host abort keeps single-runner ownership until any already-started local
  workspace mutation sections settle.
- A replacement invocation remains rejected as busy while those local mutations
  are blocked.
- After the mutation settles, the original invocation rejects with the host
  abort reason and only then can replacement work be admitted.
- No provider or deferred-usage completion is added to this host-abort barrier.
- Focused hosted-runtime tests prove the ownership boundary for initial imports,
  late foreground projection, and replacement admission.

## Constraints

- Keep the fix scoped to the retained ChatGPT review finding.
- Preserve foreground reply priority: abort should still signal the loop; the
  drain only waits for bounded local mutation sections that have already
  entered non-cancellable workspace writes.
- Do not add new persisted state, queues, or broad lifecycle managers.
- Keep secrets, local identifiers, raw payloads, and home paths out of committed
  artifacts and handoff text.

## Approach

1. Trace current foreground runtime cancellation and the workspace runner's late
   mailbox import completion path.
2. Reuse or extend the existing hosted-runtime completion tracking primitive so
   host abort drains only local mutation completions.
3. Await bounded Codex config preparation directly instead of racing it.
4. Add regression coverage for host abort while initial mailbox import or late
   foreground projection is blocked, plus bounded config preparation ownership.
5. Run focused verification plus required completion audits.

## State

Active.

## Notes

- Source review: `output-packages/chatgpt-watch/6a50dda7-0ff8-83ea-84da-2384762830c6-2026-07-10T124524Z/assistant-response.md`.
- No patch artifact was returned; implementation follows the retained review
  text.
- Deep-review audit found the same race on runner-managed initial/pre-assistant
  imports; mailbox import helper completion is now tracked centrally as local
  workspace mutation work.
- Follow-up deep review found imports could start after an abort-drain snapshot;
  mailbox imports now fail before starting when their effective signal is
  already aborted.
Completed: 2026-07-10
