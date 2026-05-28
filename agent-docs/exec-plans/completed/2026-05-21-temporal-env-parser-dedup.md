# Deduplicate hosted Temporal environment parsing

Status: active
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Remove duplicated hosted Temporal connection/env parsing between the web
  signal client and Temporal worker so production API-key/TLS/mTLS behavior
  cannot drift.

## Success criteria

- Shared parser lives behind a package-owned public entrypoint.
- Web still treats missing Temporal address as "signaling disabled" while the
  worker keeps its local `localhost:7233` default.
- Existing API key, TLS, mTLS, namespace, task queue, and timing env behavior
  remains covered by focused tests.
- CI/README/Temporal CLI findings from the final review are verified as already
  present or unchanged.

## Scope

- In scope:
  - `packages/hosted-execution` shared Temporal env parser and tests.
  - Web signal client parser wrapper.
  - Temporal worker env parser wrapper.
  - Public export/path/test wiring needed for the new shared entrypoint.
- Out of scope:
  - Changing local `pnpm dev` Temporal lifecycle behavior.
  - Changing production secret names or provider values.
  - Editing unrelated active Temporal Activity, Murph Age, or MinIO work.

## Constraints

- Technical constraints:
  - Preserve package-boundary imports through declared public entrypoints.
  - Do not expose env values or secrets in tests, docs, logs, or commit output.
  - Keep the parser free of Temporal SDK imports so the shared contract remains
    small and portable.
- Product/process constraints:
  - Historical completed Temporal plans stay immutable snapshots.
  - Preserve unrelated dirty working-tree edits.

## Risks and mitigations

1. Risk: Web and worker need different default address semantics.
   Mitigation: shared parser accepts an explicit default-address option; wrappers
   keep the current per-runtime behavior.
2. Risk: Public package root grows a Node-only surface.
   Mitigation: expose the parser as a narrow `./temporal-env` subpath rather
   than adding it to the root barrel.

## Tasks

1. Add shared parser and tests in `packages/hosted-execution`.
2. Replace duplicate parser code in web and worker wrappers.
3. Update package exports, source-resolution config, and path mappings.
4. Run focused tests, typecheck, completion audits, and requested ReviewGPT.

## Decisions

- Use a shared parser rather than a drift-only test because both callers already
  depend on `@murphai/hosted-execution` and the common logic is small.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config packages/hosted-execution/vitest.config.ts packages/hosted-execution/test/temporal-env.test.ts --no-coverage`
  - `pnpm exec vitest run --config packages/hosted-orchestrator-temporal/vitest.config.ts packages/hosted-orchestrator-temporal/test/temporal-env.test.ts --no-coverage`
  - `pnpm --dir apps/web test -- test/hosted-orchestration-temporal-client.test.ts`
  - `pnpm typecheck`
  - `git diff --check`
- Expected outcomes:
  - All focused parser tests and repo typecheck pass without printing secrets.
