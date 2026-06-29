Goal (incl. success criteria):
- Make PR 335 CI green by fixing the Linq scheduled reminder E2E failure where a checkpoint-required projected assistant wake is persisted stale after the checkpoint.
- Success means the runner checkpoints required state, then services a now-due projected wake instead of leaving the workspace in-flight with a stale `nextWakeAt`.

Constraints/Assumptions:
- Keep the fix in the existing hosted-runtime wake/checkpoint primitives; avoid new queues, schedulers, or ownership layers.
- Preserve Cloudflare runner warm-process behavior.
- Do not expose local paths, usernames, secrets, or raw env values in committed files.

Key decisions:
- Treat assistant semantic time and runner checkpoint scheduling time separately.
- Prefer a runner-level checkpoint-before-wake invariant over assistant-specific wake runway buffers.

State:
- Active.

Done:
- Pulled the failing CI log/artifact for PR 335 head `43c36593`.
- Confirmed all other CI checks passed; only Linq scheduled reminder E2E failed.
- Removed the assistant-specific post-delivery wake runway workaround.
- Added a runner projection freshness bit so only fresh assistant checkpoint gates can be serviced immediately after checkpointing.
- Added entrypoint coverage for a due assistant wake that becomes serviceable after the idle checkpoint.
- Verification passed: assistant-runtime typecheck, focused and full touched test files, `pnpm test:diff ...`, `git diff --check`, and `pnpm docs:drift`.

Now:
- Commit and push the scoped fix, then rerun PR checks and ReviewGPT.

Next:
- Poll CI and address any ReviewGPT findings.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- PR #335
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
