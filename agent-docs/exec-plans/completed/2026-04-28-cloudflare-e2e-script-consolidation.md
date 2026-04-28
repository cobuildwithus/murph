# Cloudflare local E2E script consolidation

Status: completed
Created: 2026-04-28
Updated: 2026-04-28

## Goal

- Make the Cloudflare local E2E scripts unambiguous: `test:e2e:local`
  should be the local aggregate, and the hosted-local and Workers-runtime
  lanes should have explicit names.

## Success criteria

- `pnpm --dir apps/cloudflare test:e2e:local` runs both the hosted-local
  full-stack E2E suite and the Workers-runtime E2E smoke lane.
- Compatibility aliases keep the older `full-stack` and `smoke` script names
  working while routing to the explicit lane names.
- The testing docs describe the aggregate and focused CI slices clearly.

## Scope

- In scope:
  - `apps/cloudflare/package.json`
  - `apps/cloudflare/test/container-image-contract.test.ts`
  - `agent-docs/references/testing-ci-map.md`
  - `agent-docs/operations/verification-and-runtime.md`
- Out of scope:
  - Changing the hosted local E2E test bodies.
  - Broadening the default `apps/cloudflare verify` lane.
  - Changing the GitHub hosted E2E workflow job matrix unless the script
    contract requires it.

## Constraints

- Preserve unrelated dirty hosted runtime, hosted web, and Health Commons work.
- Do not weaken production runtime or verification invariants to satisfy the
  local harness.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/run-hosted-local-e2e.test.ts --no-coverage`
  - `pnpm --dir apps/cloudflare test:e2e:local`
  - `pnpm typecheck`
  - `git diff --check`
Completed: 2026-04-28
