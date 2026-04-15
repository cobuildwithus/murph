## Goal (incl. success criteria)

- Run a post-hard-cut cleanup sweep for the removed local `pdftotext` parser surface.
- Confirm there is no remaining repo-owned production residue and remove any low-risk stale test or fixture noise that is still tied to the deleted surface.
- Keep the separate `web.pdf.read` capability unchanged.

## Constraints / Assumptions

- Preserve unrelated in-flight edits already present in the worktree.
- Do not touch the active meal-add, Codex image, or prompt-behavior lanes except to avoid overlapping their files.
- Prefer narrow cleanups only; do not refactor adjacent systems unless the residue is directly tied to the hard cut.

## Key decisions

- Use subagents for parallel residue scans, then keep final write integration on the main lane.
- Treat `parserProviderId: null` fixture cleanup as acceptable only where the field is optional and not part of an explicit serialization contract.

## State

- Sweep complete; no additional residue changes required.

## Done

- Confirmed the prior hard-cut commit landed and removed the active `pdftotext` provider/setup/hosted surface.
- Ran local repo-wide scans for `pdftotext`, `PDFTOTEXT_COMMAND`, and `parserProviderId: null` across live `packages/`, `apps/`, `docs/`, `scripts/`, and `e2e/` surfaces with no remaining hits.
- Ran three parallel subagent scans:
  - live code/config residue scan: no concrete remaining residue
  - docs/scripts/e2e/install scan: no stale references; `web.pdf.read` intentionally remains
  - tests/fixtures scan: no remaining literal residue or optional fixture noise tied to the hard cut

## Now

- Close the no-op cleanup lane and commit the ledger/plan record only.

## Next

- None for this lane unless a future change reintroduces local PDF text-extraction wiring.

## Open questions

- None.

## Working set (files / ids / commands)

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/**`
- `apps/**`
- `docs/**`
- `scripts/**`
- repo-wide searches for `pdftotext`, `PDFTOTEXT_COMMAND`, and optional fixture noise linked to the removed parser
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
