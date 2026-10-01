# Share route-bound automation tools with scheduled vault work

## Outcome and invariant

Hosted morning runs can inspect and repair existing reminders with the normal
vault automation tool. Reuse ordinary member and conversation ownership, version
checks, and authoritative readback; no morning-specific permission list.

## Owner and evidence

ReviewGPT round 4 traced a missing tool binding: hosted foreground operations
construct a route-bound tool, while cron receives the original execution context.
The earlier live fixture supplied the missing port and did not prove that wiring.

## Approach

- Supply one route-bound automation-tool factory from the hosted workspace owner.
- Share the existing binding operation between foreground and cron after existing
  route verification. Keep all tool actions and canonical write owners unchanged.
- Keep route-less maintenance and unsupported audiences outside conversation tools.
- Add composed hosted scheduler and actual planner/tool regression proof, then
  focused tests/typechecks and real Codex validation. Run CI and final ReviewGPT.

## State, failure, and deployment

No persisted state, schema, queue, dependency, or separate reconciliation engine.
The normal scheduled authority and per-tool checks still handle invalidated runs;
version conflicts remain canonical failures. Ship the runtime and engine together.

## Progress

- [x] Confirm missing production binding and user authorization.
- [x] Share the route binding and prove production composition.
- [x] Complete focused proof and parent candidate review.
- External completion: PR CI and ReviewGPT round 5 follow on the stable pushed head;
  their current status is maintained in the PR body, not this historical plan.

## Verification and result

The composed hosted regression uses the actual scheduler, planner, and hosted
versioned automation port, stubbing only external boundaries and model output.
It fails with the old cron binding and passes with the shared binding. A second
morning run leaves the canonical reminder unchanged. The shared context has no
ambient mutation port; both scheduled and foreground operations bind it from
existing verified conversation ownership.

Focused engine cron/planning tests: 352 passed. Runtime integration and managed
operation tests: 43 passed. Connected-app prompt tests: 9 passed. Both affected
package typechecks, docs drift, and the complexity guard passed. Source hotspot
complexity does not increase.

A real GPT-6 Sol morning journey without accounts or a ledger made four intended
repairs across twelve reminders, preserving routes, model settings, fixed timing,
recurrence, ambiguous evidence, and paused state. Its repeat made zero edits.
An earlier live repeat exposed unnecessary semantic rewrites and model retuning;
the owning skill now explicitly requires a concrete contradiction and preserves
unrelated settings. The live assertions were strengthened, not relaxed.

No deployment, production member mutation, schema, dependency, or new permission
system. Runtime and engine ship together through the existing release path.
Status: completed
Updated: 2026-09-23
Completed: 2026-09-23
