# Cloudflare Deploy Crypto Env Bridge

## Goal

Get the immediate Cloudflare hosted deploy past production preflight without weakening hosted crypto checks.

Success criteria:

- Production GitHub environment has the required hosted-crypto public metadata vars.
- Deploy workflow can supply the renamed Cloudflare automation private JWK from the already-configured legacy automation recipient secret while the production environment is migrated.
- Focused workflow/deploy checks pass.
- Scoped change is committed and pushed.
- `pnpm cf:deploy:immediate` completes successfully after CI is green.

## Constraints / Assumptions

- Preserve unrelated dirty work, especially generated `apps/web/next-env.d.ts`.
- Do not print or commit secrets, private JWKs, `.env`, `.env.local`, or `.dev.vars` contents.
- Local Cloudflare dev vars are not a production source of truth.
- GCP authority public key metadata is public, but the automation private JWK remains secret-only.

## Key Decisions

- Use GCP KMS as the source for the authority signing key version and public PEM.
- Keep the workflow fallback narrow: only map the renamed Cloudflare automation env from legacy GitHub names for the production workflow while the new production names are absent.

## State

finish_review_passed_pending_commit

## Done

- Confirmed CI is green on the pushed app/runtime commits.
- Confirmed the deploy run failed in preflight on missing hosted-crypto bindings.
- Confirmed GCP KMS exposes the hosted authority signing key under the expected production keyring.
- Set the production GitHub environment hosted-crypto public metadata vars without printing secret values.
- Added a production-scoped workflow fallback from the legacy hosted-execution automation recipient names to the canonical hosted-crypto Cloudflare automation names.
- Added deploy automation coverage for the production-scoped fallback expressions.
- Passed workflow YAML parse, focused Cloudflare deploy automation/preflight tests, root typecheck, scoped `test:diff`, root `verify:acceptance`, and root `test`.
- Required task-finish review passed with no findings.

## Now

- Close the active plan with a scoped commit.

## Next

- Push the scoped commit, wait for CI, then rerun `pnpm cf:deploy:immediate`.

## Open Questions

- UNCONFIRMED: whether the legacy automation recipient secret exactly matches the hosted web production Cloudflare automation public JWK. The deploy fallback is a migration bridge for the already-configured GitHub production secret.

## Working Set

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
