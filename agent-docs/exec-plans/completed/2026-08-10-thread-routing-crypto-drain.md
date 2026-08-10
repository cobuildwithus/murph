# Thread routing crypto drain

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Ensure failed Linq and Telegram thread-routing preparation drains every crypto operation it starts before database ownership or request-cache teardown, and ensure retained private-root failures prevent metadata and provider replay inside the authoritative transaction.

## Success criteria

- Linq and Telegram existing-route preparation wait for both route and mailbox work to settle before `BEGIN`, preserving the first observed failure.
- Four-domain synthetic-container preparation waits for all started candidate operations to settle before returning a failure.
- Retained cached failures are observed before any new envelope query or KMS call.
- Metadata read, missing-row, parse, binding, and signature failures are retained request-locally for affected root references and are retryable in a later request.
- Focused regressions prove no crypto operation escapes request scope or replays after `BEGIN`; focused tests, prepared typecheck, scoped lint, diff hygiene, exact-head CI, and ReviewGPT pass.

## Scope

- In scope: the existing hosted domain-root request cache, batch root unwrap, candidate generation, Linq/Telegram route-plus-mailbox preparation, focused tests, and the durable crypto transaction-boundary documentation already touched by PR #1528.
- Out of scope: new cache lifecycle state, cancellation managers, background work owners, queues, schema changes, retry classes, reconciliation, or changes to provider authority and routing behavior.

## Constraints

- Technical constraints: preserve parallel happy-path work, the first observed failure, per-caller root copies, deterministic root wiping, bounded KMS concurrency, request-local retry semantics, and one authoritative transaction.
- Product/process constraints: follow the PR worktree lane, treat the merged PR #1528 ReviewGPT findings as confidential audit evidence, keep the follow-up narrowly corrective, and continue the exact-head ReviewGPT loop until `PASS`.

## Risks and mitigations

1. Risk: waiting for sibling work could change which error reaches the provider.
   Mitigation: record the first observed rejection immediately, drain all started work with `Promise.allSettled`, then rethrow that original error.
2. Risk: retaining metadata failure too broadly could suppress legitimate work.
   Mitigation: retain only when the existing caller explicitly requests request-scoped failure retention, only for references in the failed batch, and prove a new request retries normally.
3. Risk: cached successful roots or rejected promises could outlive their request owner.
   Mitigation: keep the existing AsyncLocalStorage cache owner and prove no insertion or provider work occurs after its finalizer.

## Tasks

1. Add failing regressions for fail-fast route/mailbox preparation, four-domain candidate generation, metadata-stage retention, mixed retained/uncached batches, and request-local retry.
2. Change the existing parallel aggregations to drain all started operations while preserving the first failure.
3. Make the batch root resolver consult cached results before metadata reads and retain opted-in metadata failures in the existing request cache.
4. Run focused tests, prepared typecheck, scoped lint, and diff hygiene; update the owning invariant documentation if its implementation description needs precision.
5. Review the candidate, archive this plan in the scoped commit, push, open a follow-up PR, and run the required ReviewGPT/CI gates.

## Decisions

- Accept both final ReviewGPT round-8 findings from merged PR #1528 after local code-path validation.
- Preserve parallelism and existing owners; drain already-started work instead of adding cancellation or lifecycle machinery.
- Use the current request cache for metadata failure retention rather than adding a second cache or durable failure record.

## Verification

- Commands to run: focused Vitest files for domain-root store and Linq/Telegram preparation; PostgreSQL route and pending-setup concurrency lanes when affected; `pnpm typecheck:prepared --filter @murphai/web`; scoped ESLint; `git diff --check`; exact-head required GitHub Actions; preliminary and final ReviewGPT.
- Expected outcomes: all focused and exact-head checks pass, no KMS/envelope operation begins after `BEGIN` or cache-scope closure, and final ReviewGPT returns `ROUND_OUTCOME: PASS` with no locally accepted findings.
Completed: 2026-08-10
