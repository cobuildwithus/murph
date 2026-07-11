# Reliability

Last verified: 2026-07-10

## Current Guardrails

- Keep behavior deterministic and documented as the first modules are added.
- Prefer explicit failure paths and actionable errors over silent fallback behavior.
- Update architecture and verification docs in the same change that introduces new runtime entrypoints.
- Avoid hidden coupling between scripts, docs, and runtime code; document new dependencies in `ARCHITECTURE.md` and `agent-docs/references/testing-ci-map.md`.
- Use the concrete runtime contracts first: hosted runner wake/checkpoint behavior lives in `agent-docs/references/hosted-runtime-protocol.md` plus `apps/cloudflare/README.md`; deploy recovery and smoke expectations live in `apps/cloudflare/DEPLOY.md`; local device-sync and assistant daemon retry/control-plane behavior live in their package READMEs and tests.

## Runtime Expectations

- Define startup requirements, health checks, and critical invariants.
- Document retry/idempotency expectations for writes or background work.
- Add tests for failure modes before relying on production-side recovery logic.
- Foreground inbox/parser-backed daemon runs should favor restartable connectors with bounded backoff over permanently dead watch loops, while still keeping low-level restart behavior opt-in and always bounded by the owning abort signal.
- Networked assistant/provider/channel calls should set explicit timeouts, propagate caller abort signals, and only auto-retry request shapes that are replay-safe or rate-limit directed.
- Hosted Linq reaction target reads must distinguish permanent unavailable targets from transient provider failures: permanent misses are acknowledged without context, transient failures remain retryable, and event-id mailbox dedupe makes successful replay once-only. Reaction context itself is never runnable work and must not contribute foreground counts, retry wakes, or orchestration lag. The mailbox projection exposes only a bounded newest reaction suffix through the earliest wakeable message and fast-forwards the omitted prefix through existing durable progress; assistant grouping then pairs by provider occurrence time. Retain at most the newest 32 deferred observations per group and 256 total in the hosted pending set so reaction floods cannot create unbounded foreground reads or prompts.
- Tool-enabled assistant provider turns should disable automatic model retries once local side-effecting tools are in play, so bounded assistant/vault operations are never replayed implicitly by transport-layer retry. Bound tool execution failures should be returned to the model as structured tool results so the model can recover inside the same turn instead of aborting the provider turn.
- Hosted generated-image turns must fail before the provider call if the runtime platform has no generated-image uploader, and must treat Cloudflare Images upload failure as a structured tool failure rather than silently returning inaccessible media.
- Hosted generated voice memo turns must treat ElevenLabs generation, Linq attachment upload, or Telegram delivery-time generation failures as structured tool or delivery failures. Final Linq and Telegram voice memo sends are not replay-safe unless the provider later documents idempotency for those native voice-message endpoints, so outbox transport idempotency must stay false for voice memo media and retries must follow the confirmation-pending/fail-closed path.
- Cloudflare container and Durable Object RPC methods must be invoked directly on the platform stub, not detached, bound, wrapped, or passed around as ordinary callbacks. Test doubles for hosted runner/container seams should model that direct-call contract so local coverage catches receiver/proxy mistakes before they become accepted-but-stuck runtime work.
- Assistant turns and outbound sends should prefer system-emitted receipts plus idempotent outbox intents over model-authored logs. The receipt trail must stay non-canonical, compact, and safe to inspect through `murph status` / `murph doctor` even when transcripts are partially corrupted.
- Assistant observability and recovery surfaces should stay persisted and replay-safe: diagnostics/status snapshots must tolerate missing files, and fault-injection coverage should exercise retryable provider/delivery/automation failure paths before those recovery hooks are trusted.
- Observability writes (logs, latency traces, diagnostics, metrics) must never block user-facing latency: queue or fire-and-forget them off the reply hot path and flush at invocation end, per the `Foreground Reply Critical Path` invariants in `docs/contracts/00-invariants.md`. Only warn/error crash-tail writes may block, bounded by the process exit backstop.
