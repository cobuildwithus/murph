# Keep Codex conversations across ordinary deploys

Status: completed
Created: 2026-11-02

## Outcome and boundary

Preserve native conversation history across developer-instruction updates. Keep
route and immutable dynamic-tool compatibility checks; refresh the base kernel
on cold resume. Notification
session selection is out of scope. Leave all changes uncommitted in this checkout.

## Evidence and approach

The planner hashes all developer instructions and suppresses them on resume.
Pinned Codex accepts cold-resume instruction overrides but ignores loaded-thread
overrides. Investigate its native turn/start collaborationMode instruction update
before selecting that existing primitive; prove warm and cold continuation with
the real installed binary and synthetic provider capture. Do not add a reload
lifecycle, process owner or persisted field. Keep tool declarations immutable.

Outcome: conversations continue with current instructions and previous context.
Reaches: direct and group ordinary turns, warm reuse and cold restore.
Proof: red/green planner regression, native request capture, focused live journey,
route/tool incompatibility regression, finalizer/restore tests and typechecks.

## Tasks

1. Audit pinned protocol and recent computed prompt/tool inputs.
2. Prove instruction update on a native resumed thread; implement the smallest
   supported request change and delete the instruction hash dependency.
3. Preserve existing saved bindings where the legacy hash proves compatibility.
4. Verify targeted suites, package typechecks and complexity; review full diff.
5. Record exact evidence, limitations and notification-session product decision.

## Risks

Native mode overrides must preserve model and reasoning effort. Existing legacy
history must not silently lose current developer guidance. Tool changes still
require a fresh thread. Real-model proof is local subscription evidence only.

## Verification

Completed: planner regression failed before the change; native warm/cold update
proof exposed the baked model-catalog override and passes after its deletion.
Terra, Sol and a legacy thread preserve native history with current instructions.
The focused local-subscription journey is Ready; it recalls prior context with
updated style and no tool effects. Engine/runtime suites, package typechecks,
container catalog contract and complexity evidence are recorded in
`codex-thread-continuity-report.md` at the repository root. No commit, push, PR,
deployment or notification-routing change was made, per the task boundary.
Updated: 2026-11-02
Completed: 2026-11-02
