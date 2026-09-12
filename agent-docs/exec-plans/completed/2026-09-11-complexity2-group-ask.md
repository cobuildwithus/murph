# Simplify group consultation completion authority

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariant

Reduce the complexity of the existing group consultation completion owner while
preserving audience, accepted-input and snapshot identity, expiry/fallback rules,
completion replay, error ordering, locks, and transactional atomicity.

## Evidence and owner

`apps/web/src/lib/hosted-groups/group-assistant-ask.ts` owns completion control and
provider-entry authorization. Its completion delivery guard has complexity 67;
the control transaction callback has complexity 53. Prepare and complete repeat
completion/private replay and personal-read-denied fallback handling. The delivery
guard derives the same three request aliases twice, once for locks and again for
validation, and embeds the distinct current-sender group-disclosure policy.

## Smallest change

Converge shared control outcomes before preparing new work or completing an
answer. Preserve the legacy prepare terminal response and the current-sender
already-completed response. Extract only the cohesive current-sender group
completion authorization; validate exactly the alias tuple already locked and
simplify its personal-read predicate. Separate retained completion envelope and
expiry validation from live request reauthorization while preserving read and
error ordering. No schema, prompt, public API, state owner,
transaction boundary, query, retry, or provider operation is added.

## Failure and compatibility

Keep all database reads, alias locks, and append operations in their existing
order and transaction. A private answer cannot become a group answer. Fixed
non-disclosing fallback remains the only permitted private-to-group recovery.
Retired content, expiry, ambiguous aliases, mismatched envelopes, revocation,
and stale membership retain their existing outcomes and short-circuit ordering.
There is no persisted or wire-format migration and no deployment skew change.

## Proof

Run focused group, group-member, current-sender, runtime-route and retention tests,
plus the current-sender and retention PostgreSQL suites in an isolated local test
database. Add focused control-replay and current-sender delivery policy regressions.
Run Web typecheck and the cyclomatic guard with bounded workers. Review the full
diff, exact database/lock ordering, and privacy before scoped commit and draft PR.
No model-visible instruction/schema changes require a new live-model journey.

## Progress

- Discovery and predicate equivalence review complete: the two destination kinds
  are origin_context and requester_direct; all 16 valid boolean combinations
  preserve the original audience rejection decision.
- Shared control replay and fallback outcomes converged. Current-sender policy
  uses one locked alias tuple. Retained envelope validation and live request
  reauthorization have separate private boundaries.
- Complexity guard passes: file debt 131 to 100, maximum 67 to 49. Changed
  control callback is 49, delivery authority is 31, retained-envelope read is 29.
  These remaining checks protect distinct lifecycle/identity boundaries.
- Focused group, group-member, current-sender and runtime-route suites pass:
  four files, 105 tests, with one worker. The final rerun includes the explicit
  action/status discriminated response after TypeScript caught broad inference.
- Isolated PostgreSQL current-sender and retention proof passes: two files,
  12 tests, no skips. All 221 migrations applied to a task-owned local database;
  the database was dropped normally after successful proof.
- Web generation succeeded and prepared Web typecheck passes with one checker.
  Scoped ESLint, the final complexity guard, and diff whitespace checks pass.
- Full source/test diff and privacy inspection complete. No queries, awaited
  external operations, locks, retries, or transaction boundaries were added.
  Alias validation still reads at most three rows serially under the same three
  sorted advisory locks; duplicate alias hashing was removed.
- Changelog is not applicable: internal behavior-preserving refactor with no
  member-visible change. Provider input measurement is not applicable for either
  runtime: prompts, tool schemas, generated guidance, and input assembly are
  untouched.
- Implementation complete; draft PR is the handoff boundary. Required CI and
  final ReviewGPT remain the parent completion owner's gates.
- Parent owns candidate review, Ready, ReviewGPT, required CI, and merge.
Completed: 2026-09-11
