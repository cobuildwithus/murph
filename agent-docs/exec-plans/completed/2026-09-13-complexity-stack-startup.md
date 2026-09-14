# Separate local stack preparation phases

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Outcome and invariant

Reduce startup orchestration complexity (139) by separating runner build/configuration preparation and database preparation at their existing ownership boundary. Preserve exact subprocess arguments, environment objects, preparation order, abort signal, reuse behavior, and cleanup scope.

## Design and scope

Two private functions in the existing stack owner receive explicit inputs. No new lifecycle, state owner, import, dependency, or runtime contract. The stack continues to own processes and cancellation; both preparation phases stay inside its original try/catch. Runner environment updates use the same referenced objects. Database schema selection, migration skip, Linq seeding, and diagnostics are unchanged.

## Verification

Focused stack, lifecycle cleanup, environment and port-admission tests; hosted-local-harness typecheck; complexity ratchet; full diff and privacy review. PR completion requires final ReviewGPT and exact-head CI. No changelog because this is internal development orchestration.

## Progress

Implementation and parent review complete. Passed 207 focused stack, cleanup, environment and port-admission tests; hosted-local-harness typecheck; complexity guard (139 to 123, debt reduced by 16). Both new preparation functions remain below 20. The remaining orchestration branches retain visible lifecycle ownership rather than hiding mutable resource state in a new controller. No external integration contract changes; exact-head CI and final ReviewGPT remain PR completion gates.
Completed: 2026-09-13
