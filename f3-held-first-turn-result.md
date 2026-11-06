# F3a held first-turn commit result

Web now distinguishes `held` from `defer` and lets only a turn-commit probe with a later member message pass the held row. Every real send for the held input still receives retryable `HOSTED_LINQ_INSTANT_FIRST_TURN_OWNS_REPLY` (503). Sealed/reserved rows keep that veto, answered rows keep their terminal 409, and fallback stays available.

## Proof order and commands

Tests were authored and run against unchanged implementation before the three source files were edited. Every command below captured its status immediately with `EXIT=$?` and printed that value; no command status was obtained through a pipe. Output was captured in memory and local paths were redacted before diagnostic logs were written under `.runtime/tmp/f3-held-first-turn/` (ignored).

R — real route handler:

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --no-file-parallelism apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts
EXIT=$?
```

P — real PostgreSQL:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_sm_f3 MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --no-file-parallelism apps/web/test/hosted-linq-instant-first-turn-disposition-postgres.test.ts
EXIT=$?
```

T and C:

```sh
pnpm --dir apps/web typecheck:prepared
EXIT=$?
pnpm complexity:diff
EXIT=$?
```

| Run | Exit | Result |
| --- | ---: | --- |
| R red | 1 | 3 failed, 192 passed (195 total). |
| P first red | 1 | 12 failed, 26 passed (38 total); included one invalid group fixture described below. |
| P corrected red, still unchanged source | 1 | 11 failed, 26 passed (37 total), all expected regression assertions. |
| R green | 0 | 195 passed. |
| P green | 0 | 37 passed; no tests skipped. |
| T first | 0 | Prepared Web typecheck passed. |
| C first | 1 | Route transaction callback complexity rose from 21 to 24. |
| R after guard extraction | 0 | 195 passed. |
| T after guard extraction | 0 | Prepared Web typecheck passed. |
| C after guard extraction | 0 | Route maximum 21 → 17, debt 1 → 0; other changed files' debt and maxima unchanged. |

The first PostgreSQL run tried to append a group envelope to a personal mailbox. The real mailbox owner correctly rejected that invalid fixture with `Hosted group conversation mailbox target does not match its persisted runtime container.` That optional DB case was removed before implementation; differing directness remains covered through the real route. The requested mailbox proof was practical in the specified PostgreSQL suite and did not need another file.

The complexity failure was fixed by extracting the existing first-turn error decision into `assertHostedLinqInstantFirstTurnEgress`; the separate small `isHostedLinqTurnCommitProbe` helper checks the request shape. The final route and typecheck runs cover that extraction. PostgreSQL source behavior was unchanged after its green run.

## Red failing assertions

- Route: `expect(response.status).toBe(status)` expected 200 and received 503 for `held commit with later member message`, `held commit with null keys`, and `held commit with empty keys`. The response was retryable `HOSTED_LINQ_INSTANT_FIRST_TURN_OWNS_REPLY`.
- PostgreSQL later-message case: `expect("laterMemberMessage" in authority && authority.laterMemberMessage === true).toBe(candidate === "later")` expected true and received false.
- PostgreSQL N5, late-positive, both legacy-held cases and six matrix cases: expected `held`, received `defer`. N5 stopped at its first changed assertion on red; its second changed assertion is also exercised on green.
- All negative route cases and all five negative mailbox witness cases passed before implementation and remained green afterward.

## Every existing assertion change

Only held-row egress values changed. None of the existing claim, abandonment, conflict, unresolved-dispatch, payload, receipt or provider-call assertions changed.

