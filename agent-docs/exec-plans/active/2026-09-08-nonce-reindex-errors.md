# Preserve callback replay rejection during concurrent index rebuilds

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and invariant

Treat an exact nonce uniqueness failure during concurrent index maintenance as
the existing replay rejection. Fresh signed callbacks must still succeed once;
duplicates and expired callbacks must never acquire authority.

## Owner and evidence

The callback nonce store owns one raw insert through Prisma's PostgreSQL adapter.
PostgreSQL documents that concurrent unique-index rebuilding can raise a unique
violation despite ON CONFLICT. The store currently propagates that exception.
The existing caller already maps a false admission result to a replay response.

## Scope and design

Handle only a proven nonce-key uniqueness error at the existing store. Preserve
one statement, no retries, no new transaction, no cleanup, and no error logging.
Unrelated or unrecognized database errors retain their original failure path.
No schema, prompt, tool, provider, or production database changes are included.

## Product UX

- Outcome: duplicate internal callbacks retain a controlled replay rejection during maintenance.
- Reaches: member and system signed callbacks through the shared nonce store.
- Proof: fresh, duplicate, expired, and unrelated-failure cases; signed callback rejection; real local PostgreSQL error-shape and online-rebuild proof.

## Verification and completion

1. Prove the actual adapter error shape and add a failing regression.
2. Implement the narrow classification and update the architecture contract.
3. Run focused unit/auth/PostgreSQL tests, Web typecheck, and complexity review.
4. Review the candidate and commit; applicable PR review/CI precede deployment.

## Deployment

Deploy Web before primary-key maintenance. Old and new Web use the same schema
and success path; old instances can still propagate maintenance conflicts.
Wait for old requests to drain before rebuilding. Reverting Web is schema-safe
but loses the improved error handling. No local production mutation is authorized.

## Evidence

- Regression failed on the original implementation and passed after the fix.
- Focused nonce store, signed callback, and real PostgreSQL suites: 30 tests passed.
- PostgreSQL 18 proof captures a real adapter uniqueness error and injects it at
  the raw-query boundary; separately, a real concurrent primary-key rebuild is
  held at its old-snapshot barrier while fresh and duplicate admission run.
  This does not claim deterministic reproduction of the PostgreSQL race itself.
- Web typecheck and focused ESLint passed. Complexity guard passed: maximum 15,
  no functions above 20. Parent review found no additional runtime changes needed.
- Product UX: Ready at the callback boundary. No model/prompt behavior changes;
  stochastic model proof is not relevant to this database admission invariant.
- Changelog: not applicable; maintenance-time internal duplicate rejection only.
- Production deployment and the production index rebuild remain separate steps.
