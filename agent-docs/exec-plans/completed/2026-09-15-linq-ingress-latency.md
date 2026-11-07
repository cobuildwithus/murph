# Reduce Linq webhook preparation latency

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

- Reduce Web ingress latency for established direct Linq messages before the existing runtime wake and typing step. Keep exact member/audience authority, current access/root revalidation, encrypted atomic mailbox append, deduplication, and pointer-only Temporal recovery.

## Success criteria

- Demonstrate less awaited work against the actual owner with synthetic regression proof; focused Web tests and typecheck pass; scoped PR has green exact-head CI and final ReviewGPT.

## Scope

- In scope: Web routing and crypto preparation, redundant database work, bounded diagnostics needed to distinguish remaining preparation costs, and their tests/docs.
- Out of scope: moving typing, runtime prompts, new state owners or schedulers, plaintext-root lifetime extension, authorization caches, unrelated refactoring, and deployment in this PR task.

## Constraints

- Technical constraints: prefer deleting work or sharing already-proven operation-local facts; external crypto remains outside transactions; drain bounded parallel work before scope cleanup. Preparation never replaces live authority checks.
- Product UX (Patch): preserve ordinary private, sparse direct, replay, new-member, Family and group behavior where touched. Prove earlier admission with unchanged ciphertext, mailbox and wake outcomes; no new product exclusion.
- Product/process constraints: production diagnosis stays summarized and identifier-free in artifacts; user requested an exploratory ReviewGPT optimization and a separate final review.

## Risks and mitigations

1. Reusing stale routing or root state could cross an authority boundary. Preserve transaction locks and current owner/root/access revalidation, and test drift.
2. Parallel preparation could outlive zeroization or hold pooled connections. Bound and drain started work before BEGIN or cache finalization.
3. Timing can be misattributed. The existing preparation timer includes more than KMS, and Prisma elapsed includes client/transport wait. Separate reduced work from measured production improvement.

## Tasks

1. Obtain a guarded ReviewGPT optimization patch while independently tracing current preparation and transaction call counts.
2. Prove removable costs and apply the smallest maintainable correction with meaningful regression coverage.
3. Run focused Web tests, typecheck, complexity and parent review; add a member-facing changelog entry for any latency change.
4. Close the plan, commit, open a draft PR, complete evidence, and mark Ready.
5. Run final ReviewGPT concurrently with CI, resolve actionable findings within scope, and report the green PR.

## Decisions

- Current Web owns the correction; no new correctness owner or schema is intended.
- Metadata-only production evidence locates remaining variable delay in pretransaction preparation and the planner transaction. Exact dependency attribution remains under investigation.
- Current-main isolated checkout created and exploratory ReviewGPT request launched.
- Synthetic PostgreSQL measurement shows the existing workspace upsert issues three SQL reads although no row is consumed. One narrow existence read removes two round trips for an established workspace; a missing row requires one additional create-many insert-or-ignore.
- The same probe shows canonical boolean access loading expands into seven SQL statements. The boolean reader now composes the existing direct/Family/owner filter with the existing participant lease filter and selects only a matching member ID in one statement. The full access-state reader remains unchanged, and no live access check is removed.
- Applied the workspace reduction to both mailbox envelope admission owners. Real PostgreSQL proof covers rollback, simultaneous first messages, retained checkpoint fields/timestamps, replay, and causal/lane ordering. A contention probe rejected a blind insert-or-ignore because it waits on an in-flight checkpoint update; the warm existence read avoids that regression.
- Added metadata-only timing for KMS responses taking at least 250 ms, using the existing diagnostic fields and leaving deadlines, retry count, integrity validation, and key cleanup intact.
- The corrected warm read passes 211 mailbox, PostgreSQL concurrency, and adjacent composition tests. All 43 KMS tests, 10 changelog render tests, Web typecheck, and complexity guard also pass.
- Draft PR #3466 carries the candidate while focused validation and the separate final review finish.
- The completed exploratory response was recovered from its exact accepted turn after a capture stall. Its patch removes repeated positive member discovery between an eligible opener-continuation claim and the first direct preparation attempt. Applied after source review: null results, bounded retries and later plans still resolve again; locked admission authority remains unchanged. Eligible phone and verified-email paths respectively remove two and three Prisma reads in one discovery round.
- A real PostgreSQL parity proof compares the boolean gate against the unchanged state reader across direct, Family, owner and current-participant access, including suspension, revocation and lease boundaries. Each boolean gate emits exactly one SELECT. Prepared Web typecheck and the complexity guard pass. Together a warm mailbox append and one boolean access gate remove eight SQL round trips on the measured Prisma client; production timing still requires deployment measurement.
- Reused the existing documented-changelog-test Frog entries for the stale app-directory command and required generated input. The repository-root Vitest workspace command passes after normal fragment generation; no new friction entry was needed.
- Extended the existing ReviewGPT patch-attachment Frog entry with the completed-response capture stall and exact-identity recovery; no duplicate report or replacement model request was needed.
- The access-reader related sweep exercised 422 files: 356 passed, 52 database-gated files skipped, and 14 files needed row-fixture adaptation because they do not execute Prisma filters. Their failures were resolved in focused reruns (671 caller-fixture tests plus 17 runtime/route tests); the actual filtered access policy is covered in PostgreSQL rather than emulated in those mocks.
- All 30 focused PostgreSQL tests pass, including the access-policy projection, runtime access lock ordering, mailbox append/replay and checkpoint contention. The applied exploratory patch passes all 250 direct dispatch/preparation tests.
- Final candidate verification passes 317 composed dispatch/preparation and crypto tests, prepared Web typecheck and the complexity guard. Parent review confirms unchanged authority, typing, encryption scope and maximum retry/concurrency bounds. Final exact-head CI and ReviewGPT are tracked on PR #3466 after this implementation plan closes; deployment is outside this PR task.

## Verification

- Commands: focused existing webhook, crypto, and database suites selected by the final diff; Web typecheck; complexity diff; exact-head PR CI; final ReviewGPT.
- Expected outcomes: less required work, unchanged dedupe/authority/failure behavior, no provider calls inside transactions, correct key cleanup, and no unresolved accepted review findings.
Completed: 2026-09-15
