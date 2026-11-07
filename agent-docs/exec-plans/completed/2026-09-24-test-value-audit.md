# Audit and simplify redundant tests

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Goal

Reduce test maintenance cost by removing demonstrated duplicate, narrative-only,
and vacuous assertions while retaining independent behavioral contracts.

## Scope and constraints

- Broad read-only discovery across Murph with ten parallel agents; targeted edits
  only where the linked OpenClaw test-audit evidence bar is met.
- Baseline: `9d0c7350ec`. Isolated branch: `test/value-audit`.
- Preserve unrelated primary-checkout work and all unique security, storage,
  protocol, public API, architecture, and regression proof.
- This is a broad pattern audit with focused review, not a declaration-by-declaration
  certification of every test. OpenClaw-specific commands are replaced by Murph's
  verification and completion owners.
- No source/test edits while Vitest runs. Parent coordinates baseline, edit,
  validation, and independent preservation-review phases.
- No production behavior changes, new dependencies, deployment, or remote publication.

## Tasks

1. Collect candidate evidence from engine, runtime/daemon, Web runtime, Web UI,
   Cloudflare/execution, data/query, ingestion, CLI, tooling, and pattern lanes.
2. Run focused baseline candidates and keepers; distinguish existing failures.
3. Apply supported consolidations and remove unlocked private production seams.
4. Review deleted assertions against keepers independently; restore unique proof.
5. Run focused tests, relevant typechecks, executable guards, diff and privacy checks.
6. Record findings, line counts, validation limits, and close with a scoped commit.

## Decisions

- Optimize for trustworthy coverage, never a deletion quota.
- Internal-only cleanup needs no member-facing changelog entry.
- Detailed candidate reports live in ignored task scratch until consolidated into
  this plan's final evidence; reports contain repository-relative paths only.

## Verification

Pending baseline and final focused commands. Required package, Web, Cloudflare,
and tooling owners will be selected from the accepted candidate paths.

## Audit results

Ten discovery agents divided engine, runtime/daemon, Web runtime, other Web,
Cloudflare/execution, data/query, ingestion, CLI/harness, tooling, and cross-cutting
patterns. The AST sweep parsed 2,335 package/app test files and recognized 28,924
named callbacks, identifying 22 exact-body duplicate groups. Lane reviewers read
selected tests, production owners, callers, history, and CI routing; this is not
an exhaustive manual review of every declaration.

Final code diff before plan closure: 36 test files (+73/-2,283), six production
files (+6/-52), one audit-scope document (+1/-1). Net reduction: 2,210 test lines
and 46 production lines. No dependencies or production behavior added.

| Cleanup | Remaining primary proof |
| --- | --- |
| Repeated mocked runtime/cron lock formatting | One formatter suite plus real directory-lock contention/metadata tests |
| Codex diagnostic duplicate with an untouched-vault assertion | Adjacent privacy diagnostic cases; actual resume/finalizer flows retain persistence ownership |
| Test-local meal policy implementation | Production query goal write/read/status cases and real response-card schemas/rendering |
| Unreachable assistantd root barrel and identity test | Actual public client subpath, daemon config/HTTP/service/bin suites, CLI package contract |
| Assistant registration import-only duplicate | Import plus actual registration under throwing UI mocks, with positive control |
| Linq typing and foreground admission exact duplicates | Identical retained cases and actual future-wake mailbox scenarios |
| Three repeated CLI date-filter journeys | Existing list, intake, and search command-owner cases using the same CLI execution helper |
| Scheduled-log and unsupported local Linq duplicates | Identical retained validation/privacy/no-write and fail-closed cases |
| Empty retired wake-proof and mislabeled environment case | Real harness URL behavior and environment clone/isolation case |
| Three mocked-lock canonical mutation replays plus export duplicate | Stronger unmocked real-vault core scenarios with persisted files and audit assertions |
| Sixteen duplicate/weaker importer cases | Canonical importer suite; real vault setup replaces mocked loadVault for blank-row proof |
| Dead inbox/device helpers and private re-export identities | No production callers for deleted helpers; retain normalization/security behavior and public type checks |
| Query metadata forwarding wrapper and identities | Canonical contracts metadata getter, projection tests, and real registry list/read/show flows |
| Mock-only iMessage contact transport file | Real localhost HTTP success table for assigned/existing, request binding/signature, malformed response |
| Duplicate Docker, email handoff, absent-state deletion, and secret decoding cases | Stronger same-owner security/HTTP/SQLite keepers and all negative controls |
| Stripe private-helper replay suite | Production-used billing resolver table and trial-expiry/resumption policy tests |
| Repeated biomarker source assembly and checkout redirect | Actual rendering, canonical provider ownership inventory, identical redirect keeper |
| Product/deployment/operator/skill/README prose freezes | Executable billing/parser/CI/controller/entrypoint contracts; ordinary documentation review |
| Copied execution-plan body | Actual subprocess creation and title/status/date metadata consumed by plan lifecycle |

