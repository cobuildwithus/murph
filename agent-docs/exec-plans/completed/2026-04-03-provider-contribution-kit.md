# 2026-04-03 Provider Contribution Kit

## Goal (incl. success criteria)

- Land the supplied `murph-provider-contribution-kit.patch` as repo-native docs.
- Update the contribution-kit content so it reflects the current device architecture rather than the older snapshot wording.
- Add the new durable docs, template entrypoints, and README/index links without disturbing unrelated in-flight work.

## Constraints / Assumptions

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve unrelated dirty-tree edits, especially the in-flight `agent-docs/index.md` changes.
- Keep this turn docs/process-only and limited to Markdown edits.

## Key Decisions

- Port the contribution-kit guidance to the current shared device-provider descriptor surface in `@murphai/importers`.
- Document `@murphai/device-syncd/public-ingress` as the reusable callback/webhook seam for alternate HTTP surfaces.
- Keep verification on the Markdown-only docs fast path unless the scope expands beyond `.md` files.

## State

- Ready to close.

## Done

- Read the required repo routing docs and the docs/process verification guidance.
- Inspected the supplied patch and current `README.md`, `packages/device-syncd/README.md`, and `packages/importers/README.md`.
- Confirmed the repo already uses the shared provider-descriptor registry seam and updated device-sync package boundaries that the new docs must describe.
- Added the contribution-kit guide, compatibility matrix, and template entrypoints under `docs/`.
- Updated `README.md`, `packages/device-syncd/README.md`, `packages/importers/README.md`, and `agent-docs/index.md` to point at the new maintainer docs.
- Read back the touched Markdown files and checked the new in-repo references.
- Ran `pnpm typecheck` successfully.
- Ran `pnpm test`; the test suites passed but the command still exited non-zero because `apps/web/scripts/dev-smoke.ts` found a stale active Next dev smoke process (`pid 99173`, `port 64836`) during cleanup.

## Now

- Close the active plan and create the scoped docs commit.

## Next

- Hand off the landed docs plus the verification note about the unrelated hosted-web smoke cleanup failure.

## Open Questions

- None.

## Working Set (files / ids / commands)

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-03-provider-contribution-kit.md`
- `README.md`
- `agent-docs/index.md`
- `packages/device-syncd/README.md`
- `packages/importers/README.md`
- `docs/device-provider-contribution-kit.md`
- `docs/device-provider-compatibility-matrix.md`
- `docs/templates/README.md`
- `docs/templates/device-sync-provider.template.md`
- `docs/templates/device-provider-adapter.template.md`
- `/Users/willhay/Downloads/murph-provider-contribution-kit.patch`
- `pnpm typecheck`
- `pnpm test`
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
