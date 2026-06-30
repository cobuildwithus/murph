# PR 337 latency simplification

## Goal

Reduce hot hosted Linq reply/outbound path latency and collapse avoidable
PR 337 complexity without weakening fail-closed route safety.

Success criteria:

- Linq route authority uses fewer web DB reads on the provider-send path.
- Contact-card sharing does not add awaited work to web-side Linq outbound
  side-effect completion.
- The route-authority control callback only exposes the Linq surface needed by
  this PR.
- Focused tests and required verification pass.

## Scope

- In: PR 337 Linq route authority assertion, contact-card share callback reuse,
  web-control authority route shape, focused tests.
- Out: new queues, jobs, services, persisted state machines, generic side-effect
  frameworks, or broader messaging route redesign.

## Plan

1. Collapse Linq authority validation reads while preserving explicit-route
   precedence and fail-closed mismatch handling.
2. Reuse one web helper for contact-card authority validation/share and detach
   webhook side-effect contact-card sharing from awaited send completion.
3. Narrow the runtime egress-authority callback to Linq.
4. Run focused verification, commit, push, and report CI state.

Status: completed
Updated: 2026-06-28
Completed: 2026-06-28