| Existing assertion site | Change and reason |
| --- | --- |
| N5 immediately after the rejected retry | `defer` → `held`: the rejected retry is held, distinct from retryable sealed ownership. |
| N5 after refusing another exact claim | `defer` → `held`: refusal leaves that same held row unchanged. |
| Matrix `sealed retry rejected` | Expected egress `defer` → `held`: retained ciphertext does not make a rejected retry resumable. |
| Matrix `skipped sealed` | Expected egress `defer` → `held`: legacy payload-bearing skip is held. |
| Matrix `uncertified failed empty` | Expected egress `defer` → `held`: missing certification is held. |
| Matrix `partial tuple` | Expected egress `defer` → `held`: incomplete payload tuple is held. |
| Matrix `started empty` | Expected egress `defer` → `held`: provider-started row without the sealed tuple is held. |
| Matrix `unknown` | Expected egress `defer` → `held`: unknown state retains held classification. |
| Late positive before receipt settles the rejected retry | `defer` → `held`: the row is held until positive evidence; subsequent `already_answered` assertion is unchanged. |
| Legacy-held parameterized assertion (two cases) | `defer` → `held`: both skipped-sealed and failed-empty rows remain held without replay. |

Those are the only reasons existing assertions were edited. Existing sealed/reserved `defer`, answered `already_answered`, fallback/absent `available`, and every other matrix expectation remain unchanged. No existing route assertions were changed.

## Added assertions and what they prove

- Twenty route cases assert HTTP status and success/error body, retryability, no provider-dispatch claim, and exactly the pre-existing scan's decode count. They cover the held success probe (omitted/null/empty keys), lone held input, real sends with and without keys, check-only intent/idempotency, reaction/progress/null purpose, sealed ambiguity, fresh reservation, answered and fallback rows, same-message edit, self echo, other chat, different directness, and older input.
- Six PostgreSQL cases append encrypted envelopes through the real mailbox owner and call `assertHostedLinqRecentInboundEngagementForRuntime`. They assert exact source-event/route authority and that the witness is true only for a distinct later member message. None, older, same-message edit, echo and other-chat cases remain false/absent.
- The edit case deliberately preserves existing newest matching source-event selection; it is not counted as a distinct later message. This task does not fix or change message-edit handling.

## Review and limits

Product UX verdict: Ready at the requested Web authority boundary. The change derives a transient witness during the existing bounded scan, stops at the same matching input and performs no additional decode, query or provider call. `isHostedLinqProactivityPaused`, both chat blockers, lifecycle transitions, claim and abandonment remain unchanged. A later-message reply can repeat content from an earlier ambiguous reply that landed; it never authorizes another send for the held input.

All requested commands ran successfully on the final relevant source. No live runner/model/provider delivery, CI or external ReviewGPT was run: this is the explicitly scoped Web-only local commit, with no push or PR. The result proves commit authority and preserved send vetoes, not an observed end-to-end delivered reply. No changelog publication was added for this unshipped local handoff. No new repository friction entry was needed; the invalid fixture and complexity regression were corrected within this task.

No files under `apps/cloudflare/` or completed execution plans changed. No runner, Worker, Temporal, schema, migration or persisted-state change was made. The execution plan remains active as requested.

## Files changed

| File | Added | Deleted |
| --- | ---: | ---: |
| `agent-docs/SECURITY.md` | 5 | 2 |
| `agent-docs/exec-plans/active/2026-11-06-f3-held-first-turn-commit.md` | 29 | 0 |
| `agent-docs/index.md` | 5 | 0 |
| `agent-docs/references/testing-ci-map.md` | 1 | 1 |
| `apps/web/app/api/internal/hosted-runtime/linq-egress/engagement/route.ts` | 48 | 12 |
| `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts` | 10 | 8 |
| `apps/web/src/lib/hosted-onboarding/linq-egress-engagement.ts` | 28 | 22 |
| `apps/web/test/hosted-linq-instant-first-turn-disposition-postgres.test.ts` | 46 | 10 |
| `apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts` | 82 | 1 |
| `docs/contracts/00-invariants.md` | 2 | 1 |
| `f3-held-first-turn-result.md` | 104 | 0 |
| **Total** | **360** | **57** |
