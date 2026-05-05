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

## Current evidence

- Fresh iMessage probe after the deploy appended the conversation item immediately and marked it read quickly, but runtime logs showed the message landed during prior checkpoint activity and waited for a later restore/import pass.
- Restore-stage logs for the later pass showed base restore dominating: multi-second fetch/repair and roughly 15s materialization for an unchanged base snapshot, followed by a much smaller hot-state restore.
- Cloudflare observability repeatedly reported Worker memory-limit failures on artifact object PUTs during checkpoint/upload windows; still worth a follow-up, but the immediate 40-50s gap is explained by repeated cold base restore plus queued checkpoint/import ordering.
- The first post-fix warm retry restored the unchanged base with `cacheHit: true` in 0ms and finished restore in roughly 2.6s, then a later maintenance checkpoint attempted repeated full snapshot uploads, hit memory limits, and lost the warm cache before the next live text.
- Live traces also showed a 15-25s gap between device-connect context logging and assistant automation start. That code path runs device-sync scheduler work before auto-reply; for fresh imported user input this is background work on the critical text reply path.
- The post-deploy live probe confirmed hot checkpointing fixed the memory-pressure path: import/outbox checkpoints stayed hot-state at roughly 430 KB and Cloudflare observability showed no memory-limit errors. The remaining live gap was device sync still running before assistant automation on the nudge path, plus one retryable Linq send that succeeded on the next warm retry.

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
