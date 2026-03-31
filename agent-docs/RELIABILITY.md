# Reliability

Last verified: 2026-03-30

## Bootstrap Guardrails

- Keep behavior deterministic and documented as the first modules are added.
- Prefer explicit failure paths and actionable errors over silent fallback behavior.
- Update architecture and verification docs in the same change that introduces new runtime entrypoints.
- Avoid hidden coupling between scripts, docs, and runtime code; document new dependencies in `ARCHITECTURE.md` and `agent-docs/references/testing-ci-map.md`.

## When Runtime Code Lands

- Define startup requirements, health checks, and critical invariants.
- Document retry/idempotency expectations for writes or background work.
- Add tests for failure modes before relying on production-side recovery logic.
- Foreground inbox/parser-backed daemon runs should favor restartable connectors with bounded backoff over permanently dead watch loops, while still keeping low-level restart behavior opt-in and always bounded by the owning abort signal.
- Networked assistant/provider/channel calls should set explicit timeouts, propagate caller abort signals, and only auto-retry request shapes that are replay-safe or rate-limit directed.
- Tool-enabled assistant provider turns should disable automatic model retries once local side-effecting tools are in play, so bounded assistant/vault operations are never replayed implicitly by a transport-layer retry.
- Assistant turns and outbound sends should prefer system-emitted receipts plus idempotent outbox intents over model-authored logs. The receipt trail must stay non-canonical, compact, and safe to inspect through `murph status` / `murph doctor` even when transcripts are partially corrupted.
- Assistant observability and recovery surfaces should stay persisted and replay-safe: diagnostics/status snapshots must tolerate missing files, failover cooldown state must survive process restarts, and fault-injection coverage should exercise retryable provider/delivery/automation failure paths before those recovery hooks are trusted.
