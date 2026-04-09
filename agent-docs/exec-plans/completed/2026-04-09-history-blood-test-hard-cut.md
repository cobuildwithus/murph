# Hard-cut query history and keep blood-test as a projected event view

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Remove `history` as a first-class query/read-model family and CLI noun, keep blood tests canonical as `kind: "test"` event-ledger records, and preserve a user-facing `blood-test` surface as a projected event view over the shared query projection.

## Success criteria

- No `history` query family, model view, timeline entry type, export-pack health bucket, or CLI noun remains in the built surface.
- `ledger/events/**` continues to be the only canonical event-like storage, including blood tests.
- `blood-test list|show` reads from the shared query projection instead of direct file-scanning narrow readers.
- Search, timeline, export-pack, and query selectors consume the same projected event source without a parallel `history` collector path.
- Required verification and the required final audit pass complete, plus one direct scenario proof for blood-test reads through the built CLI.

## Scope

- In scope:
- Remove query-side `history` family ownership and rewire blood-test selectors onto projected `event` entities.
- Remove history CLI/service wiring and rewrite user-facing health command/docs references.
- Simplify export-pack/timeline/search surfaces so event-ledger records project once and read many ways.
- Out of scope:
- Changing the canonical event write model for blood tests.
- Introducing a separate canonical blood-test storage family or Markdown-backed blood-test documents.

## Constraints

- Technical constraints:
- Preserve unrelated worktree edits and port carefully on top of live profile-hard-cut changes.
- Greenfield hard cut: breaking `history` compatibility is acceptable.
- Keep blood-test detection permissive on read (`testCategory` or known blood specimen type).
- Prefer one strict projection-backed read path over per-surface tolerant special cases.
- Product/process constraints:
- Blood tests remain user-facing as a dedicated noun/surface even though the underlying query family becomes `event`.
- `history` can be deleted outright; no compatibility alias is required.

## Risks and mitigations

1. Risk: `history` currently threads through query families, CLI descriptors, timeline/export-pack, and tests.
   Mitigation: cut the family centrally in query first, then sweep the downstream surfaces and full-text search for `history` family usage before verification.
2. Risk: overlapping in-flight CLI/usecase edits could make direct rewrites conflict-prone.
   Mitigation: keep query-core changes local first, delegate disjoint follow-up work, and port each overlap carefully from the current file state.
3. Risk: blood-test reads could accidentally regress from a user perspective while architecture simplifies underneath.
   Mitigation: keep the `blood-test` noun and DTO shape, add focused CLI/runtime proof, and preserve permissive blood-test classification on reads.

## Tasks

1. Add an active coordination-ledger row and keep this plan updated as the source of truth for the hard cut.
2. Remove `history` from query canonical families, views, projection loading, and selector semantics.
3. Rewire blood-test selectors to derive from projected `event` entities.
4. Remove `history` CLI/service wiring and update user-facing command/docs references.
5. Rewire timeline, export-pack, and search-facing health/event usage onto the simplified event model.
6. Update docs and architecture/contracts text to describe the event-only model plus user-facing blood-test view.
7. Run required verification plus direct CLI proof, then the mandatory final audit pass, then commit with `scripts/finish-task`.

## Decisions

- Hard cut with no compatibility shim for `history`.
- Blood tests remain canonical event-ledger writes and become a dedicated projected view, not a canonical storage family.
- Keep permissive blood-test classification on read for greenfield simplicity and legacy-shaped data tolerance.
- Prefer one strict projection-backed read path; special tolerant export-pack health behavior should be removed if touched by this cut.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- focused direct scenario proof via built CLI for `blood-test list|show`
- Expected outcomes:
- All required commands pass on the final tree, or any unrelated pre-existing failure is documented with a defensible separation.

## Execution notes

- Query hard cut completed: health-history event kinds now project as `event`, export-pack/timeline consume the unified projection, and blood-test reads derive from projected event entities.
- CLI/usecase/contracts surface completed: the `history` noun is removed, `blood-test` remains user-facing, and generic reads normalize blood-like `event.kind === "test"` entities to `blood_test`.
- Verification completed:
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/query exec vitest run test/health-export-pack-blood-final.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/contracts typecheck`
- `pnpm --dir packages/contracts exec vitest run test/public-entrypoints.test.ts test/time-validate-command-capabilities.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/cli build`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/cli exec vitest run test/health-tail.test.ts test/stdin-input.test.ts test/list-surface.test.ts test/search-runtime.test.ts test/search-command-coverage.test.ts test/export-sample-helper-coverage.test.ts test/incur-smoke.test.ts test/cli-expansion-provider-event-samples.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/vault-usecases typecheck`
- `pnpm --dir packages/vault-usecases exec vitest run test/health-cli-public-seams.test.ts test/helpers-public-seams.test.ts test/record-service-coverage.test.ts --no-coverage --maxWorkers 1`
Completed: 2026-04-09
