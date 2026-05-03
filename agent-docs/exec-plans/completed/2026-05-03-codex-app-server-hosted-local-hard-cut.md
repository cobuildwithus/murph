# Codex App Server Hosted-Local Hard Cut

## Goal

Make root hosted-local development represent production hosted execution: the runner container must use the image-owned `codex app-server` path with hosted Vercel AI Gateway credentials, and the host-side Codex bridge/local-codex provider path must be removed from normal runtime.

## Scope

- Remove hosted-local bridge config, lifecycle, env generation, and bridge tests.
- Reject deprecated bridge env vars early instead of silently ignoring them.
- Require `HOSTED_ASSISTANT_PROVIDER=vercel-ai-gateway` plus `VERCEL_AI_API_KEY` for hosted-local dev.
- Remove `local-codex` provider support and app-server proxy env forwarding from hosted runtime config/launch policy.
- Keep the deterministic E2E app-server stub only as test-only surface, clearly separated from `pnpm dev`.
- Update Cloudflare runner/env policy/tests and hosted-local docs to reflect the no-bridge parity path.

## Constraints

- Preserve unrelated dirty work and active ledger rows.
- Do not print or fixture real provider credentials, raw env contents, local account names, home paths, or secrets.
- Do not weaken shell/tool credential isolation: `VERCEL_AI_API_KEY` may configure Codex provider access but must not be inherited by Codex shell tool subprocesses.
- Prefer hard failures for deprecated bridge config so local runs cannot be mistaken for hosted parity.

## Verification Target

- Focused tests for `scripts/dev-hosted-local`, `packages/assistant-runtime`, and `apps/cloudflare` env/runner policy.
- `pnpm typecheck`.
- `pnpm test:diff` or scoped owner verification if the dirty tree has unrelated blockers.
- Completion audits required for high-risk hosted runtime/trust-boundary work.

## State

- Created from the external Codex app-server cutover plan.
- The older active `local-codex` bridge row remains in the ledger but this work supersedes that direction for the default hosted-local path.
- Implementation is complete across hosted-local scripts, assistant-runtime Codex config, Cloudflare runner env policy/redaction, focused tests, hosted-local harness docs, and `apps/cloudflare/README.md`.
- Security/privacy, simplify, coverage-write, and final completion audits ran. Findings were either fixed or documented as residual live-scenario proof gaps.
- Final scoped verification passed for hosted-local scripts, assistant-runtime coverage, Cloudflare verify, hosted-local harness typecheck, hosted-execution typecheck, and root typecheck once during final verification.
- A later root typecheck run became red on unrelated dirty `packages/assistant-engine` prompt-builder edits outside this task. The hard-cut owner checks remained green.
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
