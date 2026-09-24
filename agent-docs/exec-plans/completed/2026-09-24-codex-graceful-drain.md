# Preserve active replies during container drain

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Outcome and invariant

A rollout must let the current hosted reply finish and checkpoint before exit.
The existing container owns graceful shutdown; the Codex adapter still cleans
its exact detached process groups at actual parent exit or unhandled signals.

## Evidence and smallest correction

Bounded diagnostics show container SIGTERM immediately followed by an active
Codex SIGKILL and a retried reply. The adapter independently intercepts SIGTERM
and kills its child before the container can drain. Make that fallback defer
to a registered shutdown owner, retaining parent-exit cleanup. No new service,
configuration, persisted state, network hop, provider input, or retry owner.

## Scope and risk

Change the existing process cleanup helper, regression tests, lifecycle owner
documentation, and a member-facing release note. Preserve unrelated onboarding
check-ins and the already-shipped quick opening and GPT-6 defaults.
Multiple Codex groups must not mistake each other for a graceful shutdown owner.
An ordinary CLI without a signal owner must still terminate its exact children.
Repeated hosted signals must remain harmless until drain completes.

## Product UX

Patch: a texting member's active reply survives a normal rollout. No content,
permission, memory, or channel changes. Selected journeys: graceful drain,
repeated signal, ordinary CLI termination, and multiple resident processes.
Ready requires regression proof and post-deploy health; canary timing is
separate evidence and is not a guarantee for every model turn.

## Deployment

Runtime-only, no wire/schema changes. Old/new Web and Worker remain compatible.
Old containers retain the bug until runtime convergence. Deploy reviewed main,
verify smoke and convergence, then inspect the production canary. No rollback
is authorized by this plan.

## Tasks and proof

- Reproduce the shutdown-owner conflict before changing the helper.
- Prove graceful owner, repeated signals, actual exit, and standalone cleanup.
- Run focused engine/container tests, typecheck, lint, complexity and docs checks.
- Parent review, required ReviewGPT, exact-head CI, scoped merge and deployment.

## Verification

- Base regression: both SIGTERM and SIGINT cases fail on premature group kill.
- Engine process/tool suite: 81 tests passed, including owner deferral, repeated
  signals, exact parent-exit cleanup, multiple groups, and Node once delivery.
- Container shutdown/drain suite: 6 focused tests passed.
- Assistant-engine typecheck, complexity (maximum 11, no debt), docs drift and
  gardening passed. No engine lint command exists; an attempted root ESLint
  invocation was unavailable. Typecheck and focused tests cover this source.
- Changelog generation initially rejected the unsupported kind; corrected to
  the existing improvement kind. Final changelog/page proof: 49 tests passed.
- Parent review found no new provider calls, prompt changes, data writes,
  cross-version schema dependency, or unrelated edits.
- PR #3690 owns final ReviewGPT, exact-head CI, deployment and runtime evidence.

## Final design

The existing helper inspects registered signal listeners and defers to the host.
A WeakSet identifies its own fallback callbacks so multiple detached groups do
not deadlock each other. Prepending the callback observes one-shot host owners
before Node removes them. Actual parent exit still cleans exact owned groups.

Completed: 2026-09-24
