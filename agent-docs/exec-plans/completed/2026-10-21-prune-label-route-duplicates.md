# Remove duplicated shared label-route regression cases

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal

Remove duplicated generic label-route regressions while retaining each route's
configuration and authorization proof. Record the broader test audit honestly:
the user's proposed 20–50% reduction is a hypothesis, not a deletion quota.

## Success criteria

- Every removed case maps to a retained test of the same production handler.
- Focused route tests pass before and after; shared-handler coverage is unchanged.
- Retained label CLI regressions and relevant typecheck pass.
- Publish a separate scoped candidate; preserve #4262 and parent merge ownership.

## Scope

- In scope: ten duplicated cases in `apps/web/test/supplements-route.test.ts`
  and their now-unused concurrency polling helper; this evidence record.
- Out of scope: production code, dependencies, workflows, test configuration,
  thresholds, live providers/data, Android regressions, native publisher work,
  tsrs changes, and execution-architecture changes owned by the CI tooling track.

## Constraints

- Isolated worktree created through `scripts/create-worktree`, based on
  `d90edcf09127c1d4f69daf4c7b2e23b4f3c57cf6`. Relevant guidance and route files
  are unchanged from the first audit checkout. Open PRs/worktrees inspected;
  no overlapping label-route owner found. No shared configuration edits.
- Do not infer redundancy from names, mocks, unit-test labels, or skipped E2Es.
- Keep unique authorization, billing, concurrency, idempotency, cancellation,
  privacy, parser, and packaging regressions unless equivalent proof exists.
- No external review upload; this low-risk test-only reduction follows the
  completion workflow's test exemption. Parent review and exact-head CI remain.

## Risks and mitigations

1. Similar route tests could cover different implementations or configurations.
   Both production routes call `createProductLabelsRouteHandlers` from
   `apps/web/src/lib/product-labels-route.ts`. Removed cases target unconditional
   shared parsing, limits, and batch orchestration; retained cases cover differing
   IDs, lookup priority, food projections, query adapters, errors, and auth wiring.
2. Line coverage alone could hide a lost boundary condition.
   Compare actual inputs/assertions case by case, then compare coverage as a
   secondary check. Preserve malformed input, 50/51 batch boundaries, 257-character
   queries, 33 KiB body rejection, dedupe result order, and 3/3/1 concurrency proof
   in the food route tests using the same production handler.
3. A test-count reduction could be mistaken for a material CI speedup.
   Report callback and wall time separately. This is primarily maintenance
   reduction; the sampled pair consumed only 284 ms of test-body time.

## Tasks

1. Complete broad inventory, slow-suite review, and duplicate-family discovery.
2. Run baseline pair with focused shared-handler coverage.
3. Delete the ten redundant cases; keep all retained test bodies unchanged.
4. Run the retained pair, label CLI regressions, typecheck, and self-review.
5. Close plan, commit, publish separate draft PR, then mark candidate Ready.

## Decisions

### Exact removal map

All titles below exist in both route suites. Remove only the supplement copy;
retain the food copy, which enters the same unmocked production GET/POST handler.
Only the database/query adapters are mocked. These are HTTP-handler composition
tests, not live database or deployed E2E proof.

| Removed title | Behavior retained in `foods-route.test.ts` |
| --- | --- |
| uses one search result by default | GET default limit 1 and false off-market flag |
| returns an empty search without touching the database when q is blank | Blank query returns empty list without querying |
| rejects oversized GET search strings before querying | 257-character query rejected before query effects |
| uses one match per batch query by default | POST default limit 1, response envelope, adapter input |
| dedupes trimmed batch queries and maps duplicate results back | Two unique queries, four ordered response entries |
| bounds concurrent batch searches | Seven pending queries complete in groups 3/3/1; max concurrency 3 |
| accepts max-sized POST batches and bodies over the old cap | 50 queries accepted, body above 8 KiB and below 32 KiB |
| rejects malformed POST JSON | Invalid JSON rejected with no query effects |
| rejects empty or oversized POST query batches | Whitespace-only and 51-query arrays rejected |
| rejects oversized POST query strings and request bodies | 257-character query and 33 KiB body rejected |

