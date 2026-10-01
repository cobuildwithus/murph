# Eliminate hosted latency telemetry deadlocks

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Ensure every multi-row hosted latency mutation acquires trace rows in one deterministic order so diagnostic callbacks cannot deadlock or silently lose milestones.

## Success criteria

- Assistant, provider-start, and checkpoint writers share one ordered-lock SQL pattern.
- Cross-writer PostgreSQL races do not produce `40P01` and preserve both writers' fields.
- Failure logs identify the bounded event/query class and database code without IDs, SQL, or raw errors.
- Focused proof, exact-head ReviewGPT, and required PR checks resolve.

## Scope

- In scope: hosted-runtime-latency store SQL, route failure telemetry, and focused concurrency/route tests.
- Out of scope: generic database retries, advisory locks, member-facing behavior, and unrelated latency-schema changes.

## Constraints

- Technical constraints: preserve checkpoint newest-251 selection before ordering the selected IDs; avoid a second state owner or broad retry; keep diagnostics privacy-bounded.
- Product/process constraints: internal operational reliability change; draft PR with parallel preliminary/final ReviewGPT and exact-head CI.

## Risks and mitigations

1. Risk: SQL reordering changes which traces qualify for checkpointing.
   Mitigation: separate candidate selection from deterministic lock order and assert the selected set is unchanged.
2. Risk: concurrency tests pass without creating opposing lock order.
   Mitigation: use two real PostgreSQL clients and fixtures whose accepted-time order opposes key/ID order.

## Tasks

1. Add cross-writer failing PostgreSQL races and safe failure-log coverage.
2. Reuse one deterministic ordered-lock CTE across every multi-row writer.
3. Run focused latency store, route, and PostgreSQL verification; inspect plans/SQL shape.
4. Commit, push, open the draft PR, launch both ReviewGPT stages in parallel with CI, resolve findings, close this plan, and push the final scoped commit.

## Decisions

- Fix lock ordering at the latency store owner; do not add a generic deadlock retry that could mask lost diagnostic updates.

## Verification

- Commands to run: hosted-runtime-latency unit/route suites, the opt-in PostgreSQL concurrency suite, Web typecheck if required, and `git diff --check`.
- Expected outcomes: deterministic no-deadlock cross-writer races and unchanged merge semantics.
Completed: 2026-08-25
