Goal (incl. success criteria):
- Deliver a completed hosted generated image promptly through its originating conversation even when newer conversation input is already waiting.
- Success means the trusted image-completion input is the next admitted Codex work once generation is ready, while newly arriving conversation input is retained by the existing foreground watcher for steering or the immediately following causal pass.

Constraints/Assumptions:
- Preserve the private `vault_image` trust boundary and the ordinary pending-input index as durable retry evidence.
- Do not add another queue, scheduler, sender, persisted state owner, or compatibility path.
- Do not interrupt a provider turn already in progress; preemption applies at the next assistant-admission boundary.
- Preserve unrelated work in the primary checkout.

Key decisions:
- Replace the invocation-local boolean image wake hint with the exact staged completion input batch returned by the image controller.
- Admit that exact batch before another initial mailbox import. When the existing live foreground watcher already captured newer conversation input, prepend the completion to that same frozen batch instead of starting an extra turn.
- Keep the pending-input index so runner loss or a failed completion turn retries through the existing durable path.
- Treat the provider continuation session as ordinary batching context, not authenticated group-route identity, for the exact trusted-completion match. The production importer does not attach that session to a newer inbound group message.
- Reconstruct completion-first ordering from structurally trusted pending completion events after invocation loss; the existing pending index remains the only durable owner and the wake remains a scheduling hint.
- Run that restored arbitration before both background and fresh foreground selection, and bound the joined cohort to same-route conversation events strictly after the completion's trusted origin input.

State:
- Complete.

Done:
- Reproduced the production delay and proved generation/canonical capture completed well before delivery.
- Identified the one-shot wake clearing and foreground-only fresh selection boundary.
- Read the hosted runtime, security, reliability, verification, and completion workflow guidance.
- Added a regression that failed with fresh conversation selected first and now proves the completion and fresh input enter one ordered Codex batch.
- Replaced the boolean wake hint with exact staged completion input ids and updated the architecture and invariant contracts.
- Remediated the first exact-head ReviewGPT round: production selectors and the assistant scanner now preserve the trusted completion-first batch, and readiness remains visible until the provider-acceptance boundary so shutdown can checkpoint an immediate retry.
- Added focused route-isolation, current-input-authority, provider-order, and shutdown-handoff proof; focused engine/runtime suites and package typechecks pass.
- Completed the required round-2 retrospective after production importer evidence showed that provider session equality split the trusted completion from a real newer group message. Chose shrink-and-continue: generic batching keeps session equality, while the exact trusted-completion route match reuses authenticated channel/account/thread authority without adding state or another owner.
- Added a production-importer end-to-end regression that proves a null-session group follow-up joins the ready completion in one completion-first Codex turn, becomes current at provider acceptance, and delivers through the same authenticated group route.
- Accepted the final-audit restart finding: the invocation-local exact-id marker disappeared before provider admission even though both inputs remained durable, so restored background selection could split the completion from a null-session follow-up.
- Added one shared event-based selection path for foreground, restored background, and empty-source refresh. It derives trusted completion ids from durable events only on background recovery, preserves ordinary batching otherwise, and adds no queue or persisted marker.
- Converted the production-importer regression into a two-invocation interruption proof covering restored selection, grouping, provider acceptance, current-input authority, ordinary Linq delivery, terminal cleanup, route isolation, and duplicate-pass prevention.
- Accepted both round-4 findings: a newly imported foreground message on the replacement invocation bypassed background-only recovery, and route-only recovery could fold same-route backlog older than the image request.
- Moved pending-completion arbitration to the foreground/background selection boundary. Fresh mode inspects pending state only for structurally trusted completions, falls back to fresh-only work on unrelated or malformed state, and never generically merges pending backlog.
- Added an origin-only trusted completion parser for ready and failed envelopes. Restored selection loads that existing origin event and admits only same-route conversation input with a strictly later canonical cursor; an unprovable origin delivers the completion alone.
- Extended the production two-invocation proof with a new group message between invocations. The replacement invocation now admits `[completion, prior follow-up, newest message]`, keeps the newest message current, delivers once, records terminal evidence, and empties the admitted pending cohort without a duplicate completion pass.
- Accepted the round-5 complexity finding and deleted the duplicate `hostedImageCompletionInputIds` side channel from the runner batch, batch builders and filters, assistant phase, maintenance API, and foreground selector API.
- Fresh structural completions now derive their identity from the already-loaded event and skip restored pending-state discovery. Restored invocations derive the same identity from the ordinary pending event only when fresh events contain no completion.
- Re-ran the focused engine/runtime suites, both package typechecks, the same-invocation and two-invocation production entrypoint regressions, docs drift, diff checks, and privacy scan successfully.
- Final ReviewGPT round 6 passed the exact deletion-focused candidate with no qualifying findings, and all required GitHub Actions passed that reviewed head.

Now:
- No implementation work remains. The PR is reviewed, mergeable, and ready for deployment after merge.

Next:
- Deploy the hosted runner/Cloudflare release with immediate container rollout and verify bundle convergence plus completion-to-delivery timing.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
- `packages/assistant-engine/src/assistant/automation/grouping.ts`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-runtime/src/hosted-runtime/image-generation.ts`
- `packages/assistant-runtime/test/hosted-runtime-image-generation.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `ARCHITECTURE.md`
- `docs/contracts/00-invariants.md`
- `agent-docs/references/hosted-runtime-protocol.md`
Status: completed
Updated: 2026-08-10
Completed: 2026-08-10