Keep all fourteen other supplement cases: GET/POST authorization, missing key,
bounded successful search and supplement response shape, explicit DSLD ID and UPC
lookups, digit-string fallback priority, default-config batch lookup precedence,
authorized POST wiring, and supplement-specific safe failure/unconfigured codes.
The food suite also keeps its distinct FDC/UPC precedence, generic-only requests,
compact nutrition projections, contaminant evidence, and all shared boundary cases.

### Broader inventory and limits

- Initial baseline `80d805f20023f36d391c97b230125abc267c8a81`: 2,622 tracked
  JS/TS test/spec files; Babel AST parsing finds 31,909 `it`/`test` calls with
  function callbacks, with zero parse errors. Fixture source strings are excluded.
  Loops and parameter tables count once, so this is not executed test count.
- First PR #4262 removes nine declarations; rescanning that head finds 31,900.
  The earlier regex estimate of 32,172 was superseded by the AST count.
- Largest declaration groups at initial baseline: Web 11,886; assistant-engine
  4,714; Cloudflare 3,219; assistant-runtime 2,809; device-syncd 1,349; CLI 1,337;
  scripts 1,008; core 900; query 674. Names do not classify unit vs integration.
- Exact callback AST hashing found five matching groups. Most have differing
  parameter tables or schemas. One hosted-email normalization case and three
  overlapping phone-result-routing table rows are genuine small duplicates;
  unique group/unverified-authority rows remain valuable. Do not mix those
  unrelated tiny changes into this scoped label-route PR.
- Repeated literal-title scan found 73 cross-file groups. Shared handler tracing
  revealed this label-route family; matching auth titles on different endpoints
  and nonce races on different stores are not equivalent coverage.
- Heuristic source/config-only candidates: 192 declarations in 66 files (0.60%).
  This deliberately overinclusive scan also catches require-loaded implementations.
  Many guards protect migration order, encrypted storage classification, and
  environment allowlists; they are not an approved deletion list.
- Callbacks with only direct presence/type matchers: 72 in 47 files (0.23%).
  Examples still exercise rejected steer admission, cleared crypto buffers,
  key isolation, and duplicate identity rejection. Matcher shape is not value.
- Public-export/barrel scans found missing equivalence for several exported
  symbols; keep packaging and import-surface checks rather than assuming broader
  tests exercise every facade. Live opt-in E2Es do not replace ordinary regressions.

### Runtime distribution and ranked audit

