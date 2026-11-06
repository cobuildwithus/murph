# Correlate settlement-pending egress with runtime outcomes

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Goal and proven gap

An existing provider-egress rejection can identify usage settlement pending but cannot join the exact native-authorized attempt to later settlement, invocation or delivery outcomes. Request trace inspection does not supply that missing join. Preserve the usage fence and response semantics while adding the smallest correlation to the existing warning.

## Scope and invariants

Reuse the existing native-authorized write fence and existing structured diagnostic field. Never trust request headers for attribution. Add no database/network call, log line, provider request, retry, timeout, state, schema or infrastructure. Keep success and unrelated rejection logs unchanged. This observation does not itself fix or prove recovery from a settlement failure.

## Tasks and proof

- [x] Inspect native authority, rejection, existing typing correlation and open PR behavior; no concrete collision found.
- [x] Obtain and inspect ReviewGPT implementation and localized complexity remediation.
- [x] Expose missing correlation before the patch; prove trusted attempt attribution, unchanged 503/retry-after/no upstream, absent unknown-authority attribution, and unchanged success behavior.
- [x] Focused tests, Cloudflare typecheck and parent candidate review.


## Operational handoff

No member-visible behavior changes or public changelog. Native heartbeat management is unavailable in the current session; preserve that observation blocker and never replace it with custom monitoring. Retain unresolved underlying provider and exact downstream outcomes.

## Implementation evidence

ReviewGPT authored the implementation and its placement within the existing correlation helper. The original interceptor suite passed 229 tests; expanded tests against original source failed exactly the missing pending-attempt assertion (233 passed, one failed). The final patch passes all 234 tests through the actual native authorization/interceptor and structured-detail sanitizer. Cloudflare typecheck, docs drift and diff checks pass. Complexity debt stays 2 and maximum stays 22; the existing emitter hotspot is unchanged, and the correlation helper remains below threshold. No new helper or dependency was added.

The parent inspected the full diff for trusted native attribution, preserved typing-field presence, response and upstream call counts, privacy, cardinality and runtime cost. Initial provider input for individual and group runtimes is unchanged. No member-visible change or changelog is required.

## Publication and observation gates

Implementation is complete at this candidate. Final exact-head ReviewGPT, required CI, merge, protected Cloudflare deployment and actual serving revision verification remain pending; the PR and automation memory own their live status. The new optional field is accepted by the existing structured logger. Old/new Web and warm containers remain compatible because authorization, provider requests and response shapes are unchanged. A canonical Worker release ships this interceptor change. Observe natural settlement-pending warnings and join trusted attempts to runtime settlement and durable outcomes; absent traffic cannot establish recovery. Native heartbeat controls are unavailable, so the four-hour scheduled observation remains an explicit access blocker.
Completed: 2026-10-19
