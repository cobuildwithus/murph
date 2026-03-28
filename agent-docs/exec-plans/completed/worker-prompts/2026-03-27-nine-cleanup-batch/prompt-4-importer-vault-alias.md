Murph cleanup lane: do a behavior-preserving simplification pass on repeated `vaultRoot` and legacy `vault` alias handling in importer entrypoints.

Ownership:
- Own `packages/importers/src/{shared.ts,document-importer.ts,meal-importer.ts,csv-sample-importer.ts,assessment/import-assessment-response.ts,device-providers/import-device-provider-snapshot.ts}`.
- Own direct coverage in `packages/importers/test/{importers.test.ts,input-validation.test.ts,device-providers.test.ts}`.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Follow the completion workflow as far as your lane can: implement, simplify, add or adjust direct coverage, run the narrowest truthful verification, and report any remaining gaps.
- If your environment supports spawned audit subagents, run the required `simplify`, `test-coverage-audit`, and `task-finish-review` passes using the prompts under `agent-docs/prompts/`.

Relevant code:
- `packages/importers/src/document-importer.ts`: `prepareDocumentImport`
- `packages/importers/src/meal-importer.ts`: `prepareMealImport`
- `packages/importers/src/csv-sample-importer.ts`: `prepareCsvSampleImport`
- `packages/importers/src/assessment/import-assessment-response.ts`: `prepareAssessmentResponseImport`
- `packages/importers/src/device-providers/import-device-provider-snapshot.ts`: `prepareDeviceProviderSnapshotImport`

Issue:
- Multiple importer entrypoints repeat the same external-input compatibility rule:
  - accept both `vaultRoot` and legacy `vault`
  - resolve the canonical write target with `request.vaultRoot ?? request.vault`
- Some files also duplicate schema fields for both aliases.
- This is the trust-boundary moment where loose external input becomes the canonical core write target, and it is repeated by hand.

Best concrete fix:
- Extract a very small shared helper in `packages/importers/src/shared.ts` or a similarly local shared file, for example `resolveVaultRootAlias({ vaultRoot, vault })`.
- Optionally extract a reusable zod schema fragment for the zod-based importers, but the resolver is the important part.
- Reuse it everywhere an importer boundary chooses the canonical `vaultRoot`.

Preserve:
- acceptance of both field names
- current precedence of `vaultRoot` over `vault`
- current validation and error wording as much as possible
- existing passthrough behavior for other fields

Do not invent a bigger importer framework. This should stay a tiny helper extraction with immediate reuse.

Tests to anchor:
- `packages/importers/test/importers.test.ts`
- `packages/importers/test/input-validation.test.ts`
- `packages/importers/test/device-providers.test.ts`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
