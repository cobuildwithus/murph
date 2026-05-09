# DeepSec Security Fixes

## Goal

Fix three high-confidence DeepSec findings with minimal architecture change:

- isolate the hosted Codex deploy guard from production secret-bearing deploy steps
- remove mutable `npm@latest` installs from the trusted release path
- make hosted Privy/phone/wallet identity lookup fail closed on ambiguous blind-index rotation reads

## Scope

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `.github/workflows/release.yml`
- `apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts`
- focused hosted onboarding tests

## Constraints

- Preserve existing deploy and release behavior except for supply-chain hardening.
- Reuse existing blind-index ambiguity patterns from Telegram routing and Stripe billing.
- Do not touch hosted snapshot executable-selector behavior in this lane.
- Preserve unrelated working-tree edits.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `pnpm --dir apps/web exec eslint src/lib/hosted-onboarding/hosted-member-identity-store.ts test/hosted-onboarding-member-store.test.ts test/hosted-onboarding-member-identity-service.test.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-privy-service.test.ts`
- `ruby -e 'require "yaml"; ARGV.each { |path| YAML.load_file(path); puts "ok #{path}" }' .github/workflows/deploy-cloudflare-hosted.yml .github/workflows/release.yml`
- `pnpm typecheck`

## Status

Implemented and verified. Scoped commit is pending dirty-worktree coordination.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
