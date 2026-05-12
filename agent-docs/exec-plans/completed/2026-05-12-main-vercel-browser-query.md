# Main Vercel Browser Query Fix

## Goal

Fix the current `main` production gate failures: the Vercel build failure caused by browser client code importing Node-backed modules, and the follow-on assistant-runtime CI snapshot failure on hosted Codex config.

## Constraints

- Preserve unrelated dirty dashboard, Cloudflare, assistant-runtime, and query work in the checkout.
- Keep browser imports on declared package public entrypoints.
- Do not reintroduce sibling package internal imports from `apps/web`.

## Plan

1. Confirm the current failing status and available logs.
2. Add or narrow browser-safe query public entrypoints for dashboard client selectors.
3. Point browser-vault and health-commons client code at browser-safe modules.
4. Update the hosted Codex config test to include env-header variable names without credential values.
5. Run focused package/app verification and report any unrelated blockers.

## Verification

- Done: `pnpm --dir apps/web build` passed locally after the browser entrypoint split.
- Pending: focused assistant-runtime hosted Codex config test.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
