# Make hosted production-path E2E assertions passive and fidelity-enforcing

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make hosted-local production-path waits observational only so a passing E2E
  proves Temporal, Durable Object, mailbox, alarm, and runner ownership worked
  without the harness repairing the system under test.

## Success criteria

- `waitForHostedCompletion`, signed-ingress pending-work waits, and Linq send
  waits perform reads and sleeps only.
- Explicit recovery/test-control actions remain available only to scenarios
  that opt into a clearly named fault-injection mode.
- Full-stack scenarios fail during cleanup when a non-fault scenario recorded
  any harness intervention; the default intervention count is mechanically
  proven to remain zero.
- Focused helper tests prove passive timeout/completion behavior and the
  fail-closed intervention invariant.
- The required diff verification, direct hosted-local proof that is feasible in
  the checkout, completion audits, scoped commit, and PR workflow complete.

## Scope

- In scope:
  - hosted-local completion, pending-work, and Linq delivery waiters
  - harness-only intervention accounting and explicit fault-injection opt-in
  - focused scenario call-site/type adjustments and helper tests
  - truthful testing/verification docs if the claimed gate changes
- Out of scope:
  - broad process cleanup and port-ownership repair (separate active lane)
  - production artifact/migration profiles, scenario CI tiering, provider
    credential substitution, device-connect journey, and delivery idempotency
  - production runtime behavior or persisted product state

## Constraints

- Technical constraints:
  - no production routes, state, flags, or recovery behavior for harness needs
  - normal waiters may only observe; fault injection must be explicit at setup
  - do not alter the active production-web-start gate or assistant-stub scoping
    work owned by other coordination rows
- Product/process constraints:
  - preserve unrelated work and personal-identifier/privacy guardrails
  - never signal or terminate a process not started and proven owned by this
    session
  - prefer deletion of recovery policy over a replacement scheduler/manager

## Risks and mitigations

1. Risk: a fast completion can be mistaken for a prior idle state.
   Mitigation: carry the prior observed completion status as the passive wait
   baseline and require pending work, in-flight work, a due wake, or a changed
   invocation/workspace marker.
2. Risk: explicit fault tests are mistaken for production-path evidence.
   Mitigation: require an explicit `faultInjection` setup flag and fail normal
   scenario cleanup when intervention count is nonzero.
3. Risk: active lanes overlap the same helper files.
   Mitigation: constrain edits to waiter/intervention symbols and avoid their
   production-web-start and assistant-response scoping symbols.

## Tasks

1. Trace every implicit intervention and classify explicit fault-injection
   scenarios.
2. Delete recovery behavior from default completion and Linq send waiters.
3. Replace the signed-ingress direct ensure call with a passive, baseline-aware
   pending-work waiter.
4. Add harness intervention accounting, default zero enforcement, and explicit
   fault-injection opt-ins.
5. Rewrite focused tests to prove passive behavior and zero-intervention
   enforcement.
6. Run verification, required audits, final review, scoped commit, and PR gate.

## Decisions

- Keep initial synthetic wake injection separate from recovery interventions;
  the invariant targets harness actions taken after the production path should
  already own the work.
- Preserve explicit test-control primitives for named fault scenarios, but do
  not let default waiters call them.

## Verification

- Completed:
  - focused hosted-local helper tests: 4 files and 30 tests passed
  - Cloudflare app typecheck: passed
  - diff-aware Cloudflare verification: 94 files and 1,707 tests passed
  - required security/privacy audit: clean
  - required coverage-write audit: clean after adding focused facade tests
- Not run:
  - a live hosted-local signed-ingress scenario remains unsafe until the
    separately scoped process-ownership repair removes command/name-matched
    cleanup that can signal another local session
Completed: 2026-07-10
