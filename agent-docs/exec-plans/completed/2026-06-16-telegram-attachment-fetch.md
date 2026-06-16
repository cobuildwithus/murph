# Telegram Attachment Fetch

## Goal

Fix hosted Telegram attachment parsing so PDF/document attachments persist raw bytes instead of only metadata, and keep local Telegram sign-in origin behavior simple and reproducible for development.

## Scope

- Normalize Telegram Bot API fetch input at the assistant-runtime/provider boundary.
- Normalize ambient Worker fetch at Cloudflare hosted runtime/provider/web-control boundaries before handing it to callback-style ports.
- Preserve Telegram and hosted effects-port method receivers when adapting runtime ports.
- Touch only the abort-guard receiver fix inside `packages/assistant-runtime/src/hosted-runtime.ts`; preserve unrelated edits already present in that file.
- Keep provider credentials Worker-owned; do not expose Telegram token values or raw provider responses.
- Default hosted local web origin to `127.0.0.1` so Telegram Login Widget origin matching works with BotFather local domains.
- Avoid unrelated `apps/web` and broader hosted-runtime dirty work in the current checkout.

## Evidence

- Local logs showed `/telegram/files/get` failing with Worker `TypeError` before Telegram egress completed.
- Retry repeated the same local type error, so the root cause was request-shape incompatibility rather than transient Telegram failure.
- Focused package tests and typechecks passed for `packages/assistant-runtime` and `packages/hosted-local-harness`.
- Focused Cloudflare package typecheck plus runner platform/provider-effect contract tests passed after receiver-sensitive regressions.
- Focused assistant-runtime abort-guard receiver test passed after the method-wrapper fix.
- Coverage audit added direct proof for the internal hosted-http/effects-port fetch path and the abort-guard Telegram file effects composition.
- The restarted dev stack is ready on `http://127.0.0.1:3000`.
- A fresh Telegram markdown attachment now has readable `rawPath` and `storedPath` in the vault, proving the post-fix provider-effect path persisted bytes.

## Verification Plan

- Focused assistant-runtime Telegram/provider tests.
- Focused hosted-local harness config/environment tests.
- Focused Cloudflare runner provider-effect and platform tests.
- Package typechecks for both touched packages.
- Direct local scenario proof from a fresh Telegram PDF resend, when available.
- Required security/privacy, coverage, and deep-review audit passes because this touches hosted provider egress and runtime/trust-boundary behavior.

## Completion

- Resolve any accepted audit findings.
- Re-run focused verification after review-driven changes.
- Use `scripts/finish-task` for the final scoped commit if no overlapping dirty work blocks safe staging.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
