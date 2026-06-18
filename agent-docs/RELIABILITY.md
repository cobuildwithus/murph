# Reliability

Last verified: 2026-05-13

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
- Tool-enabled assistant provider turns should disable automatic model retries once local side-effecting tools are in play, so bounded assistant/vault operations are never replayed implicitly by transport-layer retry. Bound tool execution failures should be returned to the model as structured tool results so the model can recover inside the same turn instead of aborting the provider turn.
- Hosted generated-image turns must fail before the provider call if the runtime platform has no generated-image uploader, and must treat Cloudflare Images upload failure as a structured tool failure rather than silently returning inaccessible media.
- Hosted generated voice memo turns must treat ElevenLabs generation or Linq attachment upload failures as structured tool failures. Final Linq voice memo sends are not replay-safe unless Linq later documents idempotency for `/voicememo`, so outbox transport idempotency must stay false for voice memo media and retries must follow the confirmation-pending/fail-closed path.
- Assistant turns and outbound sends should prefer system-emitted receipts plus idempotent outbox intents over model-authored logs. The receipt trail must stay non-canonical, compact, and safe to inspect through `murph status` / `murph doctor` even when transcripts are partially corrupted.
- Assistant observability and recovery surfaces should stay persisted and replay-safe: diagnostics/status snapshots must tolerate missing files, and fault-injection coverage should exercise retryable provider/delivery/automation failure paths before those recovery hooks are trusted.
- Observability writes (logs, latency traces, diagnostics, metrics) must never block user-facing latency: queue or fire-and-forget them off the reply hot path and flush at invocation end, per the `Hosted Foreground Priority` invariants in `docs/contracts/00-invariants.md`. Only warn/error crash-tail writes may block, bounded by the process exit backstop.
