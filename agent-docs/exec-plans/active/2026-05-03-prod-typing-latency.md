# Trace and reduce hosted production typing latency

Status: active
Created: 2026-05-03
Updated: 2026-05-06

## Goal

- Trace why hosted production typing indicators appear several seconds after an inbound Murph message, then either land the smallest safe latency improvement or add privacy-bounded timing evidence that can identify the next bottleneck.

## Success criteria

- The production message-to-typing path is mapped with concrete file evidence.
- Any code change avoids raw provider payloads, message text, contact identifiers, secrets, and local path leakage.
- Focused tests cover changed timing, nudge, typing, or telemetry behavior.
- Required verification and completion audits pass or any unrelated blocker is documented.

## Scope

- In scope:
  - Hosted onboarding/webhook ingress nudge ordering for active-member conversation messages.
  - Cloudflare runner nudge admission and typing-start timing where directly coupled.
  - Assistant-runtime hosted typing helpers and privacy-bounded hosted runtime logs if needed.
  - Focused tests under the touched web/Cloudflare/runtime slices.
- Out of scope:
  - Broad hosted-runner architecture rewrites.
  - Changing canonical mailbox ownership or encrypted payload storage.
  - Persisting raw message content, provider payloads, phone numbers, chat ids, emails, or secrets.

## Constraints

- Technical constraints:
  - Apps web remains the canonical mailbox/control-plane owner; Cloudflare remains execution-only.
  - Durable retries must stay pointer-only and safe if direct nudge optimization is added.
  - Logs must be metadata-only and accepted by existing hosted runtime log parsers.
- Product/process constraints:
  - Preserve unrelated active ledger rows and keep the diff narrow.
  - Same-turn completion should close this plan and create a scoped commit if files change.

## Risks and mitigations

1. Risk: Reducing perceived latency weakens durable retry behavior.
   Mitigation: Keep Workflow or sweeper recovery as the retry backstop, and test fallback paths.
2. Risk: Timing traces leak sensitive channel or contact data.
   Mitigation: Use only coarse event codes, component/phase, mailbox lane/sequence, and bounded redacted JSON.

## Tasks

1. Map current inbound message append, workflow/direct nudge, runner invocation, and typing start paths.
2. Check available production-facing logs/status surfaces for timing evidence without exposing identifiers.
3. Land a narrow latency fix or telemetry addition.
4. Run focused verification and required completion audits.
5. Close the plan and commit the scoped change.

## Decisions

- Treat the likely bottleneck as the handoff before runner execution until code or production evidence proves otherwise.
- Prefer direct nudge with pointer Workflow fallback over adding any second queue/dispatch owner, if the current active-member path can support it safely.
- 2026-05-05 live evidence: webhook append and runner nudge are sub-2s, provider send is fast, and the dominant delay is inside hosted execution before mailbox import/assistant start. Current evidence points at runner container readiness/checkpoint/artifact-upload pressure rather than a 44 MB snapshot fetch alone.
- 2026-05-05 deploy evidence: the live Worker/container image rolled to the new version, but container smoke needed repeated retries with transient "not listening" lifecycle events before the expected runner bundle was observed.
- 2026-05-06 root cause: isolated runner invocations used a fresh temp launcher root and deleted it after each successful child process, so warm containers still cold-restored the unchanged base snapshot on every wake.
- 2026-05-06 implementation: preserve a per-user hashed warm launcher root for successful isolated invocations and cache the restored base snapshot marker outside vault/operator-home roots so unchanged bases skip fetch/repair/materialize on warm follow-up invocations.
- 2026-05-06 follow-up root cause: the warm cache worked once, then maintenance checkpoint full-snapshot artifact PUTs hit Cloudflare memory limits and the failed isolated child evicted the warmed launcher root, causing the next retry to cold-restore the 44 MB base again.
- 2026-05-06 follow-up implementation: keep warm launcher roots across failed child runs because durable restore replays state on the next attempt, and route all checkpoint reasons through the hot layered snapshot path unless hot bootstrap/fallback requires a full snapshot.
- 2026-05-06 active-input latency decision: skip the timer-lane device-sync sweep when mailbox import brought in fresh input so conversation replies are not blocked by background health-sync jobs; dedicated device-sync wakes still run the sync lane.
- 2026-05-06 live follow-up: treat webhook nudges as active input for the device-sync skip even when import accounting is stale or split across phases.
- 2026-05-06 warm-path decision: consume and rewrite a local hot-restore marker only after successful workspace checkpoints so a warm nudge can skip re-fetching/materializing already-restored hot state, while failed children still force durable restore replay.
- 2026-05-06 active-input checkpoint decision: defer the initial mailbox import checkpoint on nudge runs and let the assistant/outbox checkpoint carry the imported mailbox state; if the assistant makes no durable progress, write a deferred import checkpoint after the assistant phase.
- 2026-05-06 nudge scan/send decision: carry freshly imported assistant input ids into the auto-reply input source so active nudges can avoid a full input-event directory scan, and fast-dispatch idempotent delivery effects before the runner checkpoint so Linq sends are not blocked on the pre-send snapshot.
- 2026-05-06 assistant timing decision: persist coarse elapsed fields on `assistant.pass_finished` for readiness, device sync, assistant automation, and automation pass substeps; no prompts, messages, identifiers, provider payloads, or paths are logged.
- 2026-05-06 deploy unblock decision: make the optional native hosted-email send binding explicitly disableable and have `cf:deploy:immediate` omit it so urgent iMessage/runtime hotfixes can deploy with a Cloudflare token that lacks send-email bind permission; ordinary deploys keep the existing default.
- 2026-05-06 container lifecycle decision: renew the Cloudflare container activity timeout during long runner invocations and ignore stale activity-expiry callbacks that arrive right after recent runner work, so a queued expiry cannot destroy the warm shell/cache immediately after a live reply.
- 2026-05-06 urgent deploy decision: let the manual deploy workflow override runner idle TTL and have `cf:deploy:immediate` use a 12 hour TTL for repeated live iMessage probes while the production latency incident is being debugged.
- 2026-05-06 provider timing decision: emit metadata-only Codex app-server timing trace stages (`spawn-ready`, initialize, thread start/resume, turn start/completion, shutdown) so live logs can split the remaining assistant pass latency without storing prompts, messages, identifiers, paths, or provider payloads.

