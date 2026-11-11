# Remove obsolete architecture and redundant tests

Status: completed
Created: 2026-11-11
Updated: 2026-11-11

## Goal

Revalidate the codebase audit against current main, correct demonstrated defects, remove unused implementations and duplicate state, and aggressively reduce redundant tests while preserving current product guarantees. The audit began at d519978569 and incorporated main through 978a415b771c before the final local checks.

## Success criteria

- Every audit item is fixed, already shipped, removed with obsolete behavior, or explicitly dispositioned with current evidence.
- Preserve editing and voting during live games.
- Remove categorical oxygen screening; retain numerical sample summaries.
- Remove mandatory percentage coverage gates; retain reporting and meaningful behavioral checks.
- Pursue at least 500,000 net test lines removed through justified deletions/consolidation; report actual reduction and any evidence-based shortfall. No formatting compression, moved-file counting, or deletion of unique critical guarantees.
- Focused tests, relevant typechecks, parent review, and required risk-routed review pass; report unavailable composed or external proof honestly.

## Scope and ownership

One shared isolated task checkout; each implementation agent owns non-overlapping files. Parent owns integration, shared build preparation, this plan, index, cross-cutting docs, changelog, review, and commits.

| Lane | Owned surface |
| --- | --- |
| Runtime | runtime-state and assistant-runtime |
| Engine | assistant-engine and gateway-core |
| Control | Cloudflare app and cloudflare-hosted-control |
| Vault | core, query and vault-usecases |
| Devices | device-syncd, clinical-records and corresponding Web domains |
| Messaging | inboxd, inbox-services, messaging-ingress, operator-config and Web messaging |
| Games | Web game domain and its tests |
| Web authority | auth, billing, consent, deletion, usage and orchestration |
| Frontend | React/dashboard clients and UI tests |
| Importers | health-metrics, importers, parsers and CLI |
| Tooling | scripts, root config, workflow wiring and Vitest configuration |

## Constraints

Preserve canonical ownership, consent/auth boundaries, financial identities, delivery ambiguity, crash recovery, and compatibility with independently deployed readers. Keep personal identifiers and private evidence out of artifacts. No production mutations or messages. Revalidate findings against latest code; do not undo recently shipped simplifications.

## Product UX

Outcome: the current product behaves consistently under retries, concurrent edits and transient failures with fewer implementation paths. Reaches: connect authorization, preferences, games, canonical food scheduling, direct email, clinical sync, account deletion and activation. The one intentional product reduction is optional categorical oxygen screening; numerical results remain.

Proof: focused actual-owner regressions, composed database cases where available, existing real-model journeys for affected assistant behavior, and rendered UI tests for request ownership. Pending external/browser/provider proof remains a Hold rather than inferred success.

## Risks and mitigations

- Mass test pruning can hide unique guarantees: record why suites are obsolete/duplicated and name retained behavioral proof.
- Shared edits/builds can race: non-overlapping file ownership, parent-owned builds, explicit requests for cross-owner changes.
- Compatibility deletion can invalidate retained state: remove unused producers first; preserve readers until drain evidence supports removal.
- Current main may advance: refresh before final integration and reconcile only verified task changes.

## Tasks

1. Revalidate findings and integrate current main: complete through 978a415b771c, with no merge conflicts.
2. Implement demonstrated fixes and remove proven-dead paths: complete for this checkpoint; residual investigations are dispositioned in the audit report.
3. Remove redundant tests with retained-proof mappings: 62,003 net lines removed; the 500,000-line target is not met.
4. Integrate owner docs/generated artifacts and run focused/composed local checks: complete.
5. Parent candidate review and scoped local commits: complete. Remote CI, required final ReviewGPT and external product/release proof remain pending; this is a local checkpoint, not a merge-ready delivery.

## Decisions

- Live game editing remains supported.
- Categorical oxygen classification is removed, numerical summaries retained.
- Percentage coverage floors may be removed; coverage reports remain useful diagnostics.
- Already-shipped removals include Browser Vault/Training, local OAuth heartbeat/export, draft-reset workflows and duplicate target routing. These must not be reintroduced.

## Local checkpoint outcome

The audit report is `agent-docs/references/codebase-simplicity-audit-2026-11-11.md`.
It records root causes, actual repairs, deleted architecture, retained test proof,
and unresolved investigations. Implementation commit: `d29e562f32b4`; current-main
reconciliation commit: `3ed37b4`. The original checkout and unrelated work were
preserved. All workers are finished; no additional searches are running.

Against integrated main `978a415b771cff9810d2e1b7d5fd2adce0126d24`, tests have
23,827 added and 85,830 deleted lines: **62,003 net removed**. The entire change
removes **approximately 68,400 net lines** across 451 files, including the audit and this plan.
The report defines the path-based test classification. Counts include replacement
fixtures and exclude already-shipped main changes. No formatting compression or
move-only deletion is counted. The requested 500,000-line target is **not met**.
Eight final read-only searches identified 19,937–23,543 possible further lines;
those are unimplemented estimates and excluded from achieved totals.

