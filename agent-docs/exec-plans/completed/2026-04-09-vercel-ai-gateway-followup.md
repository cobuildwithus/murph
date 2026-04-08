# Tighten Vercel AI Gateway assistant support

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Standardize Murph's first-class Vercel AI Gateway assistant path on `VERCEL_AI_API_KEY` only.
- Make hosted Vercel AI Gateway assistant bootstrap default `zeroDataRetention` to on, while keeping local assistant config explicitly opt-in.

## Success criteria

- The named Vercel AI Gateway preset resolves only `VERCEL_AI_API_KEY` as the built-in credential env.
- Hosted runner policy/tests and setup/provider preset inference stop advertising `AI_GATEWAY_API_KEY` as a first-class env alias.
- Hosted assistant bootstrap enables `zeroDataRetention` by default for Vercel AI Gateway when the env is unset, while an explicit hosted `false` still disables it.
- Local saved assistant defaults and `murph model` continue to require explicit `zeroDataRetention` opt-in.

## Scope

- In scope:
- `packages/operator-config/**` preset/bootstrap/schema adjustments
- `packages/setup-cli/**` and `packages/cli/**` follow-up surface/schema updates
- `apps/cloudflare/**` env allowlist/test cleanup
- Out of scope:
- unrelated hosted/runtime work already in flight elsewhere in the tree
- broader assistant provider redesign

## Constraints

- Preserve existing local assistant config compatibility.
- Keep hosted default ZDR scoped to Vercel AI Gateway-backed hosted profiles only.
- Do not disturb unrelated repo worktree changes.

## Tasks

1. Remove extra first-class Vercel Gateway env aliases so the preset standard is `VERCEL_AI_API_KEY`.
2. Default hosted Vercel Gateway bootstrap to `zeroDataRetention = true` when unset.
3. Update focused tests and regenerate any derived CLI schema snapshot.
4. Run required verification and land a scoped follow-up commit.

## Verification

- `pnpm typecheck`
- focused Vitest coverage for operator-config, setup-cli, assistant-engine, and Cloudflare hosted env policy
- `bash scripts/workspace-verify.sh test:diff packages/operator-config packages/assistant-engine packages/setup-cli apps/cloudflare`
Completed: 2026-04-09
