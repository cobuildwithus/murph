## Goal

- Ensure the Cloudflare hosted deploy workflow forwards the canonical `VERCEL_AI_API_KEY` secret into the rendered worker secrets payload so Vercel AI Gateway runs can authenticate successfully.

## Why

- GitHub `production` currently has `HOSTED_ASSISTANT_API_KEY_ENV=VERCEL_AI_API_KEY` and a `VERCEL_AI_API_KEY` secret, but the live `murph-hosted` worker does not have that secret after deploy.
- Cloudflare observability shows repeated hosted runner authentication failures from Vercel AI Gateway because the worker runtime is missing the required gateway credential.

## Scope

- `.github/workflows/deploy-cloudflare-hosted.yml`
- Verification for the workflow/deploy wiring only

## Risks

- Deploy/auth surface change; keep the diff minimal and avoid widening beyond the missing secret pass-through.

## Verification

- `pnpm typecheck`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-automation.test.ts --coverage.enabled=false`
- `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy-cloudflare-hosted.yml")'`
- `git diff --check -- .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/test/deploy-automation.test.ts agent-docs/exec-plans/active/2026-04-21-cloudflare-vercel-ai-key-workflow.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm test:diff .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/test/deploy-automation.test.ts`

## Outcome

- The workflow now forwards `VERCEL_AI_API_KEY` into the deploy job env.
- The Cloudflare deploy-automation guard test now asserts both the workflow secret pass-through and the rendered worker-secrets payload entry.
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
