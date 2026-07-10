# Challenge Vault Share Projections

Status: completed
Updated: 2026-07-07

## Why

Group challenges need consented activity-specific score inputs such as running
minutes, walking minutes, swimming minutes, running zone minutes, and sauna
minutes. The existing Vault Share primitive already has a closed projection-kind
registry and bounded destination materialization; this work extends that
primitive instead of introducing challenge-specific permission machinery.

## Scope

- Add minimal reusable Vault Share projection kinds for activity-kind challenge
  scoring.
- Project daily aggregate records from existing canonical/query evidence.
- Keep group sharing bounded: daily totals only, no routes, raw workouts, GPS,
  traces, or private 1:1 context.
- Update join-policy copy, group challenge guidance, generated CLI command
  metadata, and focused tests.

## Out Of Scope

- A new challenge storage model or scoreboard service.
- Unbounded historical Vault Share storage. Challenge pages continue to snapshot
  standings because the shared projection store is a short sliding window.
- Public share pages, newsletter behavior, billing, or new provider ingestion.

## Verification Plan

- Focused package tests for hosted-execution parsing and assistant-runtime
  projection selection.
- CLI/generated metadata check where touched.
- `pnpm typecheck`.
- `pnpm test:diff` over touched files if it truthfully covers the final diff.

## Verification Results

- `pnpm --dir packages/hosted-execution test -- vault-share.test.ts`
- `pnpm --dir packages/assistant-runtime test -- vault-share-projection.test.ts`
- `pnpm --dir apps/web prisma:generate`
- `pnpm exec vitest run apps/web/test/hosted-group-tool.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
- `pnpm exec vitest run packages/cli/test/group-command.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
- Targeted package/app typechecks for hosted-execution, assistant-runtime, CLI,
  and apps/web.
- `pnpm typecheck`
- `pnpm build:test-runtime:prepared`
- `pnpm --dir packages/assistant-runtime build`
- `pnpm --dir packages/hosted-local-harness test`
- `pnpm test:diff` passed after the assistant-runtime package build provided
  the hosted-local-harness Cloudflare snapshot artifact.

## PR / Review Plan

- Use the isolated branch `agent/challenge-vault-share-projections`.
- Open a draft PR with the PR description contract from the completion workflow.
- Run the PR-lane Codex deep-review loop to zero accepted findings.
Completed: 2026-07-07