Source repairs and all twenty-two CLI cleanup assignments were reviewed by their
domain owners and the parent. One uniquely useful stale-workout-delete guard was
restored as an actual filesystem test. Integration review caught and fixed
sparse settings-save overwrites, connect authentication/member handoff, cleanup
contention, explicit sample dayKey pruning, historical metric anchors, binary
MIME delimiter lookalikes and retained Family activation pointers after removal.
The historical-anchor and MIME regressions were proved failing before repair;
assertions were not weakened to make the reductions pass.

No source dependency or database schema was added. Stripe retains a thin
execution host because existing attempts can exceed the cron duration; its
receipt owns retries/completion. Cleanup progress shrinks existing encrypted
lists. The four member-visible changelog items are `settings-refresh-recovery`,
`saved-food-edit-consistency`, `email-content-preservation` and
`oxygen-summary-readings`. Their source PR arrays are empty because no PR exists.

## Verification

Dependencies were installed with the frozen lockfile and lifecycle scripts
disabled; generated/runtime artifacts were prepared explicitly. Focused owner
checks and independent review reruns overlap and must not be summed as unique
repository-wide cases.

| Check | Result |
| --- | --- |
| `pnpm typecheck` after main reconciliation | Passed all 25 declared workspaces, contracts generation, tooling types, workspace boundaries/cycles and hosted privacy/provider guards. |
| `pnpm build:test-runtime:prepared` after reconciliation | Passed. |
| `pnpm complexity:diff --base 978a415b771cff9810d2e1b7d5fd2adce0126d24 --json` | Passed; source total complexity decreased by 1,029 with no increased gated debt. |
| Final package integration/artifact command below | 394 tests passed across 8 files. |
| Final Web integration command below | 225 tests passed across 4 files using migrated synthetic PostgreSQL. |
| Parent retained PostgreSQL check | 32 passed across mailbox engagement, usage-denial chronology, sequence allocation, physical-note rollback and Ops canary attribution. |
| Cleanup receipt simplification | 26 unit tests and actual PostgreSQL account-deletion proof passed, preserving lease fencing on both completion writes. |
| Stripe receipt and retained-pointer repair | 15 PostgreSQL cases plus 101 receipt/workflow cases passed; the retained-pointer regression failed before the fix. |
| Email normalization/parser | 206 passed, 3 skipped; package typecheck passed. |
| Metric-anchor correction | 80 query, 8 usecase and 31 metric cases passed; strict unanchored latest-lab selection remains. |
| Importer inference correction | Inlined the lookup without a cast; all 13 Oura cases and full typecheck passed. |
| Assistant behavior | Accepted-turn X-budget journey passed with real local Codex; scripted native workout CSV/cold-resume and native compaction journeys passed. |
| Changelog | Generation and all four archive-render cases passed. |
| Parent review | Reviewed retained proof, production ownership, main overlaps, privacy and complexity. Scoped diff checks passed. |

Final package command:

```sh
pnpm exec vitest run --config vitest.config.ts \
  packages/assistant-engine/test/recap-workspace.test.ts \
  packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts \
  packages/contracts/test/recap-show.test.ts \
  packages/device-syncd/test/service.test.ts \
  packages/importers/test/junction-day-diagnostic.test.ts \
  packages/cli/test/cli-runtime-artifacts.test.ts \
  packages/cli/test/incur-config-schema.test.ts \
  packages/cli/test/incur-skill-hash.test.ts --maxWorkers=1 --no-coverage
```

Final Web command, with `DATABASE_URL` set to the task's synthetic local database,
`MURPH_PRISMA_SKIP_ENV_FILES=1` and `MURPH_TEST_POSTGRES_CONCURRENCY=1`:

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts \
  apps/web/test/game-account-deletion-postgres.test.ts \
  apps/web/test/game-service-postgres.test.ts \
  apps/web/test/hosted-linq-group-line-move-producer-postgres.test.ts \
  apps/web/test/hosted-ops-linq-group-line-move-route.test.ts \
  --maxWorkers=1 --no-coverage
```

## Remaining completion boundaries

This plan closes the verified local checkpoint. The status request highlighted
usage cost; no additional workers or speculative reduction waves were launched.
Remote CI and required final ReviewGPT have not run, and no PR has been created.
No push, merge to main or deployment occurred. Full Docker smoke and interactive
browser/provider proof also remain unrun; rendered component tests are not a
substitute for them. Product/release readiness remains **Hold**.

Before any release, keep old originating deployments until pinned Stripe
workflows drain. Historical completed receipts can still owe activation wakes;
do not reset them globally as a replacement for drain proof. Remaining clinical
retention, replay lookup, duplicate game representations, payment recovery and
standby retirement require the specific evidence described in the audit report.
Completed: 2026-11-11
