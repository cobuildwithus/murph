## Goal (incl. success criteria)

Land the watched ChatGPT follow-up patch for the hosted wake substrate if it fits the current repo, keeping the change scoped to the reported HostedWake correctness fixes and simple-producer wake routing. Success means the applicable `apps/web` changes are implemented, verified with the repo-required commands, and committed without disturbing unrelated in-flight work.

## Constraints/Assumptions

- Scope is limited to the downloaded patch contents and any minimal integration fixes required by the current tree.
- Preserve unrelated worktree edits and avoid overlapping active lanes outside the touched hosted wake files.
- Verification must follow the `apps/web` rules from `agent-docs/operations/verification-and-runtime.md`.

## Key decisions

- Treat the downloaded patch as behavioral intent, not overwrite authority.
- Keep this landing on the `apps/web` wake/outbox/onboarding slice only unless the current tree forces a small adjacent adjustment.
- Prefer the repo's normal plan-bearing completion path because this is a multi-file repo code change.

## State

- In progress

## Done

- Read the repo routing, architecture, workflow, verification, completion, and testing docs.
- Read the watched thread export and inspected the downloaded patch.
- Confirmed the patch is a narrow HostedWake follow-up centered on `apps/web`.

## Now

- Register the coordination-ledger row and apply the patch carefully against the current tree.

## Next

- Run truthful verification for the touched `apps/web` slice.
- Complete the required audit passes, commit, and hand off outcomes.

## Open questions (UNCONFIRMED if needed)

- UNCONFIRMED: whether the current tree already contains any subset of the proposed HostedWake routing changes under different names.

## Working set (files/ids/commands)

- `output-packages/chatgpt-watch/69e167fa-12bc-83a0-9f1c-9f1354b2dfed-2026-04-17T080348Z/thread.json`
- `output-packages/chatgpt-watch/69e167fa-12bc-83a0-9f1c-9f1354b2dfed-2026-04-17T080348Z/downloads/hosted-wake-bugfixes-and-simple-producer-cutover.patch`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `apps/web/.env.example`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/src/lib/hosted-onboarding/**`
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
