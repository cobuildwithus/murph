# Remove retired public goal page reader

## Scope

Resolve accepted ReviewGPT round-one finding for PR 4218: remove the unused detailed public goal-page reader, its runtime export/package subpath, and the Web TypeScript alias. Preserve the authored corpus, generated formats/artifacts, generator validation, shared readers, and compact goal index used by the CLI and assistant.

## Evidence and work

- Parent accepted the narrow complexity-collapse finding and authorized remediation.
- Repository-wide search found no production consumer of the detailed page loader after microsite removal.
- Remove only page-loader assertions; retain generated page/content validation and compact-index validation.
- Run goal-artifacts and full-catalog knowledge tests, CLI commons and goal-save tests, Health Commons/CLI/Web typechecks, complexity, and diff/privacy checks.
- Parent owns round-two review and CI on the new head. First-reviewed head remains `e46a9957a62523e00a0594a7aaf5e366ec48cb41`.

## Result

Ready. The 190-line detailed page runtime is deleted; runtime reexports only the existing compact-index readers. The package subpath and Web alias are removed. No corpus, generator, artifact format, shared reader, or compact-index implementation changed.

- `goal-artifacts` and `knowledge-index-full-catalog`: 71 tests passed.
- CLI `commons-command-coverage` and `health-goal-save`: 28 tests passed, including successful saves and stale/missing lineage rejection before writes.
- Health Commons, CLI, and Web typechecks passed.
- Complexity guard, documentation drift, diff whitespace, and added-line privacy checks passed.
- Existing runtime complexity hotspots are unchanged; their unrelated validation logic was preserved.

Status: completed
Updated: 2026-10-19
Completed: 2026-10-19
