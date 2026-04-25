# Hosted Health Commons Runtime Access

## Goal

Confirm and harden the hosted Cloudflare assistant path for reading public Health Commons protocol data, with the Finnish Dry Sauna protocol as the regression target.

## Scope

- Health Commons assistant tool execution and prompt guardrails.
- Cloudflare runner bundle package shape for the Health Commons runtime package.
- Focused tests only.

## Non-Goals

- No hosted provider/deploy rollout changes.
- No Health Commons content changes.
- No private vault data inspection.

## Plan

1. Verify the source catalog and prepared runner bundle can read the Finnish Dry Sauna protocol.
2. Add focused regression coverage for Finnish sauna Health Commons search/get.
3. Harden runner bundle packaging checks for Health Commons runtime/catalog files.
4. Add a prompt guard against unsupported “protocol missing” claims.
5. Run focused tests, typecheck where practical, and required completion reviews.

## Verification

- `pnpm --dir packages/health-commons generate:check` passed.
- Packaged runner direct proof showed `healthCommons.search` for `finnish sauna` returns Finnish Dry Sauna.
- Assistant-engine Health Commons tool and system-prompt tests passed.
- Cloudflare runner-bundle node tests passed.
- Assistant-engine and Cloudflare typecheck passed.
- Security/privacy review found no scoped findings.
- Final task-finish review found no blocking findings; remaining risk is live deployed rollout behavior.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
