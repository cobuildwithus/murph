# Finish deterministic member work with AI denied

Status: completed
Created: 2026-11-06
Updated: 2026-11-06
Completed: 2026-11-06

## Outcome and scope

Member actions, preferences and permitted clinical acquisition can finish when
assistant execution is blocked. AI-allowed invocations retain default ownership
and conversation-prefetch ordering. Enrichment and photo estimation stay pending.
The follow-up brief explicitly requested updating this completed plan.

Parent review removed this task's Web clinical and consent source/tests because
the parallel access task owns them. Those removals are preserved. Product access,
consent authority, billing, funding and admission integration remain with that
owner. Work is uncommitted; parent owns integration review, commit, PR, ReviewGPT,
CI and deployment. No production access or deployment occurred here.

## Completed work and product proof

- One shared policy determines model-free kinds. The classifier defaults to
  AI-allowed ownership; only a confirmed blocked flag admits the three additional
  kinds. Runner route actions derive from the existing kind-to-route mapping.
- Invocation selection, recovery, wake projection, import checkpoints, receipt
  checkpoints and restored progress all receive the same flag. No wire field,
  schema, mode, dependency, grant, model input or funding owner was added.
- AI-allowed pending meal deletion now reaches conversation prefetch before
  canonical mutation. The composed test supplies an unimported conversation and
  deliberately stops at that fetch boundary, then reads back the unchanged meal.
  Before the fix it failed because no conversation prefetch occurred.
- AI-denied proof uses real canonical meal/workout/preferences writes, clinical
  import and snapshots, eight cold invocations over 35 minutes, and a lost receipt
  response variant. Both finish without model preparation, assistant passes,
  delegated reads or usage records. Enrichment remains pending; its sequence-less
  item conservatively pins handled progress at zero. Imported sequence four and
  a current empty model-free projection prevent immediate independent relaunch.
- Alert tests reproduce the three false alerts before the fix. Imported rows
  aged an hour remain exempt under usage denial, including another 30 minutes
  later; the same rows alert when allowance returns. Existing device/exact-notice,
  missing-import and unavailable-allowance protections still pass.
- Reconciliation proves fresh work stays default-owned while AI is allowed and
  becomes independent only after denial. Repeated old-runner projection reads
  over 40 minutes return no independent frontier and retain the future allowance
  retry, rather than asking for immediate relaunch.
- Product UX: Ready at these local canonical/checkpoint boundaries. Actual lapsed
  access still requires the parallel predicate/admission integration. The existing
  changelog item `2026-11-06/app-edits-without-ai-usage` remains valid; parent must
  supply its eventual source PR number before shipping.

## Caller verdicts

| Caller | Decision and reason |
| --- | --- |
| `hosted-mailbox/store.ts`, model-free-only query | Accept an optional blocked flag, default false. This storage helper cannot know allowance; it derives the SQL kind filter from the caller's explicit policy and preserves notification-prefix restrictions. |
| `runtime-reconciliation-facts.ts`, ownership wrapper/frontier | Default false on the initial read. Recompute with true only inside the existing canonical AI-denied branch, using the same handled/imported/projection evidence. Unavailable or unneeded gate reads do not imply denial. |
| `alert-monitor.ts`, imported default-owned head | Deliberately omit the flag. This is historical ownership for the existing usage-exhaustion exemption, not execution admission. Clinical enrichment and old-runner pending rows can pin progress after deterministic work is dormant. |
| `system-mailbox-state.ts`, model-free item classifier | Accept and forward the invocation flag through state filtering, default-owned selection, wake reason and progress projection. Keep exact-notification payload validation. Standalone callers default false. |
| `hosted-runtime.ts`, system-work recovery (formerly 3025) | Derive allowed actions from the invocation flag. AI-allowed recovery retains the original six route actions; blocked recovery adds clinical acquisition. |
| `hosted-runtime.ts`, system-work kick (formerly 4235) | Use the same derived allowed actions, so AI-allowed clinical work cannot jump the existing default-owner prefetch boundary. |
| `hosted-runtime.ts`, lifecycle item filters (formerly 4270–4271) | Derive both allowed actions and kinds from that flag. A route alias never broadens kind admission or bypasses notification policy. |
| Import, receipt, workspace-system-work and restored-status helpers | Carry the flag from the invocation through their existing inputs. Their standalone/foreground callers default false; no helper invents an allowance decision. Foreground-only idle/assistant projections retain default ownership. |