Unique assertions were carried into existing owners before retiring their old
homes: the biomarker layout provider guard, first-subscription billing state,
and existing-contact response/signature checks. No thresholds were lowered.

## Preservation review

Independent reviewers compared engine, runtime/data, ingestion, Web,
Cloudflare/patterns, and CLI deletions against retained keepers. Reviews found
no unique behavior requiring restoration. Parent reviewed all production edits
and changed assertion shapes. The real HTTP test checks a nonempty signature;
it does not claim cryptographic verification that neither prior test supplied.

## Retained tests and follow-ups

- Keep independent public API/package, security/privacy, protocol, migration,
  storage, prompt, platform, and cross-language contracts, including useful
  source inspection and small negative-path tests.
- Keep eight distinct importer factory/port/preset/assessment cases; the real
  suite does not subsume them all.
- Defer outbound channel mocked-layer retirement until hosted identity/failure
  cases have a demonstrated composed owner.
- Keep clinical intent expiry/member/provider/bearer/uniqueness guards: inspected
  PostgreSQL account-deletion tests prove different concurrency contracts.
- Keep physical-note cancellation/deadline/replay and personalization authority
  queries, plus narrow-reader all-family/error cases absent from broader flows.
- No remote publication, PR, CI, merge, deployment, or live provider run performed.

## Verification status

- Baseline tooling: 23 Vitest tests and 60 Node tests passed before edits.
- Baseline package/Web/Cloudflare attempts were interrupted with SIGTERM under
  severe host overload after prolonged lack of progress; these are not passes.
  Only exact task-owned process trees were signaled.
- Focused final Vitest and workspace typecheck were attempted with one test
  worker. The checks were stopped after CPU starvation was confirmed; none is a passing result.
- Final directly changed Node tooling suites: 33 tests passed using
  `node --test scripts/check-frontend-design-proof.test.mjs scripts/pull-request-ci-policy.test.mjs`.
- The broader final Node command also included
  `scripts/native-ios-hosted-e2e.test.mjs scripts/native-android-hosted-e2e.test.mjs`:
  54/57 passed; three unmodified iOS bounded-command probes failed (PID receipt
  missing before timeout, overflow timing out, and success timing out). All three
  passed in the 60-test baseline; no implementation or assertions there changed.
- `pnpm typecheck` passed shell syntax, Node syntax, and dependency policy, then
  was CPU-starved during workspace-boundary preflight. The narrower
  `pnpm --dir packages/query typecheck` reached the native checker but could not
  complete in the overloaded environment. No typecheck success claimed.
- Final Vitest attempts used `pnpm exec vitest run --no-coverage --maxWorkers 1`
  with `vitest.config.ts`, `apps/web/vitest.workspace.ts`,
  `apps/cloudflare/vitest.node.workspace.ts`, and `scripts/vitest.config.ts`,
  each with candidate/keeper filename filters. They made insufficient progress
  under saturation and were stopped; remaining runtime proof is blocked.
- Read-only process diagnosis found two runnable verification leaves receiving
  less than ten CPU seconds during roughly ten elapsed minutes. Only exact
  task-owned process trees were stopped. This is machine contention, not a
  reason to delete or weaken retained tests or timeouts.
- `pnpm complexity:diff` passed: six source files, no hotspots above 20, no
  increased complexity debt. `git diff --check` and added-content privacy scan
  passed; approved local Git identities were privately verified.
- Next-best validation: full source diff/removed-caller review, six independent
  preservation comparisons, syntax/dependency guards, passing executable Node
  tooling, and explicit keeper mappings above. Rerun the focused Vitest suites
  and workspace typecheck after host load clears before treating this as fully
  validated. The isolated branch is suitable for review, not represented as
  CI-green or merge-ready.

## Delivery

Internal maintenance only; no member-facing changelog entry. The cleanup and
preservation review are complete locally. Verification limits above remain an
explicit handoff blocker; no remote push, PR, merge, or deployment is implied.
Completed: 2026-09-24
