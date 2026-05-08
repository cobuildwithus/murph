# DeepSec High Fixes

## Goal

Fix the first two DeepSec HIGH findings:

- keep production deploy secrets off third-party runners
- reject Linq group chats before direct-thread onboarding/runtime side effects

## Scope

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- focused hosted Linq tests

## Constraints

- Preserve unrelated dirty worktree changes.
- Keep fixes small and owner-local.
- Do not address the device OAuth finding in this change; discuss that separately.

## Verification

- Run focused hosted Linq tests.
- Run the relevant workflow/app verification required by repo policy or report any unrelated blockers.
- Run required security/privacy and completion audits.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
