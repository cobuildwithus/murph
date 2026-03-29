# Health Registry Adapter Drift Plan

Last updated: 2026-03-29

## Goal

Land the requested health registry adapter dedupe so protocol registry metadata is shared from `packages/contracts/src/health-entities.ts`, query projection uses the shared registry transform path, CLI descriptor/service wiring reuses shared registry definitions, and focused protocol regression coverage proves the shared path.

## Scope

- `packages/contracts/src/health-entities.ts`
- `packages/query/src/{canonical-entities.ts,health/registries.ts}`
- `packages/cli/src/{health-cli-descriptors.ts,usecases/explicit-health-family-services.ts}`
- `packages/query/test/health-registry-definitions.test.ts`
- `packages/cli/test/health-descriptors.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Preserve on-disk storage formats.
- Preserve existing protocol canonical self-link behavior for `protocolId`.
- Keep the change bounded to shared registry adapter metadata and duplicate adapter logic removal.
- Preserve overlapping unrelated dirty edits, especially current `packages/query/**` and `packages/cli/src/usecases/explicit-health-family-services.ts` work.

## Plan

1. Add protocol frontmatter/payload/command/relation metadata to the shared contracts registry definition, plus shared compatibility relation metadata where needed.
2. Rebase query canonical-link and record-projection helpers onto shared registry metadata instead of protocol-only fan-out and projection code.
3. Rebase CLI descriptor and explicit health-family service wiring onto shared registry definitions, including protocol.
4. Add focused regression tests for protocol shared metadata and CLI shared-definition reuse.
5. Run targeted checks, then required completion-workflow audits and final repo checks.

## Verification

- Targeted TypeScript/type-aware test commands for changed packages.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion-workflow audit passes: `simplify`, `task-finish-review`.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
