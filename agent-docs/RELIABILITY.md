# Reliability

Last verified: 2026-03-26

## Bootstrap Guardrails

- Keep behavior deterministic and documented as the first modules are added.
- Prefer explicit failure paths and actionable errors over silent fallback behavior.
- For assistant runtime recovery, keep fallback selection deterministic and local: no extra model call may choose recovery behavior, degraded retries stay bounded, and session-preservation/privacy invariants must be explicit.
- Update architecture and verification docs in the same change that introduces new runtime entrypoints.
- Avoid hidden coupling between scripts, docs, and runtime code; document new dependencies in `ARCHITECTURE.md` and `agent-docs/references/testing-ci-map.md`.

## When Runtime Code Lands

- Define startup requirements, health checks, and critical invariants.
- Document retry/idempotency expectations for writes or background work.
- When degraded retries exist, document the exact downgrade path, retry budget, and safe-defer triggers instead of letting callers infer them from scattered catch blocks.
- Add tests for failure modes before relying on production-side recovery logic.
- Keep assistant lifecycle middleware fatal and ordered, while observer failures remain non-fatal diagnostics that never change the main control flow.