Allowed route membership is asserted against the original six routes. Ordered
mailbox selection does not depend on their array order. Fresh AI-allowed reads
retain the existing gate/read path. A denied reconciliation adds at most two
bounded, serial mailbox `findFirst` queries, no transaction, collection fanout,
provider call or new secret. Both reads reuse the same canonical frontiers.

## Action audit

| Action | Verdict and existing owner |
| --- | --- |
| `display-name.set` | Model-free canonical `setMemoryDisplayName`; assignment is replay-safe. |
| `demographics.set` | Model-free `setMemoryDemographics`; preserves action-id/timestamp replay marker and conflict rejection. |
| `meal.names.repair` | Retired compatibility request; drains unchanged without model, meal mutation or usage. |
| `meal.delete` | Model-free `deleteMealRecord`, canonical tombstone and existing typed rejection. A restored recording item replays its saved applied receipt, not the deletion. |
| `workout.live.apply` | Model-free canonical binding validation, mutation lock and last-action marker. `exercise.append`, `exercise.rename`, `set.put`, `set.append`, `set.remove`, and weight preference persistence are deterministic. |
| `workout.live.snapshot` | Model-free authenticated canonical lookup and card construction. |

Preferences retain causal sequence ownership. Clinical acquisition retains the
current-run checks, page/attachment bounds, raw manifest and structured importer;
it may enqueue enrichment but never starts it in the AI-blocked mode. Existing
photo-import proof retains raw capture and keeps immediate manual estimation
outside the model-free selection. Notification dedupe/payload restrictions stay
unchanged. No new execution mode or persistent state.

## Deployment and skew

New Web / old runner: fresh deterministic work can be admitted, but the old runner
can leave it pending. A version-current empty model-free projection is
authoritative for imported rows; repeated reads preserve dormancy and usage-denial
alert exemption. A checkpoint without a current projection still uses the existing
legacy handled-prefix fallback. Full suppression for that older shape cannot be
claimed before a compatible runner publishes current evidence.

Old Web / new runner: Web may withhold the wake until another eligible invocation
imports it. The runner honors the existing blocked flag and can finish without
AI. AI-allowed invocations preserve main's selection, default wake reasons and
conversation-prefetch ordering. Warm old containers have the same skew limits.
Previously stranded imported rows may need an eligible invocation to republish
wake/completion state; this task performs no live recovery.

Runner-first avoids runner-side delay when release coordination permits. The
normal merge deploys Web first; the compatible runner then ships from main through
manual murph-cloud dispatch. Full availability requires both. Rollback may delay
work but grants no AI permission. Verify fresh and restored edits and their
handled/wake projections after rollout. The private Temporal contract consumes
existing frontier/wake facts; its worker was not inspected or replayed here.

## Follow-up verification command history

Every validation invocation below records its actual process exit code. Repeated
codes are chronological. Output was kept in local scratch and read with personal
paths redacted; no private data is included here. The first three ordering runs
failed on incomplete test harness setup; the fourth reproduced the actual missing
prefetch. These fixture failures are not counted as regression proof.

