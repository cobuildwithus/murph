# 2026-03-29 Assistant-state secrecy, redaction, and repair

## Goal

Harden `assistant-state/**` so sensitive assistant runtime artifacts default to private storage, secret-bearing provider configuration never persists inline in primary state files, and legacy state can be repaired in place with a single operator command.

## Constraints

- Keep `assistant-state/**` non-canonical and rebuildable.
- Keep the architecture file-backed; do not introduce a database, daemon-only repair loop, or background migration worker.
- Preserve `packages/core` as the only canonical vault writer.
- Do not widen command surface beyond the existing assistant doctor flow.
- Favor a single shared helper layer for assistant-state secrecy instead of ad hoc per-callsite chmod/redaction logic.

## Planned shape

- Add a shared assistant-state security helper in `@murph/runtime-state` that:
  - identifies assistant-state paths,
  - creates assistant-state directories with `0700`,
  - writes/append assistant-state files with `0600`, and
  - audits/repairs existing assistant-state permission drift.
- Move secret-bearing provider headers out of persisted assistant session and provider-route-recovery JSON into private sidecars under `assistant-state/secrets/**`.
- Redact inline secret material before persisting diagnostics, runtime events, quarantine metadata, and delivery errors.
- Extend `assistant doctor --repair` to:
  - migrate legacy inline secret-bearing headers into sidecars,
  - repair permissive assistant-state modes,
  - detect malformed/orphaned secrecy sidecars, and
  - fail closed when secrecy invariants remain broken.
- Cover the new behavior with focused assistant-state and observability tests.

## Deliberate non-goals

- No new canonical vault schema.
- No approval engine or policy marketplace.
- No encryption-at-rest key management layer.
- No background scrubbing job outside explicit operator repair.

## Verification

- Run `tsc -p tsconfig.json --noEmit`.
- Repo bootstrap commands (`pnpm typecheck`, `pnpm test`, `pnpm test:coverage`) remain the required standard, but this environment may not have `pnpm` or installed dependencies; if so, record that limitation explicitly in handoff.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
