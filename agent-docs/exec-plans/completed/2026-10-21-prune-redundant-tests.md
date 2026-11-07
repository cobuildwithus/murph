# Audit and prune demonstrated redundant tests

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal

- Remove demonstrated redundant tests without changing product behavior, coverage
  thresholds, test selection, or unique regression protection. Publish one bounded
  first batch and distinguish maintenance savings from CI latency savings.

## Success criteria

- Inventory actual test files and a completed CI run, rather than assume every
  test is a unit test or that a large count implies low value.
- Explain every removed assertion category and its remaining proof or deliberate
  retirement. Preserve authorization, accounting, concurrency, cancellation,
  idempotency, parser, security, and data-loss regressions.
- Run the changed suite and retained executable owners; inspect exact-head CI.

## Scope

- In scope: public Murph at base `80d805f20023f36d391c97b230125abc267c8a81`;
  nine cases in `packages/cli/test/release-script-coverage-audit.test.ts`.
- Out of scope: production changes; shared workflows, manifests, test configs and
  thresholds; native Android work; native publisher and tsrs work; live data,
  live accounts, provider calls, or external review uploads.

## Constraints

- Isolated checkout created with `scripts/create-worktree`. Existing primary
  edits, active PRs, and worktrees were inspected and preserved.
- No runtime owner changes. Existing package/configuration owners remain
  authoritative. Parent owns merge and release; this task only publishes a PR.
- No additional required ReviewGPT under the low-risk-test exemption in the
  completion workflow. No outside review upload is authorized by this task.

## Risks and mitigations

1. Source assertions sometimes protect real architecture/security boundaries.
   Delete only reviewed incidental spelling/obsolete checks and documented
   duplicates; retain release-publication, private archive, cleanup, and other
   unique boundary tests in the same file.
2. A passing large suite may miss deterministic rare failures. Retain the
   expensive subprocess, idempotency, and interrupted-runtime regressions found
   in the timing sample. Do not claim E2E equivalence without evidence.
3. Fixture text inflates regular-expression test counts. Parse source syntax
   separately and label runtime counts as executions, not unique unit tests.

## Tasks

1. Verify host, guidance, checkout ownership, active PRs, and isolated base.
2. Count tracked test files and declarations; inspect completed CI job summaries.
3. Rank candidates by proven redundancy and measure the first candidate baseline.
4. Delete only the nine approved-by-analysis cases and their unused manifest reads.
5. Run retained proof, typecheck and complexity guard; review, commit, publish.

## Decisions

### Inventory and timing sample

- Base tree has 2,622 tracked JS/TS `.test`/`.spec` files. Babel AST traversal
  counted 31,909 `it`/`test` calls with function callbacks, with zero parse errors.
  This excludes fixture strings, but counts parameterized declarations once.
  An initial regex count of 32,172 was superseded because it included fixture
  text. Neither count classifies unit versus integration tests.
- Largest AST groups: Web 11,886; assistant-engine 4,714; Cloudflare 3,219;
  assistant-runtime 2,809. Source-level inventories and runtime expansions differ.
