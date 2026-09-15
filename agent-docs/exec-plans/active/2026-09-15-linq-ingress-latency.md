# Reduce Linq webhook preparation latency

Status: active
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
- The same probe shows canonical access loading expands into seven SQL statements for an ordinary active member. Preparation now reuses the already-read own-active-access predicate solely to select crypto work; sponsored access still uses canonical derivation. The hint is not carried into admission and no live access predicate is removed.
- Applied the workspace reduction to both mailbox envelope admission owners. Real PostgreSQL proof covers rollback, simultaneous first messages, retained checkpoint fields/timestamps, replay, and causal/lane ordering. A contention probe rejected a blind insert-or-ignore because it waits on an in-flight checkpoint update; the warm existence read avoids that regression.
- Added metadata-only timing for KMS responses taking at least 250 ms, using the existing diagnostic fields and leaving deadlines, retry count, integrity validation, and key cleanup intact.
- The corrected warm read passes 211 mailbox, PostgreSQL concurrency, and adjacent composition tests. All 43 KMS tests, 10 changelog render tests, Web typecheck, and complexity guard also pass.
- Draft PR #3466 contains the verified workspace optimization and bounded KMS diagnostic improvement. Exploratory ReviewGPT is still running; the PR stays draft pending its response and a separate final review.
- The preparation reuse passes 252 direct preparation/dispatch tests and 67 composed crypto-store tests, including stale own-access hints with withdrawn consent, Family transitions, drift, and failure draining. Prepared Web typecheck and the complexity guard pass. Together the ordinary warm direct path removes nine SQL round trips on the measured Prisma client.
- Reused the existing documented-changelog-test Frog entries for the stale app-directory command and required generated input. The repository-root Vitest workspace command passes after normal fragment generation; no new friction entry was needed.

## Verification

- Commands: focused existing webhook, crypto, and database suites selected by the final diff; Web typecheck; complexity diff; exact-head PR CI; final ReviewGPT.
- Expected outcomes: less required work, unchanged dedupe/authority/failure behavior, no provider calls inside transactions, correct key cleanup, and no unresolved accepted review findings.
