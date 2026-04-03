# Hosted AgentMail Cleanup

## Goal

Remove stale AgentMail-specific hosted env/deploy references from the Cloudflare hosted path so the checked-in hosted model matches the current Cloudflare-native email runtime and does not imply that `AGENTMAIL_API_KEY` is supported in hosted runners.

## Why

- Hosted deploy docs and automation still mention `AGENTMAIL_API_KEY`, which suggests the runner can consume it.
- The hosted runner env allowlist only forwards `AGENTMAIL_BASE_URL`, so the current checked-in surface is internally inconsistent.
- The intended hosted email model appears Cloudflare-native, so stale AgentMail references on the hosted path create operator confusion and the wrong mental model.

## Scope

- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/src/deploy-automation.ts`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/**` that cover the hosted env/deploy contract
- `apps/cloudflare/README.md`
- `apps/cloudflare/DEPLOY.md`
- `ARCHITECTURE.md` and/or durable docs only if the hosted runtime contract description needs to change materially

## Constraints

- Keep the change hosted-only; do not remove local/CLI AgentMail support unless the code proves the hosted path still depends on it.
- Preserve unrelated dirty-tree edits.
- Run the required verification for `apps/cloudflare` changes plus a direct contract proof for the hosted env surface.

## Verification Plan

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused `apps/cloudflare` proof if needed to show the hosted env/deploy contract matches the new intent

## Notes

- Treat this as a deploy-surface/trust-boundary cleanup.
- If durable architecture/runtime docs still claim hosted AgentMail env support, update them in the same change.
- Focused Cloudflare verification passed for the touched env/deploy/user-env surfaces.
- Post-audit follow-up proved the hosted user-env extension path still rejects `AGENTMAIL_*` even when operators try to re-allow those keys.
- Repo-wide `pnpm typecheck` passed.
- Repo-wide `pnpm test` and `pnpm test:coverage` are currently blocked by broader pre-existing CLI/runtime failures outside this hosted Cloudflare change.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
