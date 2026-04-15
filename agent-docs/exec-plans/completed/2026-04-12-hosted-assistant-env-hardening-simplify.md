# Hosted Assistant Env Hardening Simplify

## Goal

Land the supplied hardening patch so hosted assistant API-key env forwarding uses one canonical allowlist across runtime, deploy automation, and hosted CLI child env assembly, with no generic referenced-secret bypass path.

## Why

- The current tree still forwards whatever env name `HOSTED_ASSISTANT_API_KEY_ENV` points at in multiple places, which lets unrelated secrets bypass the intended allowlists.
- Deploy automation maintains a separate assistant secret list that can drift from the runtime-side assistant env surface.

## Scope

- shared hosted assistant env-name ownership in `packages/operator-config/src/hosted-assistant-config.ts`
- hosted assistant re-export surface in `packages/assistant-runtime/src/hosted-assistant-env.ts`
- Cloudflare runner env policy and deploy automation under `apps/cloudflare/src/**` and `apps/cloudflare/scripts/deploy-automation/**`
- hosted assistant CLI child-env filtering in `packages/assistant-engine/src/assistant-cli-tools/execution-adapters.ts`
- focused regression tests in `apps/cloudflare/test/**` and `packages/assistant-engine/test/**`

## Constraints

- Preserve unrelated in-flight assistant, Cloudflare, and hosted-web work already present in the tree.
- Treat the supplied patch as behavioral intent, not overwrite authority; adapt only where current HEAD differs.
- Keep the stricter behavior: `HOSTED_ASSISTANT_API_KEY_ENV` may select only a known hosted-assistant provider key, not an arbitrary env name.
- Do not expose personal identifiers from local paths, usernames, or legal names in repo files, commits, or handoff text.

## Verification

- Run `pnpm typecheck`.
- Prefer a truthful `pnpm test:diff` lane covering the touched packages/apps.
- Add one direct scenario proof that an unrelated referenced secret is not forwarded through the hosted assistant env seam.
- Record any unrelated verification blockers exactly if they appear.

## Result

Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
