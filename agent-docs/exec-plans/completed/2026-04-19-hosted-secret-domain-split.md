## Goal

Split hosted secret ownership by trust domain so Cloudflare keeps only wake decrypt material plus worker-local callback signing, while web-owned member/share/private-field crypto remains web-only.

## Scope

- `apps/cloudflare/src/{env,hosted-execution-process-env,hosted-execution-worker-env,hosted-web-encryption,web-callback-auth,worker-contracts,hosted-env-policy}.ts`
- `apps/cloudflare/scripts/deploy-automation/**`
- `apps/web/src/lib/{hosted-web,hosted-wake,hosted-onboarding,hosted-share}/**`
- focused hosted web / Cloudflare docs and tests that describe or verify the hosted secret contract

## Constraints

- Treat this as a greenfield hard cut for secret ownership; prefer explicit new env names over compatibility fallback.
- Keep `apps/web` as the canonical owner of member/share/private-field crypto.
- Keep Cloudflare wake payload decryption limited to a dedicated wake-only key.
- Keep callback signing private material in the worker boundary only; do not forward it into the isolated child process env.
- Preserve unrelated in-flight hosted wake/runtime edits, especially the active payload-unification changes already present in `apps/web/src/lib/hosted-wake/payload.ts`.

## Verification

- `pnpm typecheck`
- truthful focused coverage via `pnpm test:diff apps/cloudflare apps/web`
- direct proof in focused hosted wake and env-policy tests that Cloudflare reads only the wake key and the child env excludes callback-signing/private web-data keys
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