| Command | Exit | Result |
| --- | --- | --- |
| `scripts/frog list` | 0 | Read current friction entries; no new repository issue required logging. |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-model-free-actions.test.ts -t 'AI-allowed meal deletion'` | 1, 1, 1, 1 | Missing importer, snapshot callback, checkpoint request array corrected; final pre-fix run fails because prefetch observations are empty. |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-runtime-progress-alert-monitor.test.ts` | 1, 0 | Three reproduced false alerts, then 56 passed after the fix. |
| `pnpm --dir packages/hosted-execution build` | 0 | Rebuilt shared public entrypoint. |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-model-free-actions.test.ts` | 0 | Ordering and both zero-model/zero-usage replay variants passed. |
| `pnpm --dir packages/assistant-runtime typecheck` | 0, 0, 0 | Initial flag plumbing, completed source/proofs, final added assertions all passed. |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-model-free-actions.test.ts test/hosted-runtime-mailbox-state.test.ts test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts test/hosted-runtime-mailbox-checkpoint.test.ts test/hosted-runtime-workspace-system-work.test.ts test/hosted-runtime-mailbox-routing.test.ts` | 0 | 159 passed in five actual files. The workspace-system-work filename has no matching file; its behavior is exercised by the composed system-mailbox/clinical entrypoints. |
| `pnpm --dir packages/hosted-execution test` | 0 | 932 passed, 8 skipped, 68 passing files and one skipped file. |
| `pnpm --dir packages/hosted-execution typecheck` | 0 | Passed. |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-orchestration-reconciliation-facts.test.ts apps/web/test/hosted-orchestration-reconciliation-facts-timing.test.ts apps/web/test/runtime-reconciliation-facts-model-free-notification.test.ts apps/web/test/hosted-runtime-progress-alert-monitor.test.ts` | 0, 0 | 209 passed each time; final run follows the reconciliation input refactor. |
| `pnpm --dir apps/web typecheck:prepared` | 0, 0 | Passed, including changelog generation. |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-runner.test.ts test/system-mailbox-state-model-free-notification.test.ts test/hosted-runtime-system-mailbox-notification.test.ts test/hosted-runtime-workspace-entrypoint-clinical-checkpoint.test.ts test/hosted-runtime-cold-ingest-system-mailbox.test.ts` | 0 | 385 passed across import/receipt/notification/clinical boundaries. |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-orchestration-reconciliation-facts.test.ts` | 0 | 66 passed with repeated future-retry assertion. |
| `pnpm complexity:diff` | 1, 0 | Duplicate handled-sequence fallback added one branch to an existing hotspot; reused the frontier input. Final 11-source-file diff has no added complexity debt. |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-model-free-actions.test.ts test/hosted-runtime-mailbox-routing.test.ts` | 0 | 9 passed; current empty projection and exact default-route membership asserted. |
| `pnpm --silent docs:drift` | 0 | Passed after protocol and completed-plan updates. |
| `pnpm --silent docs:gardening` | 0 | Zero issues. |
| `git diff --check` | 0 (all runs) | Passed, including final documentation. |
| Python added-content privacy scan over `git diff --unified=0` and untracked authored files | 0 | All 25 changed files checked; no direct local account or home-path identifiers. |

## Review and limits

Final diff, documentation readback and privacy review are complete.
The source review preserves parent removals and the original default route set,
notification restrictions, canonical writes and conservative handled frontier.
The extra internal optional fields only carry existing invocation authority; they
do not change wire contracts. No live model journey is appropriate for this
zero-model boundary. No fresh prompt/provider input is introduced.

No production/provider execution, real old binary, private Temporal replay,
live multi-service rollout, PostgreSQL concurrency suite, or complete runtime
umbrella rerun is claimed. The follow-up ran affected runtime suites. Skew proof
uses the public wire facts and synthetic old-runner projection; parent integration
review must cover private orchestration and parallel lapsed-access changes.

## Original implementation verification history (superseded scope)

