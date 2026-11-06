# Game deletion progress and survivor authority

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and scope

Restore deletion progress for large game histories while preserving surviving
groups' authority. Implement the supplied bounded change in the existing game
and account-deletion owners. No schema, dependency, public command or group
admission-switch changes. One scoped local commit; no push or deployment.

This execution record was added during completion because the documentation
guard requires a plan at this change-set size. The supplied implementation brief
and initial PostgreSQL failures preceded production edits.

## Decisions

- Prepare at most 100 residual games outside locks and transactions. Apply at
  most 100 games and notes per transaction. Existing participant and note
  selectors record progress; page invitation clearing prevents duplicate seats.
- Keep the final page and member deletion together. The final dependency proof
  precedes global reference cleanup and key removal. Partial pages retain the
  suspension fence, profile and crypto envelopes; stop after 20 partial pages.
- Keep both the empty-entry and historical-attempt cancellation guards.
- Reuse canonical group admission behind a private chat adapter with the shared
  acceptance parser, current Terms requirement and locked addressed-seat check.
  Pair token handling and the dark group admission switch remain unchanged.
- Keep the final dependency assertion in a small helper to satisfy the existing
  complexity limit without changing the per-game loop.

## Product proof

Outcome: deletion resumes across retries without losing survivor words or keys
needed by residual work. Surviving addressed invitees can send Talk and accept
in the bound room after starter deletion.
Reaches: ordinary and large accounts, note-only authors, unjoined pair invitees,
posted and excuse-only histories, surviving group invitees and stale authority.
Proof: real PostgreSQL and real crypto for new fixtures; rollback snapshots,
residual counts, decryptability, final key checks, lock contention, reserved Talk
receipts, replay and admission refusals. Existing pair and public bearer-link
regressions remain green. Product UX: Ready for the tested service boundaries;
provider delivery and deployment are outside this local task.

## Initial failures and fixture corrections

Before production edits:

- Deletion suite: exit 1. The 1,001-game fixture threw the game overflow error;
  the independent 1,001-note fixture threw the note overflow error. A 101-game
  invitee fixture returned 101 plans; page and final-proof cases lacked `more`.
- Focused group suite: exit 1. Both historical-attempt cases exposed
  `canCancel: true`. Surviving Talk and chat acceptance returned `INVITE_EXPIRED`;
  Terms, capability and race proofs also stopped at that obsolete token guard.
- Focused real hosted deletion: exit 1. The 2,101-game fixture threw the game
  overflow instead of committing 2,000 games and returning the retryable error.

The initial real-crypto setup needed the existing control-envelope provisioning
helper. Post-fix proof corrections avoided JSON serialization of BigInt event
IDs and used a real terms proposal for fingerprint contention: posting an entry
alone does not change that fingerprint. Contact-loss proof uses an unbound
invitation, because direct member bindings remain authoritative.

Removing the page invitation clear produced exit 1 with the `(game_id, seat)`
unique-constraint failure on resume. The clear was restored and the suite passed.

## Existing test changes

- `retains historical attempts after account deletion`, both withdrawn cases:
  extend with cancellation refusal, `canCancel: false` and live-state assertions.
  Original assertions remain.
- Hosted account-data service's preparation mocks, including the existing
  prepare/apply ordering case: use the new `{ games, more: false }` shape and
  current `kept` field. Original ordering expectations remain.
- The deletion suite's member helper optionally provisions real crypto for the
  new page proofs; unrelated test behavior remains unchanged.

## Verification

Each file ran separately from the repository root against the supplied isolated,
already-migrated database, with concurrency one and no file parallelism:

```sh
DATABASE_URL=<isolated-test-database> MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --root . --no-coverage --no-file-parallelism apps/web/test/<file>.test.ts > <log> 2>&1; echo EXIT=$?
```

| File | Passing tests | Exit |
| --- | ---: | ---: |
| `game-groups-postgres.test.ts` | 151 | 0 |
| `game-account-deletion-postgres.test.ts` | 25 | 0 |
| `hosted-onboarding-member-lock-postgres.test.ts` | 32 | 0 |
| `game-report-block-postgres.test.ts` | 36 | 0 |
| `game-talk-postgres.test.ts` | 11 | 0 |
| `game-service-postgres.test.ts` | 75 | 0 |
| `game-api-postgres.test.ts` | 21 | 0 |
| `hosted-account-data-service.test.ts` | 115 | 0 |
| `game-chat-tool.test.ts` | 44 | 0 |
| `game-chat-setup-postgres.test.ts` | 16 | 0 |
| `game-rules.test.ts` | 79 | 0 |
| `game-command.test.ts` | 25 | 0 |
| `game-changes.test.ts` | 36 | 0 |
| `settings-privacy-delete-postgres.test.ts` | 1 | 0 |
| `settings-privacy-delete-route.test.ts` | 5 | 0 |
| `clinical-records-account-deletion-postgres-concurrency.test.ts` | 18 | 0 |
| `hosted-group-join-outreach-reply-recovery-postgres.test.ts` | 40 | 0 |

All 730 tests passed. The importing-test inventory was checked repository-wide.
The service test initially exited 1 because its generated changelog module was
absent; the normal prepared typecheck generated it and its rerun passed.

- `MURPH_TSC_WEB_CHECKERS=1 pnpm --dir apps/web typecheck:prepared`: exit 0,
  including after the final source edit.
- `pnpm complexity:diff`: initially exit 1; after the final assertion helper,
  exit 0, zero hotspots above 20.
- `pnpm docs:drift`: initially exit 1 for the required index update, then for
  the change-set plan requirement; final run recorded at completion.
- `git diff --check`: exit 0.

Group admission remains dark.

## Known limits

A new note that fits the apply-time note page can safely be consumed in that
page. The late-note rejection proof therefore prepares 100 notes and inserts
the 101st before final apply.

The required unchanged redactor skips malformed or command-key-mismatched
payloads, while the actor scrub still advances them. The no-system-actor-with-
ciphertext assertion is proven for valid v2 notes, not malformed payloads.
No additional cleanup machinery was introduced.

Completed: 2026-11-06