- [Host Support run 39536239554](https://github.com/cobuildwithus/murph/actions/runs/39536239554)
  at `a5685fd251d20b63cc41638b88af08b223031019` completed in 55m18s including
  queue/setup/dependencies. Its six package coverage jobs, four Web test shards,
  and Cloudflare verification reported 38,275 passed plus 1,778 skipped test
  executions (40,053 total). Separate PostgreSQL, fixture, repo-tool, native and
  host-matrix lanes are excluded from this subtotal; it is not a repository-wide
  count of unique unit tests. The sample predates this checkout's base.

| CI owner | Vitest wall time |
| --- | ---: |
| CLI | 638.60s |
| assistant-runtime | 580.48s |
| assistant-engine | 534.50s |
| Cloudflare main Node pool | 386.87s |
| Web shards 1 / 2 / 3 / 4 | 324.04 / 252.25 / 218.95 / 221.28s |
| device-syncd | 184.76s |
| core | 156.12s |
| query | 137.78s |
| vault-usecases | 128.96s |
| hosted-local-harness | 87.40s |

These wall times run concurrently and must not be added as PR latency. Import,
transform, coverage, and test-body costs differ; this change does not alter them.

### Ranked decisions

| Priority | Candidate / observed cost | Decision and actual risk |
| --- | --- | --- |
| 1 | Nine obsolete/duplicated CLI audit assertions; 6.10ms local test-body time | Remove the categories below. Maintenance value; no material CI speedup claimed. |
| 2 | Remaining CLI release audit; 72.99s in sampled CI | Keep. Most time is real release-tarball proof (53.57s) and audit packaging (12.97s), protecting published surfaces and private-file exclusion. |
| 3 | CLI timing subprocess; 190.29s | Keep. Real subprocess output parity, no unexpected provider effects, read-only filesystem preservation, and private telemetry redaction are unique composed checks. |
| 4 | Scripted Codex runtime; 174.77s | Keep pending case-level proof of duplication. Runtime/lifecycle failure checks cannot be replaced by a generic E2E pass. |
| 5 | Linq attachment idempotency; 101.23s | Keep. Duplicate side effects/data writes are a protected risk. |
| 6 | Interrupted system recording integration; 82.09s | Keep. Failure durability and recovery are intentional integration proof. |

### First deletion batch and coverage disposition

| Removed cases | What they actually checked | Remaining coverage / deliberate gap |
| --- | --- | --- |
| Root release-script manifest strings (1) | Copied the current package name and exact shell command spelling | Release workflow guard still checks build/assembly, complete publish matrix and publication order; executable release lanes run the real release-check script. Exact root alias spelling is intentionally no longer frozen. |
| Retired coordination-ledger path and Fable/Claude Code wording (2) | A removed Markdown path stays absent; selected docs never mention retired tool names | Obsolete migration memorials, not runtime behavior. No replacement needed; current workflow routing remains authoritative. |
| Storage-boundary prose (1) | Nine documents contain particular sentences | No state was read or mutated. Current invariant/owner docs and executable canonical/private-archive tests remain; prose wording and duplication are intentionally not test contracts. |
| Release-check source snippets (1) | Text contains current commands and their lexical order | `release-verification-lanes.test.ts` executes preflight/full branches; retained release workflow tests guard validation and publication boundaries. |
| Prepared acceptance source snippets (1) | Exact helper names, log strings, manifest commands and statement order | `workspace-verify.test.ts` executes prepared shared inputs, app typecheck flags, CLI readiness/failure, bounded fanout and release ordering; release lanes execute isolated Web shard/build paths. Incidental helper/log spelling is retired. |
| CLI bucket names/pattern spelling (1) | Current smoke project names and their declaration order | Existing `resolveVitestBucketFiles` discovers and partitions actual files and rejects unassigned files or an empty inventory. No config changes; coverage/selection stays intact. Exact historical names/order are not a product invariant. |
| Docs-drift source snippets (1) | Three implementation strings occur | `check-agent-docs-drift.test.ts` executes the version-only release exemption against exact commit fixtures, plus missing/stale-base failures. |
| CLI escalation source snippet (1) | Exact timing-label/function-call text occurs | `workspace-verify.test.ts` executes an explicit CLI requirement and the reverse-dependent artifact path; retained audit cases execute diff-scope classification. |

All nine cases passed before deletion. The retained same-file tests for unconfirmed
browser cleanup, policy overrides, model evidence, archive scope, source-vault
nonmutation, duplicate ingests, and publication remain. No broad E2E claim is
being used to substitute for a deterministic boundary.

## Verification

- Clean baseline: CLI audit, package-config Vitest, no coverage: 47 passed,
  one existing opt-in tarball case skipped, 29.51s file duration. The removed
  nine callbacks totaled 6.1048ms; 48 -> 39 discovered audit cases. Test file
  count stays unchanged. No demonstrated end-to-end CI speedup.
- Initial sandbox run failed Git-lock access and archive inventory assertions;
  unchanged rerun with required checkout metadata access passed. Neither failure
  was deleted or hidden; this was an execution-environment limitation.
- Retained executable owners: `scripts/workspace-verify.test.ts`,
  `scripts/release-verification-lanes.test.ts`,
  `scripts/check-agent-docs-drift.test.ts`, and
  `scripts/vitest-package.test.ts`: 68/68 passed.
- Candidate CLI audit and retained publication/cache guards: 52 passed, one
  existing opt-in skipped. The audit itself has 38 passed / one opt-in skipped;
  every retained title/status matches the baseline. File duration 29.45s versus
  baseline 29.51s is noise-level evidence, not a claimed wall-time saving.
- `pnpm --dir packages/cli typecheck`: passed using the existing tsrs owner.
- `pnpm complexity:diff`: passed. Only deletion in test code; no new functions
  or product complexity. Sandbox IPC restriction resolved by the unchanged
  command on the authorized worker execution path.
- Candidate review: exactly nine test callbacks and two now-unused manifest
  reads removed; 258 lines deleted; all other callbacks remain unchanged.
  Publication, sensitive archive, cancellation/cleanup and source-nonmutation
  regressions remain. No changelog: internal test maintenance only.
- Exact-head CI remains a PR gate after publication. This completed first-batch
  plan is not a claim that the PR is mergeable or that broad CI has passed.
- The real release-tarball test retains its existing opt-in and required CI
  owner. No skip, include/exclude list, threshold, package or workflow was changed.
Completed: 2026-10-21
