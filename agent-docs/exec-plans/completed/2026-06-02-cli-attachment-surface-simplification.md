# CLI Attachment Surface Simplification

## Goal

Hard-cut two stale helper surfaces:

- remove `vault-cli intake raw`
- rename live assistant attachment model code away from old `inboxModel*` wording

Success means the CLI no longer exposes `intake raw`, assistant attachment naming reflects raw-path-first attachment evidence, and behavior stays unchanged for audio/video transcript evidence versus document/data-file raw path inspection.

## Constraints

- Preserve unrelated dirty hosted-runtime, hosted-local, and Murph Age work.
- Do not add compatibility shims for removed CLI surfaces.
- Do not change attachment behavior: parser evidence remains audio/video-only, while PDFs, CSVs, documents, and other inspectable files stay raw-path-first.
- Do not edit immutable completed plan snapshots except for generated or live references that are required by tests.

## Working Set

- `packages/cli/src/commands/intake.ts`
- `packages/cli/src/vault-cli-command-manifest.ts`
- `packages/cli/src/incur.generated.ts`
- `docs/contracts/03-command-surface.md`
- `ARCHITECTURE.md`
- assistant-engine attachment evidence/model contract files and related tests

## Verification Plan

- Focused residue searches for `intake raw` and live `inboxModel` naming.
- Package-local CLI and assistant-engine typecheck/tests or truthful `pnpm test:diff` coverage.
- Root `pnpm typecheck` unless blocked by known unrelated dirty hosted-local errors.
- Required completion audits for code touching user attachment/path evidence.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
