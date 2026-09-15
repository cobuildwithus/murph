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
- The same probe shows canonical access loading expands into seven SQL statements for an ordinary active member. This remains an optimization candidate; no live access predicate is removed.
- Applied the workspace reduction to both mailbox envelope admission owners. Real PostgreSQL proof covers rollback, simultaneous first messages, retained checkpoint fields/timestamps, replay, and causal/lane ordering. A contention probe rejected a blind insert-or-ignore because it waits on an in-flight checkpoint update; the warm existence read avoids that regression.
- Added metadata-only timing for KMS responses taking at least 250 ms, using the existing diagnostic fields and leaving deadlines, retry count, integrity validation, and key cleanup intact.
- Focused proof passed before the final contention correction: 90 mailbox tests, 28 PostgreSQL routing/concurrency tests, 93 adjacent composition tests, and 43 KMS tests. Web typecheck and complexity guard passed. The corrected warm read is under renewed verification. Exploratory ReviewGPT is still running; no final review has been claimed.

## Verification

- Commands: focused existing webhook, crypto, and database suites selected by the final diff; Web typecheck; complexity diff; exact-head PR CI; final ReviewGPT.
- Expected outcomes: less required work, unchanged dedupe/authority/failure behavior, no provider calls inside transactions, correct key cleanup, and no unresolved accepted review findings.
