# Cloudflare Deploy Secret Hard Cut

## Goal

Make the hosted Cloudflare deploy automation and deploy docs advertise only the Codex/Vercel AI Gateway assistant provider secret path for the Codex App Server assistant hard cut.

## Scope

- `apps/cloudflare/scripts/deploy-automation/worker-secret-names.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/test/runner-env.test.ts` only if focused tests require it
- `apps/cloudflare/test/hosted-env-policy.test.ts` only for directly coupled Worker secret payload expectations
- `apps/cloudflare/DEPLOY.md`
- `.github/workflows/deploy-cloudflare-hosted.yml` only for the directly coupled deploy-job secret bindings
- `scripts/dev-hosted-local/environment.ts` only if focused tests require it

## Constraints

- Remove broad legacy hosted assistant provider API key names from the optional Worker secret list.
- Keep unrelated platform, channel, search, device, email, and usage secrets available.
- Do not edit assistant-runtime, assistant-engine, general CLI docs, or smoke files.
- Do not expose local usernames, home paths, legal names, secrets, raw credentials, or direct personal identifiers in files, prompts, logs, or handoff.
- Preserve unrelated dirty work in the shared checkout.
- Do not create a git commit for this task.

## Verification

- Focused Cloudflare deploy automation tests.
- Runner env tests only if touched or if deploy tests show coupled expectations.
- Cloudflare app typecheck or scoped diff verification if practical in the shared dirty checkout.
- Privacy/diff scan before handoff.

## State

- Legacy hosted assistant provider secret names are removed from the Worker optional secret allowlist.
- Deploy docs and workflow bindings no longer advertise broad provider API key secrets.
- Completion reviews found stale hosted assistant seed/routing vars still bound in the deploy workflow; those workflow bindings and matching tests were removed.
- Verification passed for Cloudflare app typecheck, focused Cloudflare Node tests, diff whitespace, deploy-surface residue, and privacy scans.
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
