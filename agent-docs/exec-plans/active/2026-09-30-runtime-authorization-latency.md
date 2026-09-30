# Remove redundant work from runtime authorization

Status: active

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
- Remaining: final independent review and exact-head CI. Live timing after
  deployment and unexplained transport/startup intervals remain unclaimed.