These commands ran before parent review and the conditional-ownership correction.
They are historical results, not evidence that removed Web clinical/consent code
is still in this diff. All commands ran locally. Exit codes below are process exit codes, not a pipeline's
last command. Failed iterations are retained as evidence, with their resolution.
No production credential, provider call, live model run or deployment was used.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --prefer-offline` | 0 | Hydrated. |
| `pnpm build:workspace:incremental` | 0 | Workspace built. |
| `pnpm --dir packages/health-commons generate` | 0 | Generated. |
| `pnpm --dir apps/web prisma:generate` | 0 | Generated. |
| `pnpm --dir packages/hosted-execution build` | 0 | Rebuilt shared classification. |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'keeps device-sync wake identity on execution failure'` | 1, 1, 0 | Red before edit; then fixture lacked outcome callback; corrected callback makes all three cases pass. |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-model-free-actions.test.ts` | 1, 1, 0, 0, 0, 0 | Fixture first assumed one bounded pass drains all actions, then assumed local enrichment could advance Web frontier. Corrected to bounded cold invocations and preserved frontier rule. Last runs include both lost-response/replay variants, 2 passed. |
| `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-mailbox-state.test.ts` | 0 | 49 passed after replacing a no-longer-default preference fixture with existing default-owned manual control. |
| `pnpm --dir packages/assistant-runtime test` | 1 | 4,323 passed, 7 skipped, one stale preference-as-default fixture failed. Corrected fixture; its entire 49-test file passed on rerun (above). No unresolved failures; full suite was not repeated after this test-only correction. |
| `pnpm --dir packages/hosted-execution test` | 0 | 932 passed, 8 skipped. |
| `pnpm --dir packages/hosted-execution typecheck` | 0 | Passed. |
| `pnpm --dir packages/assistant-runtime typecheck` | 0, 0 | Initial and final added-proof types passed. |
| `pnpm --dir apps/cloudflare test` | 0 | Includes typecheck; 4,741 workspace tests and 20 helper tests passed, 5 skipped. |
| `pnpm --dir apps/web typecheck:prepared` | 0, 0 | Initial and final added-proof types passed, after explicit generation above. |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/clinical-records-retrieval.test.ts apps/web/test/clinical-records-daily-sync.test.ts apps/web/test/legal-consent-routes.test.ts` | 0 | 99 passed. |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/clinical-records-retrieval.test.ts apps/web/test/clinical-records-daily-sync.test.ts apps/web/test/clinical-records-documents.test.ts apps/web/test/clinical-records-runtime-routes.test.ts apps/web/test/legal-consent-routes.test.ts apps/web/test/hosted-health-data-consent-withdrawal.test.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-orchestration-reconciliation-facts.test.ts apps/web/test/hosted-orchestration-reconciliation-facts-timing.test.ts apps/web/test/runtime-reconciliation-facts-model-free-notification.test.ts apps/web/test/hosted-runtime-progress-alert-monitor.test.ts` | 1, 0 | Seven old classification expectations corrected; 343 passed across 11 files. |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/clinical-records-retrieval.test.ts apps/web/test/clinical-records-daily-sync.test.ts apps/web/test/legal-consent-routes.test.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-orchestration-reconciliation-facts.test.ts` | 0 | Added explicit denied-AI and deployment-skew assertions; 238 passed. |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/clinical-records-daily-sync.test.ts` | 0 | Added locked suspension case; passed. |
| `pnpm --dir apps/web changelog:generate` | 0 | Entry validated. |
| `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx` | 0 | 4 passed through production rendering. |
| `pnpm complexity:diff` | 0 | Six changed source files, no increase in complexity debt; existing hotspots reviewed. |
| `pnpm --silent docs:drift` | 0, 0 | Passed. |
| `pnpm --silent docs:gardening` | 0, 0 | Zero issues. |
| `git diff --check` | 0 | Passed. |

## Deep review outcomes

- Round 1 found two defects from reclassifying these kinds for everyone: an action could overtake an unimported conversation, and deliberately dormant work raised false stall alerts. Accepted. The kinds are now model-free only when assistant execution is blocked, so AI-allowed behavior is unchanged.
- Round 2 found that an action imported under AI allowed can wait if AI is denied before it runs, because the checkpoint's empty model-free projection was computed under the allowed policy. Accepted as a known limit, not fixed. It delays work and loses nothing, and the next eligible invocation executes it: a device wake, maintenance, or AI returning. Distinguishing the policy needs a new protocol field across Web and the runner, which costs more than this window justifies.
