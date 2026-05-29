# Assistant Progress Dynamic Tool Contract

## Goal

Ensure hosted user-facing Codex assistant turns expose the single model-authored progress tool, `murph.send_progress_update`, consistently in local Linq/iMessage runtime and regression tests.

Success criteria:
- Dynamic tool exposure is structural for Codex app-server thread starts and resumes, not based on the presence of a runtime delivery object.
- Missing progress delivery is a tool-call delivery-policy result, not a reason to omit the tool schema.
- Hosted local Codex stub tests catch missing `thread/start` or `thread/resume` dynamic tool registration.
- Focused tests, affected-graph verification, typecheck, and subagent review pass or any unrelated blocker is reported.

## Constraints

- Preserve unrelated dirty work.
- Keep the architecture simple: one model-facing progress tool, no final-response tool, no parallel final-delivery path.
- Do not expose secrets, user identifiers, local usernames, or home paths in docs, logs, examples, commits, or handoff.

## Findings

- The missing-tool report came from a hosted local notification/onboarding-style turn that minted a Codex session thread without dynamic tools; later resumes inherited that absence.
- Live Codex rollout metadata for the affected thread has no persisted dynamic tools, so later resume turns cannot see `murph.send_progress_update`.
- The durable fix is to make the model-facing dynamic tool structural and keep runtime progress delivery as policy: if delivery is unavailable, the tool call returns unavailable.

## Outcome

1. `thread/start` and `thread/resume` Codex app-server params now always include exactly `murph.send_progress_update`.
2. Dynamic tool execution still uses the existing progress delivery policy and returns unavailable when no supported progress sink exists.
3. Assistant-engine, CLI, and hosted-runtime tests now assert the structural dynamic-tool contract on start, resume, unavailable delivery, and hosted-local stub enforcement.
4. Final subagent review found no blocking functional, coverage, security/privacy, or simplification issues.
Status: completed
Updated: 2026-05-29
Completed: 2026-05-29
