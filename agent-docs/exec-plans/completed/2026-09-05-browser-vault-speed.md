# Reduce browser vault route loading work

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Outcome and protected boundary

Reduced redundant browser initialization and server metadata reads for private dashboard loading. Preserved same-member session reauthorization, encrypted transport, exact replica identity checks, bounded shard demand, in-memory-only retention, and refresh/error recovery.

## Investigation and route coverage

The persistent dashboard provider is the sole browser payload owner. Home, Environment (including print), Patterns, Overview, Journal, History, Training, and experiment browsing already request only core. Biomarker browsing adds labs and metrics index; biomarker and experiment details add explicitly demanded metric buckets. Research routes use core. Settings export has its own sensitive-action authorization and complete-data path. Public homepage preparation runs only on the server after the response.

The session path checks origin, session, member access, and consent before reading current replica metadata. Missing/new replica loads travel through the authenticated Worker, which resolves user crypto, reads bounded encrypted R2 children, and wraps the replica key for the browser. The browser validates member/ref/AAD bindings, decrypts, decompresses, parses, and constructs query access. Unchanged responses already avoid ciphertext, decrypt, and parsing. Worker reads and browser decoding are already concurrency-bounded.

Navigation deliberately waits for a new session authority response before displaying cached data. The warm store retains current route demand only. Altering either policy would change private data visibility or retention and was not needed for these reductions. Older transports without decompression support still use the validated legacy replica path.

## Changes and complexity decisions

- Construct only the route's required query capability and delete the obsolete factory that eagerly constructed all capabilities, its type/exports, and its now-unused shard-set adapter.
- Reuse existing metrics-client core access in the combined metrics/labs client.
- Read the prepared Patterns report directly instead of calculating the full overview.
- Read only replica ref and version from the workspace owner for dashboard sessions and homepage preparation, avoiding unrelated checkpoint/status columns and their projection.
- Import refresh orchestration only when after-response refresh work actually needs it.
- Keep the original eager record lookup maps: an experiment with lazy maps did not show a reliable improvement and was removed. Search-row generation and recursive freezing retain their current semantics.

No dependency, persistent state, network request, transaction, or concurrent database operation was added. One existing workspace query now selects two columns. Live authority checks retain their ordering. Query caches and data remain attached to the existing client lifecycle. Runtime source has a net reduction of 61 lines.

## Product UX patch and walkthrough

Outcome: less redundant work before existing dashboard data becomes usable.
Reaches: core entry, metric/lab capability expansion, navigation, Patterns, stale/missing data, denied authority, and export compatibility.
Proof: real query/loader/provider/page tests with synthetic data; synthetic timing comparison; Chromium presentation checks at 390px and 1440px.
Verdict: Ready for the scoped local change. No production deployment or production latency claim.

The provider regression suite covers cached-client reauthorization, identity changes, revocation, refresh admission, aborts, route demand changes, stale recovery, and polling. Page tests preserve Home and Environment behavior and prove that Patterns can render without reading unrelated entities, including legacy missing-report recovery. Export regression coverage retains its independent sensitive-action path. Chromium rendered the production Patterns component through its existing catalog and the release-note entry at phone/desktop widths. Four screenshots were inspected locally; none were published. The wider component catalog emitted hydration warnings in unrelated studies; those are outside the changed component and this proof does not establish authenticated end-to-end timing.

## Performance evidence

A temporary synthetic Vitest benchmark constructed 10,000 activity entities with lookup aliases, short previews, tags, empty timeline/metric/lab arrays, and current shard identities. Each iteration used a fresh graph; timing excluded fixture allocation, ran 15 iterations, discarded the first three, and reported the median of the remaining twelve. The original eager capability factory took 83.8 ms; a same-process comparison before its deletion measured 86.5 ms for that factory versus 30.0 ms for directly constructing the selected combined client, about 64% less initialization time. Core-only construction remained about 15 ms. This isolates query initialization in local Node; it excludes network, encryption, decompression, parsing, React rendering, and mobile CPU differences. The temporary benchmark was removed after measurement; permanent tests enforce unused-capability avoidance and prepared-report rendering.

Remaining potential costs are session-authority round trips, core payload size/parse work on new replicas, core search-row construction, and repeated validation/freezing when capabilities change. These require authenticated browser traces and representative payload sizes before a further transport or worker redesign is justified.

## Verification

- Query focused Vitest: 3 files, 36 tests passed (replica, shard capability/verification, and coverage).
- Web focused Vitest: 11 files, 287 tests passed (loader, provider/context, dashboard pages, session/export, homepage preparation, workspace store, provider ownership, shard routing, Home onboarding, Environment, changelog).
- `pnpm --dir packages/query typecheck`: passed.
- `pnpm --dir apps/web typecheck:prepared`: passed after ordinary generated-input/package preparation. Initial fresh-worktree checking required the existing vault-usecases package build; `pnpm --filter @murphai/vault-usecases... build` passed.
- Chromium: 2 presentation tests passed at 390px and 1440px through the isolated smoke configuration. The one-off capture spec was removed afterward.
- `pnpm complexity:diff`: passed. Existing loader/session/checkpoint hotspots retain their prior complexity; the removed factory reduces duplicated work without extending those state machines.
- Parent diff review and whitespace/privacy checks: passed. No task-owned Frog entry was needed; setup used declared build/generation commands.

## Delivery and rollout

Local scoped commit only; PR publication, external ReviewGPT, CI, merge, and deployment were not requested or performed. Shared query code builds with its Web consumer, and no replica format, database schema, or Worker protocol changes. Old/new Web and Worker continue exchanging the existing shapes. Existing auth and browser-vault rollback floors remain applicable. A future PR should run the routed external review and exact-head CI before merge.

Changelog: 2026-09-05 / lighter-private-dashboard-loading. Source PR references remain empty until a PR exists.
Completed: 2026-09-05
