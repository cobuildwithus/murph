# Complete typed CLI parity for agent-friendly incur command inputs

Status: completed
Created: 2026-04-26
Updated: 2026-04-26

## Goal

- Bring the agent-visible incur CLI command surface closer to typed parity with the existing JSON/import payload contracts, so agents can use explicit typed flags and positional args instead of relying on stdin JSON blobs for common health-data writes.

## Success criteria

- `protocol save` and `supplement save` expose typed flags for the remaining high-value metadata currently only available through JSON import, without removing the explicit import fallback commands.
- Experiment session logging can represent JSON-object confounders through typed CLI input.
- Sample writes can carry the remaining import/audit provenance fields that fit the single-sample typed path.
- The highest-value missing event kinds have typed `event <kind> add` leaves with shared common event options.
- Incur artifacts and agent command metadata are regenerated and match the source command tree.
- Focused CLI tests, package typecheck/shape checks, diff hygiene, and required completion audits are run or any unrelated blocker is recorded precisely.

## Scope

- In scope:
- `packages/cli/src/commands/{event,experiment,protocol,samples,supplement}.ts`
- Directly coupled CLI command manifest/schema/typegen artifacts.
- Focused CLI tests and command-surface docs for the typed parity additions.
- Out of scope:
- Replacing the explicit `*-json` / `import-json` fallback commands.
- Adding a generic typed representation for every raw event `links`, `rawRefs`, `attachments`, or lifecycle field.
- Cross-package health schema redesigns or new canonical storage shapes.
- Broad CLI command graph refactors unrelated to typed input parity.

## Constraints

- Technical constraints:
- Follow incur's canonical pattern: command args/options must be Zod-typed and discoverable through the real router tree.
- Preserve existing command names and aliases unless a test proves a conflict.
- Keep JSON/file/stdin import commands explicit fallback paths, not hidden primary agent workflows.
- Avoid `as any` and broad casts; parse CLI strings with narrow helpers or Zod schemas.
- Product/process constraints:
- Health-data inputs are sensitive. Do not log or fixture real personal identifiers, raw local paths, or private health records.
- Preserve unrelated dirty work in the shared checkout.
- Use implementation subagents in batches of five as requested, with disjoint write scopes where possible.

## Risks and mitigations

1. Risk: repeated/array CLI flags for nested structures become ambiguous.
   Mitigation: keep nested typed forms narrow and validated, and leave full raw payloads to explicit import commands.
2. Risk: generated incur artifacts drift from source commands.
   Mitigation: regenerate artifacts after integration and assert command metadata in focused tests.
3. Risk: active dirty CLI files include previous typed-input work and unrelated lanes.
   Mitigation: inspect diffs before each edit, scope workers to command families, and avoid reverting adjacent changes.

## Tasks

1. Spawn five implementation workers for protocol, supplement, experiment-session, samples, and event parity slices.
2. Integrate returned changes, resolve overlaps, and regenerate incur artifacts.
3. Update command manifest/docs/tests for new typed leaves and flags.
4. Run focused CLI verification, package typecheck/shape checks, and diff hygiene.
5. Run required security/privacy, coverage, and final-review completion audits.
6. Close or finish the plan; if a scoped commit is unsafe because of overlapping dirty work, record the blocker and close the plan without committing.

## Decisions

- Keep explicit JSON import commands for full-fidelity raw payloads; typed commands should cover common agent-friendly forms, not every low-level escape hatch.
- Treat relation-id flags as sufficient typed coverage for protocol/supplement relationship links unless implementation proves a distinct typed link surface is necessary.
- Keep `experiment plan`, `experiment start`, and `protocol profile upsert` as explicitly reviewed JSON-file payload surfaces because they are higher-order plan/profile import flows, not replacements for the common typed write commands.
- Validate `samples add --batch-source-file-name` as a basename-only value before persistence; the raw source artifact remains represented by `--source-path`.
- Wire `protocol profile upsert` through `VaultServices.core.upsertProtocolProfile` so manifest/service metadata matches the implementation.

## Verification

- Passed:
- Focused CLI Vitest suite covering changed command families: 15 files / 149 tests.
- Focused schema/smoke rerun after manifest binding fixes: 2 files / 62 tests.
- Focused samples/schema rerun after basename validation and cleanup: 2 files / 7 tests.
- Focused experiment/profile schema rerun after final docs/proof fix: 2 files / 19 tests.
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/vault-usecases typecheck`
- `pnpm --dir packages/cli verify:package-shape`
- `pnpm --dir packages/vault-usecases test -- --run test/runtime.test.ts --no-coverage` (package test invocation passed 17 files / 97 tests).
- `git diff --check -- <touched paths>`
- Required completion audits so far: simplify rerun no high/medium findings after fixes; security/privacy rerun no findings; coverage-write found no proof gap and made no edits.
- Scoped diff lane:
- Parent `bash scripts/workspace-verify.sh test:diff <touched paths>` passed CLI targeted verification (24 files / 369 tests), package typechecks, and `packages/vault-usecases` tests (17 files / 97 tests), then failed in unrelated active Health Commons generation before/inside apps/cloudflare verification: `protocol_variant:added-sugar-reduction/no-added-sugar-diet` source `source_artifact:fda-added-sugars-label-2026-03-04` lacks a matching evidence-appraisal edge.
- Repo-wide typecheck:
- `pnpm typecheck` is blocked by unrelated active Health Commons generated content: duplicate `source_artifact:pmid-28919842` across added-sugar and creatine source files.
Completed: 2026-04-26
