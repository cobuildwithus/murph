# Remove redundant work from runtime authorization

Status: completed

Outcome: Reduce runtime callback work without moving typing earlier.

## Scope and decision

Remove the ingress typing workaround. Preserve runtime-owned activity timing.
Challenge provider preflight transactions: they release every lock before the
external effect, so they do not make authorization and sending atomic. Preserve
one fresh canonical statement snapshot for member existence, current runtime,
credential binding, migration gate, and managed allowance. Keep transaction
locks where they protect a canonical database mutation.

Do not add authority caches, tokens, queues, services, or early feedback paths.
Do not claim the remaining callback transport/startup time is eliminated.

## Proof

- Real PostgreSQL checks for current, replaced, retired, and deleted owners;
  both token and exact runtime identity authorization; native bigint precision.
- Demonstrate reduced database round trips and no unnecessary row-lock wait.
- Focused callback and webhook tests, typecheck, complexity, review, and CI.
- Inspect callback startup separately before claiming both incidents resolved.

## Verification completed

- 83 ownership/route tests passed, including real isolated PostgreSQL proof.
  Provider authorization takes one statement rather than three lock queries;
  exact-runtime authorization also removes its separate routing query.
- 393 internal callback, webhook, and wake tests passed after removing the
  ingress hint. The 10 changelog archive tests passed.
- Web typecheck, complexity guard, documentation drift, and whitespace pass.
  No changed source function exceeds the complexity threshold.
- Final independent ReviewGPT round 2 passed on implementation commit
  `b7e12444ea619ac35ae5ec8ba13131be154fcc28`, with no blocking findings.
  Its 2,300 synthetic state/command comparisons matched prior authorization
  outcomes. Final closeout changes only this explanatory plan.
- Exact-head CI remains the PR handoff gate. Live timing after deployment and
  unexplained transport/startup intervals remain unclaimed; this closes the
  authorization simplification, not the full end-to-end incident investigation.
Updated: 2026-09-30
Completed: 2026-09-30
