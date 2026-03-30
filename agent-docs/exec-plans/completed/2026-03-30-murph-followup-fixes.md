# Integrate the supplied assistantd and loopback follow-up patch

Status: completed
Created: 2026-03-30
Updated: 2026-03-30

## Goal

Land the supplied runtime-state, CLI, and assistantd follow-up fixes so loopback validation is strict, assistantd rejects malformed opaque ids at the HTTP boundary, daemon-client failures are clearer, and assistant status reads stop using the unbounded session-filter hack.

## Success criteria

- The supplied patch intent is integrated on top of the live tree without reverting adjacent in-flight edits.
- Loopback host checks reject deceptive hosts such as `127.example.com`.
- Assistant daemon routes return `400` for malformed session-adjacent opaque ids instead of surfacing internal errors.
- Assistant daemon client surfaces non-JSON responses and pre-response fetch failures with explicit errors.
- Session-filtered assistant status reads use bounded recent-turn selection.
- Verification for this turn is run and recorded, with spawned simplify/completion audits intentionally skipped per explicit user instruction.

## Scope

- In scope:
  - `packages/runtime-state/src/{loopback-control-plane.ts,device-sync.ts}`
  - `packages/runtime-state/test/ulid.test.ts`
  - `packages/cli/src/{assistant-core.ts,assistant-daemon-client.ts,device-daemon.ts}`
  - `packages/cli/src/assistant/{status.ts,turns.ts}`
  - `packages/cli/test/{assistant-daemon-client.test.ts,device-daemon.test.ts}`
  - `packages/assistantd/src/http.ts`
  - `packages/assistantd/test/http.test.ts`
  - this execution plan and the coordination ledger row for the lane
- Out of scope:
  - unrelated active assistant/session/provider refactors
  - broader assistantd schema-sharing cleanup beyond the supplied follow-up fixes

## Constraints

- Technical constraints:
  - Preserve overlapping non-exclusive assistant and device-control lanes already in flight.
  - Keep package boundaries truthful and reuse shared loopback helpers rather than duplicating logic.
- Product/process constraints:
  - Skip spawned `simplify` and `task-finish-review` audits for this turn per explicit user instruction.
  - Still run verification and commit via the repo helper if the change lands.

## Risks and mitigations

1. Risk: Active assistant and device-control-plane work may have changed the patched files since the patch was produced.
   Mitigation: Read live file state first, patch surgically, and avoid reverting unrelated edits.
2. Risk: Assistant status changes can subtly affect ordering or retention behavior.
   Mitigation: Keep the change limited to bounded session-aware selection and add direct regression coverage.

## Tasks

1. Register the coordination-ledger row for this patch lane.
2. Apply the supplied runtime-state, CLI, and assistantd fixes onto the live tree.
3. Add or adapt focused tests for the loopback, assistantd boundary, daemon-client, and session-filtered status changes.
4. Run verification for this turn, inspect the diff, then close the plan and commit.

## Decisions

- Treat the supplied patch and notes as the source of intent, but adapt implementation details to the live tree instead of forcing a blind apply.
- Skip the repo-mandated spawned completion audits for this turn because the user explicitly requested that override.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Prefer green repo checks; if any fail, record the exact failure and whether it is plausibly unrelated before deciding whether commit is still justified.
Completed: 2026-03-30
