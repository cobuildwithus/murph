# Query SQLite Cleanup

## Goal

Land the cleanup described by `agent-docs/exec-plans/completed/SQLITE_CLEANUP.md`:

- keep dense provider telemetry out of default search and read projections,
- move wearable product surfaces to compact projection data,
- fix the ingestion boundary so dense Junction/Garmin timeseries do not recur as canonical event observations,
- apply the SQLite-specific space improvements after the modeling fix,
- fix the JSONL memory inefficiency called out in the plan.

## Constraints

- Do not expose raw health payloads, provider identifiers, local account names, local paths, secrets, raw message text, or direct personal identifiers in code, tests, logs, docs, commits, or handoff.
- Preserve unrelated dirty work in assistant-runtime, assistant-engine, device-syncd, and existing active ledger rows.
- Prefer the existing query projection and wearable summary primitives over new broad abstractions.

## Approach

1. Add a shared dense-provider-observation predicate and use it to keep raw provider metric observations out of search.
2. Persist compact wearable summary tables from the full source snapshot, then read wearable CLI/runtime surfaces from those tables.
3. Exclude dense provider observations from `query_entities` after compact wearable data is available.
4. Stop Junction timeseries normalization from emitting default event observations, and add a dense telemetry policy guard in core for event observations as well as samples.
5. Switch FTS to external content, replace raw attribute JSON in search text with allowlisted structured terms, and stream JSONL source reads.

## Acceptance

- Query projection rebuilds without dense provider observations in default `query_entities`, `query_search_document`, or FTS.
- Wearable latest/day/list/trend/drift surfaces still work through compact projected data.
- Junction timeseries stays raw/canonical evidence rather than event-ledger spam.
- Existing projection schema resets cleanly via a version bump.
- Focused query/importer/core/vault-usecases tests pass; full required verification is attempted and reported.

## Verification

- Focused query projection/search/wearable tests.
- Focused Junction importer and core dense telemetry guard tests.
- Focused vault-usecases wearable service tests.
- Repo typecheck/test per workflow requirements unless blocked by unrelated dirty/pre-existing failures.

## State

- Done: active plan registration, projection/search modeling fix, compact wearable runtime readers, core dense telemetry guard, Junction import payload filtering, external-content FTS, structured search allowlist, JSONL/source hash streaming.
- Now: focused verification and repo-level checks.
- Next: commit/push/deploy only if scoped commit remains safe with the current dirty worktree.
