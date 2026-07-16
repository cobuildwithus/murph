Goal (incl. success criteria):
- Restore hosted iMessage/Linq replies end to end.
- Success: inbound iMessage/Linq messages are durably read into hosted mailbox/import state, trigger assistant handling after cold container start, continue replying across multiple back-to-back messages, and still reply after a 30-second quiet gap.

Constraints/Assumptions:
- Treat this as a high-risk hosted runtime/external-ingress incident.
- Do not expose real contact identifiers, secrets, local account names, home paths, raw message text, or provider payloads in repo artifacts or handoff.
- Preserve unrelated dirty worktree edits and active hosted runner/runtime rows.
- Use `cf:deploy:immediate` during debugging as requested if the local state and branch policy allow it.

Key decisions:
- Start from the production evidence path: supplied exported logs, hosted-web mailbox/workflow data, Cloudflare runner observability, and Vercel logs.
- Prefer the smallest durable fix that preserves the exact-event mailbox plus staged assistant-input protocol.

State:
- Active.

Done:
- Loaded repo workflow, security, reliability, verification, hosted runtime, and Cloudflare deploy docs.
- Committed and pushed the pre-existing worktree checkpoint, then started an immediate Cloudflare deploy.
- Confirmed production mailbox high-water had advanced while the checkpointed imported sequence stayed behind for one active hosted user.
- Identified the root cause: budget-exhausted mailbox import with deferred progress scheduled a fast retry before an idle-shutdown checkpoint, so cold containers could reread the same mailbox prefix.
- Patched Cloudflare runner alarm scheduling to drain the deferred idle-shutdown checkpoint before short non-idle retry/receipt wakes, and added a targeted runner alarm regression test.
- Confirmed the first patched Worker deployed successfully and the runner began scheduling the checkpoint drain, then found a second alarm-ordering issue: if Cloudflare delivered the checkpoint alarm after the retry wake was also due, the normal drain consumed the alarm first and postponed the checkpoint again.
- Patched the Durable Object alarm consumer so an earlier due idle-shutdown checkpoint still runs before a later retry wake even when both are overdue, and tightened the regression to simulate late alarm delivery.
- Found a third live alarm race: when the due checkpoint alarm collided with an already-active invocation, recovery scheduling cleared the checkpoint and browser-vault refresh could keep preempting the durable mailbox watermark.
- Patched active-invocation recovery to preserve and defer the idle-shutdown checkpoint ahead of recovery wakes, and added a regression covering the collision plus stale-lease recovery.
- Confirmed the live reply engine is currently reaching the assistant provider but failing with `ASSISTANT_CODEX_USAGE_LIMIT`; this is separate from the mailbox/read durability fix and points at the configured OpenAI provider quota/billing boundary.
- Found a fourth live alarm risk: optional browser-vault refresh continuation could replace an earlier runner-owned checkpoint alarm when Durable Object `getAlarm()` reported no current alarm.
- Patched browser-vault refresh scheduling to read runner state and yield to earlier or due runner alarms, with a focused regression covering a due idle-shutdown checkpoint plus empty `getAlarm()`.
- After the deploy, confirmed the lagged runner still replayed from the old checkpoint and found a fifth alarm-ordering bug: a deferred idle checkpoint that was already due could lose to an already-due retry wake, and that non-idle wake cleared the checkpoint before it could commit.
- Found the Linq reply delivery failure was also being made terminal: idempotent Linq POST sends were marked non-retryable on transient 5xx/transport failures, so one provider/effect 502 could permanently fail the outbox reply.
- After the next deploy, confirmed the new Worker was live but the lagged runner still replayed 444->494/494->544 because a newly scheduled deferred checkpoint used a one-second delay while the workspace retry wake was already due; that retry wake then cleared the checkpoint before it could run.
- Patched deferred checkpoint scheduling to keep the normal fast drain, but move the checkpoint to at-or-before the retry wake when that wake is earlier/already due, and added a regression for the scheduling-time collision.
- After the deploy, confirmed the checkpoint alarm started but was preempted by foreground nudge handling while the deferred mailbox checkpoint was still in flight; the nudge also made the idle checkpoint lease look invalid, so the durable imported sequence stayed at 444.
- Patched foreground-nudge preemption and lease ownership so deferred idle-shutdown checkpoints can finish and then drain the queued nudge, with regressions for active same-isolate and persisted active checkpoint cases.
- After the deploy, confirmed mailbox import reached seq 546 in-memory but the durable imported watermark still stayed at 444 because optional browser-vault refresh alarms could fire before a pending deferred idle checkpoint and consume the alarm slot.
- Patched optional browser-vault refresh scheduling/alarm handling so stale or early optional alarms yield to pending deferred idle-shutdown checkpoints, with a regression for pending refresh plus future idle checkpoint.
- After the deploy, confirmed the idle-shutdown checkpoint now starts but does not commit: live logs show snapshot-size and Codex-home diagnostics without `checkpoint.snapshot_finished`, while the snapshot contains roughly 13k external artifacts.
- Patched idle-shutdown checkpointing to write a working delta against the existing base snapshot instead of full-compacting the whole artifact corpus on every drain, and added bridge regressions for base, working, and layered snapshot refs.
- After the next live retry, confirmed the fixed runner took the new `working_delta` path but still timed out after snapshot-size logging because the first delta migration had to persist a large external artifact batch.
- Patched full and working-delta checkpoint bundle writes to dedupe artifact puts by hash and persist them with bounded concurrency, with a regression covering many raw artifacts.
- After the deploy, confirmed the latest Worker was live and mailbox imports reached the current conversation high-water in runtime logs, but the raw checkpointed workspace watermark still lagged because old pointer workflows could each issue their one runner nudge and keep colliding with the pending idle checkpoint.
- Patched webhook pointer workflows so only the latest mailbox item in a lane can issue a runner nudge; older pointer workflows still wait for checkpointed progress but no longer amplify a backlog into repeated foreground nudges.
- After the web deploy, confirmed idle-shutdown checkpoints now commit but the web-visible mailbox watermark still stayed stale because idle-shutdown checkpoint requests reused the previous workspace redacted status instead of the restored local mailbox state.
- Patched idle-shutdown checkpoints to overlay restored local mailbox watermarks onto the checkpoint redacted status, and pinned the behavior with an entrypoint regression.
- Repaired the stale Cloudflare Linq outbound test expectation for the current 15s foreground send timeout introduced earlier in this incident.
- Checked production database state after the user-reported cold-start/stale-reply symptom. The active high-volume hosted mailbox row is now caught up to its conversation high-water, but recent runtime logs show the previous stale-prefix replay pattern followed by a pass that considered multiple queued conversation inputs and replied to one older pending input.
- Found a regression in the latest runner priority change: foreground nudges could preempt active or persisted deferred checkpoint invocations even when `deferred_checkpoint_required` was set, reopening the same durability hole that lets a cold container restore an older mailbox/import watermark.
- Restored the deferred-checkpoint preemption guard and regression coverage so foreground nudges queue behind required checkpoint work instead of destroying it.
- Landed and deployed the hosted runner hard cut, then used repeated Pro review loops to check for bug risks and simplification targets.
- Live iMessage probing exposed a stale recovery drain bug where an expired persisted invocation could consume pending work without forcing the replacement drain; fixed and deployed the recovery path with a focused runner-alarm regression.
- A follow-up live warm iMessage probe exposed a same-isolate recovery race: alarm/nudge recovery could clear a still-running local invocation before the foreground runner reached Linq/outbound delivery.
- Patched local active-invocation recovery so alarms only sync a recovery wake while the live invocation owns its timeout/failure path, removed the stale live-abort branch, and preserved persisted-orphan replay coverage.
- Added focused regressions for live invocation timeout ownership, active idle-checkpoint preservation, and persisted cold-restore replay; full Cloudflare verification passed.
- After the live warm probe still failed to reply quickly, found the next blocker: retry exhaustion state could survive the fresh external nudge that was supposed to restart runner work, especially when the nudge waited behind another active invocation.
- Patched fresh nudge handling to reset exhausted retry/error state atomically when marking pending work, and added regressions for idle exhausted retry restart plus persisted-active pending nudge drain after ownership clears.
- Focused runner alarm verification passed. Full Cloudflare verification reached typecheck and hosted-local E2E, but repeated attempts hit unrelated socket-reset/timeouts in `container-entrypoint.test.ts`; the individually failing container-entrypoint cases passed in isolation.
- Deployed the fresh-nudge retry reset, then live probing exposed the next blocker: runtime liveness reached the hosted heartbeat path but failed closed as `malformed_request` before any Linq typing/outbound delivery.
- Reviewed the redacted live evidence with Pro and an inspection subagent. The smallest fix is to treat the heartbeat JSON body as diagnostic/transport payload and the active lease headers or trusted proxy context as equivalent lease proof, while still rejecting disagreement between proofs.
- Patched runner-control heartbeat handling to resolve lease proof from body, headers, or proxy context, keep stale-proof mismatch checks, and log only safe metadata when no proof exists.
- Added regressions for header-only heartbeats, proxy-context heartbeats, body/header mismatch rejection, local internal proxy no-body heartbeat liveness, and local runtime heartbeat body preservation.
- Focused heartbeat/local-proxy verification and Cloudflare typecheck passed; full Cloudflare verification still reproduces an unrelated `container-entrypoint.test.ts` timeout flake.
- Deployed the heartbeat fix, then live warm probing exposed the next blocker: the workspace invocation was prepared, the RunnerContainer lifecycle reported a clean stop a few seconds later, and the UserRunner remained active without liveness, outbound, completion, or failure logs.
- Patched workspace invocation fetches so container lifecycle stop aborts active work and the Durable Object invocation races the request against the abort signal instead of waiting forever on a dead shell.
- Added a RunnerContainer regression where a never-resolving workspace request is stopped by `onStop()` and must fail/clean up rather than leaving the invocation active.
- Deployed the same-isolate lifecycle-stop fix; the live warm probe still missed the latency target and logs showed terminal container status without enough same-isolate lifecycle locality to wake the request reliably.
- Extended the fix with a workspace-request status watcher so stopped or missing child shells abort the active invocation even when the lifecycle hook cannot see the in-memory request controller.
- Added stopped-status and missing-container regressions for hanging workspace requests; full Cloudflare verification passed with 944 tests.
- After deploying the status watcher, live iMessage probing still missed the latency target: a fresh inbound was read quickly but replied minutes later, with logs showing pending work preserved through idle-checkpoint/recovery paths.
- Patched idle-checkpoint pending-work handoff so observed pending nudges queue the same follow-up drive used by normal invocation completion instead of relying only on a durable alarm.
- Patched hosted webhook pointer workflows so a latest uncheckpointed mailbox pointer re-nudges during checkpoint waiting, preserving the exact mailbox item as active work until durable import progress catches up.
- Patched hosted conversation mailbox import to self-heal the managed auto-reply channel before returning staged assistant input ids, so cold Linq/iMessage inputs cannot be staged before the scanner has channel admission state.
- Completion audits found and the patch fixed three deploy blockers/tightening points: direct runner nudges now start before pointer-workflow bookkeeping, Linq auto-reply self-heal is narrowed away from consent-gated WhatsApp import, and initial mailbox import now runs inside the hosted process environment instead of ambient `HOME`.
- Added regressions for direct nudge not waiting on workflow start, hosted-process env during initial mailbox import, Linq auto-reply self-heal before staging, WhatsApp non-self-heal, latest-lane workflow re-nudge lookup, and nudge-reason follow-up drives.
- Focused verification passed for the runner alarm regression, hosted webhook workflow, hosted handoff, hosted conversation mailbox import, hosted workspace entrypoint, assistant-runtime typecheck/test, Cloudflare verify, hosted-web verify, and final diff-aware verification.
- Follow-up audit found two latency blockers before deploy: idle-checkpoint pending nudges could still fall back to alarm-only continuation, and hosted-web webhook success could still wait on the optional direct runner nudge.
- Patched pending-nudge checkpoint handoff to queue the same continuation drive in the current isolate and changed hosted-web webhook success to return after durable workflow handoff while observing direct runner nudge asynchronously.
- Focused Cloudflare/web regressions, full Cloudflare verify, full hosted-web verify, assistant-runtime typecheck/test, diff hygiene, and privacy scans passed for the audit-blocker follow-up.
- Pushed the audit-blocker follow-up to main, then received a Pro simplification target: success-path handoff results should not report `runnerNudgeAccepted: false` when the optional direct nudge is merely deferred.
- Renamed the handoff/read-receipt contract to an explicit `directRunnerNudgeStatus` enum, using `deferred` for success-path deferred observation.
- Focused hosted-web handoff/Linq dispatch regressions and assistant-runtime typecheck passed for the Pro simplification follow-up.
- After deploy, live iMessage probing still found a Cloudflare-side wake bug: a direct nudge was accepted immediately while another invocation was active, then pending work degraded into generic retry/exhaustion and delayed mailbox import for minutes.
- Patched Cloudflare runner alarm/failure recovery so due work with a stored pending nudge runs as `nudge`, nudge failures preserve pending work instead of generic exhaustion, active/manual/idle-checkpoint failures queue pending-nudge continuation when pending work is present, and idle-checkpoint failure cleanup yields to pending work instead of destroying the warm runner.
- Added bounded poison protection for pending nudges: after the configured fast retry attempts are exhausted, the nudge stays recoverable but moves to the longer capped backoff; fresh external nudges still reset retry state and return to the fast path.
- Added runner-alarm regressions for pending nudge at retry cap, failed pending-nudge retries staying on the nudge lane, throttled exhausted pending-nudge retries, fresh nudge reset from long backoff, and idle-checkpoint failure yielding to pending work without container destroy.
- Pro/local review passes after the live bug found no deploy-blocking issue after the Cloudflare fix; simplification/security/coverage audit findings were applied.
- Final review found low throttle consistency issues only; patched direct nudge failures to ignore fast caller delays after the retry cap and to clamp exhausted pending-nudge backoff to the standard retry maximum.
- Added a direct nudge failure regression with an oversized configured retry delay.
- Focused runner-alarm verification passed with 103 tests, Cloudflare typecheck passed, `git diff --check` passed, and full `pnpm --dir apps/cloudflare verify` passed with 70 files / 951 tests.

Now:
- Close the plan and commit/push the Cloudflare pending-nudge recovery fix to main.

Next:
- Run `pnpm cf:deploy:immediate`, verify the Cloudflare deployment, then recheck warm, repeated, and cold/recovery iMessage reply behavior against live Cloudflare/Linq logs.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: live post-deploy iMessage reply latency until the pending-nudge recovery patch is deployed and the runner drains fresh inbound messages.

Working set (files/ids/commands):
- `apps/cloudflare/src/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/**`
- `packages/operator-config/src/linq-runtime.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts`
- `apps/web/test/hosted-onboarding-webhook-workflows.test.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/src/runner-outbound/heartbeat.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm cf:deploy:immediate`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-webhook-workflows.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-execution-handoff.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `pnpm -C apps/cloudflare typecheck`
- `pnpm typecheck`
- `pnpm --dir apps/cloudflare verify`
- `git diff --check`
- `pnpm test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/README.md`
Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