## Current evidence

- Fresh iMessage probe after the deploy appended the conversation item immediately and marked it read quickly, but runtime logs showed the message landed during prior checkpoint activity and waited for a later restore/import pass.
- Restore-stage logs for the later pass showed base restore dominating: multi-second fetch/repair and roughly 15s materialization for an unchanged base snapshot, followed by a much smaller hot-state restore.
- Cloudflare observability repeatedly reported Worker memory-limit failures on artifact object PUTs during checkpoint/upload windows; still worth a follow-up, but the immediate 40-50s gap is explained by repeated cold base restore plus queued checkpoint/import ordering.
- The first post-fix warm retry restored the unchanged base with `cacheHit: true` in 0ms and finished restore in roughly 2.6s, then a later maintenance checkpoint attempted repeated full snapshot uploads, hit memory limits, and lost the warm cache before the next live text.
- Live traces also showed a 15-25s gap between device-connect context logging and assistant automation start. That code path runs device-sync scheduler work before auto-reply; for fresh imported user input this is background work on the critical text reply path.
- The post-deploy live probe confirmed hot checkpointing fixed the memory-pressure path: import/outbox checkpoints stayed hot-state at roughly 430 KB and Cloudflare observability showed no memory-limit errors. The remaining live gap was device sync still running before assistant automation on the nudge path, plus one retryable Linq send that succeeded on the next warm retry.
- The next live warm probe showed base restore at 0ms but still spent about 2.4s restoring hot state, about 2.6s on the pre-assistant import checkpoint, and about 2.4s on the pre-send outbox checkpoint; the patch under test removes the hot restore/materialize repeat and the pre-assistant import checkpoint from the active nudge path.
- The post-hot-cache live probe showed restore at roughly 0.3s and deferred import working, but end-to-end send still waited on assistant invocation plus an `outbox_sending` checkpoint before the provider call. The current patch under test targets both: fresh-input scan bypass for nudge auto-reply and idempotent fast delivery before the receipt checkpoint.
- The first immediate rollout for the active-input patch was blocked by Cloudflare rejecting the optional native hosted-email send binding for the workflow token. That deploy did not update the live Worker/container version.
- The latest live iMessage probes after the fast-send deploy proved the `outbox_sending` pre-send checkpoint was gone, but both back-to-back probes still cold-restored the base workspace and Cloudflare observability showed container/DO reset and lifecycle network-loss events around the same window.
- Those same probes spent roughly 11-12.5s inside the assistant automation pass after restore/import, so the next deploy must preserve warm container state and expose provider-stage timings before another live message is sent.

## Verification

- Commands to run:
  - Focused tests for touched web/Cloudflare/runtime files.
  - `pnpm typecheck` or a documented scoped substitute if unrelated checkout failures block the full lane.
- Expected outcomes:
  - Tests prove nudge/typing/logging behavior and fallback semantics.
  - TypeScript accepts the touched surfaces.
- 2026-05-06 local verification:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner-isolated.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-restore-codex-continuity.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check -- apps/cloudflare/src/node-runner-isolated.ts apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-maintenance.test.ts`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-maintenance.test.ts`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `git diff --check -- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-mailbox-checkpoint.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-restore-codex-continuity.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `git diff --check -- packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-mailbox-checkpoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-mailbox-checkpoint.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `git diff --check -- packages/assistant-engine/src/assistant/automation.ts packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts packages/assistant-runtime/src/hosted-runtime/turn-input.ts packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/src/hosted-runtime/models.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
