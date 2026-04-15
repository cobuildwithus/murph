## Goal (incl. success criteria)

- Remove the local `pdftotext` parser and every repo-owned production surface that configures, installs, advertises, or depends on it.
- Preserve raw-PDF multimodal routing and keep the assistant `web.pdf.read` capability unchanged.
- Leave the repo with truthful parser/setup/hosted docs, contracts, tests, and generated CLI artifacts.

## Constraints / Assumptions

- Treat this as a hard cut, not a deprecated compatibility shim.
- Do not remove `web.pdf.read` or `pdfjs-dist`; that web-only PDF reader stays in scope.
- Preserve unrelated in-flight edits in the worktree, especially overlapping `packages/assistant-engine/**` rows already active in the coordination ledger.

## Key decisions

- PDFs will no longer have a local text-extraction provider in the parser registry.
- Hosted/local setup flows will stop provisioning `pdftotext` and stop exposing `PDFTOTEXT_COMMAND`.
- The hosted runner smoke will stop asserting PDF local extraction and will keep audio/parser proof only.

## State

- Implementation complete; closeout and scoped commit pending.

## Done

- Confirmed the live `pdftotext` surface spans parser registry/config, inbox bootstrap/setup contracts, setup provisioning, CLI flags/generated config artifacts, hosted runner env/image policy, docs, and tests.
- Confirmed the user wants to keep the separate `web.pdf.read` capability.
- Removed the local `pdftotext` parser provider, setup/bootstrap/config/env wiring, hosted runner dependencies, and repo docs/scripts that advertised the local PDF text extractor.
- Regenerated the CLI schema/types and updated affected parser/setup/hosted/test fixtures.
- Cleaned the remaining optional `parserProviderId: null` fixture noise after the hard cut.
- Verified targeted lanes: `packages/setup-cli` tests, targeted `packages/cli` inbox-model/setup cases, targeted `packages/parsers` shared tests, and targeted `packages/assistant-engine` automation tests all pass.

## Now

- Record final verification blockers, then finish the scoped commit flow for this lane only.

## Next

- Hand off the unrelated verification blockers from the broader workspace lanes if they remain red at closeout.

## Open questions

- `pnpm typecheck` is currently blocked by an unrelated `packages/vault-usecases` type mismatch in `src/usecases/integrated-services.ts` where the returned meal-add result omits `source`, `ingredients`, and `nutrition`.
- The full `packages/cli` source suite currently reports two follow-on failures that call `pnpm build:test-runtime:prepared` and therefore inherit the same unrelated workspace-typecheck blocker.
- The full `packages/cli` source suite also showed one `assistant-service` failure that did not reproduce when rerun in isolation.

## Working set (files / ids / commands)

- `packages/parsers/**`
- `packages/inbox-services/**`
- `packages/operator-config/**`
- `packages/setup-cli/**`
- `packages/cli/**`
- `apps/cloudflare/**`
- `Dockerfile.cloudflare-hosted-runner`
- repo docs/scripts mentioning `pdftotext` or `PDFTOTEXT_COMMAND`
- Verification: `pnpm --dir packages/setup-cli test`, `pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/inbox-model-route.test.ts packages/cli/test/inbox-model-harness.test.ts --no-coverage`, `pnpm --dir packages/parsers test -- shared.test.ts`, `pnpm --dir packages/assistant-engine test -- assistant-automation-prompt-builder.test.ts assistant-automation-support.test.ts assistant-automation-runtime.test.ts`, `pnpm typecheck`, `pnpm --dir packages/cli test:source`
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
