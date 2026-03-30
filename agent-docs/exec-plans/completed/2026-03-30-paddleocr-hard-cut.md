# 2026-03-30 PaddleOCR Hard Cut

## Goal (incl. success criteria)

- Remove PaddleOCR and PaddleX OCR from the active repo surface.
- Ensure parser discovery, CLI doctor/setup output, and host setup/install no longer expose Paddle-specific configuration or install steps.
- Remove or update docs, smoke fixtures, and tests so the repo no longer describes PaddleOCR as a supported local parser.

## Constraints / Assumptions

- Treat this as a hard cut, not a deprecated compatibility alias.
- Preserve existing local parsing for text files, PDFs, audio/video transcription, and image multimodal routing.
- Avoid widening into broader inbox or setup redesign beyond the removal fallout.

## Key Decisions

- Remove the Paddle provider from the default parser registry and toolchain discovery instead of leaving an unused adapter wired in.
- Remove setup-time OCR installation and the `--skipOcr` knob rather than keeping dead host-setup branches.
- Update repo-owned docs and fixtures in the same turn so the command surface and setup story stay truthful.

## State

- Verification complete; audit/closeout in progress.

## Done

- Confirmed PaddleOCR is still referenced in parser discovery, inbox bootstrap/setup command schemas, setup host provisioning, and multiple tests/docs.
- Confirmed the repo already hard-cut Paddle from PDF parsing and now uses `pdftotext` plus model-side raw-PDF fallback.
- Deleted the PaddleOCR adapter and removed paddle from parser discovery, default registry wiring, toolchain config names, inbox doctor/setup contracts, host setup provisioning, hosted runner env allowlists, install wrapper docs, and targeted tests/fixtures.
- Verified no live Paddle/PaddleX/`skipOcr` references remain outside the active plan, ledger row, and historical completed plans.
- Ran `pnpm typecheck` successfully.
- Ran focused Vitest for the changed parser/setup surfaces successfully.

## Now

- Run the required simplify and final-review audit passes, then close the plan/ledger and commit the scoped change.

## Next

- Record the repo-wide verification failures that remain outside this diff (`packages/cli/test/search-runtime.test.ts`, `packages/cli/test/cli-expansion-workout.test.ts`, and the coverage `.tmp` write failure) in handoff/commit context.
- Finish the required audit passes, remove the active ledger row, and commit with `scripts/finish-task`.

## Open Questions

- UNCONFIRMED: whether the required spawned audit passes will recommend any additional simplification or proof changes before commit.

## Working Set (files / ids / commands)

- `agent-docs/exec-plans/active/{2026-03-30-paddleocr-hard-cut.md,COORDINATION_LEDGER.md}`
- `packages/parsers/src/{index.ts,toolchain/{config.ts,discover.ts}}`
- `packages/cli/src/{commands/inbox.ts,inbox-cli-contracts.ts,inbox-services/parser.ts,inbox-app/bootstrap-doctor.ts,setup-cli.ts,setup-cli-contracts.ts,setup-services.ts}`
- targeted docs/tests/fixtures mentioning PaddleOCR or `skipOcr`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm exec vitest run packages/parsers/test/parsers.test.ts packages/cli/test/inbox-cli.test.ts packages/cli/test/inbox-incur-smoke.test.ts packages/cli/test/setup-cli.test.ts`
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