Sample: successful Host Support run 39536239554 at
`a5685fd251d20b63cc41638b88af08b223031019` (not the cleanup's exact base).
Elapsed 55m18s includes queues/setup. Selected package/Web/Cloudflare jobs report
38,275 passing and 1,778 skipped test executions; separate PostgreSQL, fixtures,
repo-tools, native, and host-matrix lanes are excluded. These are executions,
not unique unit tests. Parsed file timings total 2,911,094 ms across 2,360 files;
parallel file elapsed sums do not equal pipeline latency.

| File elapsed bucket | Files | Passing executions | Aggregate file elapsed |
| --- | ---: | ---: | ---: |
| Under 100 ms | 1,388 | 13,449 | 37,546 ms |
| 100 ms to 1 s | 619 | 12,265 | 221,698 ms |
| 1 s to 10 s | 291 | 9,127 | 817,819 ms |
| At least 10 s | 62 | 3,434 | 1,834,031 ms |

62 files consume 63.0% of summed test-body elapsed; 2,007 sub-second files contain
25,714 passing executions but consume 8.9%. The top ten files consume 29.4%.

| Ranked family | Sample elapsed | Audit decision and concrete reason |
| --- | ---: | --- |
| CLI timing subprocess, 39 cases | 190.293 s | Keep: paired telemetry on/off subprocesses assert exact output/exit parity, no provider effects or vault mutation, and redacted bounded telemetry. In-process timing tests additionally cover EPIPE and phase accounting. |
| Scripted Codex runtime, 141 cases / 7 skipped | 174.766 s | Keep: actual protocol composition, exact-byte workout apply/recovery, authority, generated schemas and interruption cases. |
| Linq attachment idempotency, 22 cases | 101.229 s | Keep: distinct accepted/rejected/stalled-body reconciliation outcomes; prepare-deadline and send-deadline tests are different. Repeated 10–20 s waits are harness optimization candidates. |
| Interrupted system recording integration, 9 cases | 82.091 s | Keep: persisted retry, checkpoint and foreground interruption proof. One projection-error case consumes 62.201 s, including a real retry-at wait. |
| Release-script audit, 48 cases | 72.990 s | #4262 removes cheap obsolete assertions. Keep tarball and archive privacy/metadata tests; sample tarball work is 53.573 s. |
| Local service live input, 33 cases | 61.143 s | Keep: held-group outcome is 36.344 s. Similar steer cases differ in persisted accepted input versus original outbox context preservation. |
| Real-Codex E2E file, 557 cases / 486 skipped | 58.674 s | 71 ordinary hermetic passes validate live-fixture integrity, real CLI writes, prompt/CLI composition and provider configuration. Opt-in model journeys are not ordinary replacement coverage. |
| Automation runtime, 194 cases | 39.177 s | Keep: distinct cursor recovery, retry evidence, terminal state and delayed scheduling. |
| Junction blood-pressure backfill, 111 cases | 38.399 s | Keep: 396-key cardinality case 19.056 s; failed-retry evidence 9.095 s, plus provider failure bounds. |
| Codex websocket passthrough, 1 case | 37.784 s | Keep: real workerd/native protocol recovery; not a mock-only unit assertion. |
| Junction provider client, 47 cases | 36.656 s | Keep: a refresh-outlives-server-wait/no-replay case costs 35.023 s. Timing-harness candidate, not safe deletion. |
| Food/supplement HTTP route family, 58 cases | 0.284 s | Remove ten repeated shared-handler cases, preserve 48 boundary/configuration cases. Maintenance saving, not a material CI latency claim. |

A 20–50% repository-wide deletion is not demonstrated by this audit. Material
runtime opportunities currently point to subprocess startup, real retry/deadline
waits, import/setup costs, and execution architecture. The tooling sibling owns
that work; changing it here would broaden scope. This audit does not certify
every one of the 31,909 declarations as necessary or unnecessary.

## Verification

- Baseline and candidate: focused `foods-route` and `supplements-route` tests with
  V8 coverage restricted to the shared handler, JSON results for callback timing.
- Retained CLI food/supplement label suites; relevant Web typecheck; complexity
  guard and diff checks. Record results below before publication.

### Results

- Baseline: 58/58 route tests passed. Candidate: 48/48 passed, zero skipped.
  Supplement suite 24 to 14 cases; food suite remains 34. All fourteen retained
  supplement callback bodies are byte-identical to baseline. Test diff: 357
  deleted lines, three explanatory comment lines added; no production edits.
- Shared-handler coverage is exactly unchanged: lines 189/200 (94.50%),
  statements 190/201 (94.52%), functions 29/29 (100%), branches 122/145 (84.13%).
  Existing uncovered lines/branches remain; this is focused coverage, not a
  whole-product guarantee. No thresholds or test exclusions changed.
- Deleted baseline callbacks total 8.512206 ms. Vitest JSON time from run start
  to last suite end: baseline 459.13 ms, candidate 509.22 ms. This single local
  comparison shows no wall-clock gain; do not extrapolate a CI speedup.
- CLI food-label and supplement-label regressions: 43/43 passed, zero skipped.
  Existing fake-HTTP query/effect checks pass; no live provider or database used.
- `pnpm --dir apps/web typecheck`: passed through the existing tsrs Web lane,
  including normal generated-input preparation. No generated tracked diffs.
- `pnpm complexity:diff`: passed; no authored production JS/TS to analyze.
- `git diff --check`: passed. Candidate self-review confirms only the ten mapped
  cases, unused test helper, comments, and this plan are changed.
- No changelog: internal verification maintenance only. No deployment action.
- PR CI and parent approval remain separate exact-head gates; do not merge.
Completed: 2026-10-21
