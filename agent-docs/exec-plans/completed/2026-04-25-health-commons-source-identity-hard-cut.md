# Hard-cut Health Commons source identity schema

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Remove remaining source-identity backward-compatibility paths after the initial patch landing so Health Commons source data uses the new typed identity/appraisal surfaces directly.

## Success criteria

- Legacy source metadata and appraisal compatibility surfaces related to the new source-identity model are removed or migrated.
- Local Health Commons content still generates and validates under the hard-cut schema.
- Contracts and Health Commons tests cover the hard-cut behavior.
- Required verification and completion reviews pass.
- A scoped commit lands if the working tree allows a safe task-only commit.

## Scope

- In scope:
- `packages/contracts/src/health-commons.ts`
- `packages/contracts/test/health-commons.test.ts`
- `packages/contracts/generated/frontmatter-experiment.schema.json`
- `packages/health-commons/src/**`
- `packages/health-commons/test/**`
- directly related `packages/health-commons/content/**` migrations if needed
- `apps/web/src/lib/health-commons/**` and focused tests for the Health Commons experiment projection if source-local appraisals are removed
- Health Commons research prompt references that still tell future content to emit source-local `protocolEvidence`; the already-dirty `scripts/research-init.test.ts` fixture is out of this commit scope to avoid sweeping unrelated research-tooling edits.
- this active plan and coordination ledger row
- Out of scope:
- unrelated Health Commons research/content lanes and generated catalog churn outside verification artifacts
- hosted runtime, app UI, assistant, wearable, and other active ledger rows

## Constraints

- Technical constraints:
- Preserve package boundaries and existing Health Commons load/catalog/build patterns.
- Treat `packages/health-commons/generated/**` as ignored build output unless a tracked generated contract artifact must be updated.
- Product/process constraints:
- Preserve unrelated dirty-tree work and active ledger rows.
- Do not write local personal identifiers, local absolute paths, secrets, or raw private identifiers into code, docs, logs, or commit text.

## Risks and mitigations

1. Risk: removing compatibility for existing content breaks generation.
   Mitigation: scan content for legacy fields first, migrate any remaining instances, then run generation and coverage.
2. Risk: hard-cutting source-local appraisal data too broadly removes useful current content semantics.
   Mitigation: only remove compatibility where a direct typed replacement exists and keep intentionally current schema surfaces unless the code scan shows they are legacy-only.
3. Risk: generated output churn overlaps active Health Commons research rows.
   Mitigation: use generated artifacts for verification only unless tracked files require updates.

## Tasks

1. Inspect current contracts/load/catalog/build code for remaining legacy or compatibility paths. Done.
2. Remove or migrate source-identity-related legacy surfaces. Done.
3. Update focused tests and generated contract schema. Done.
4. Run Health Commons/contracts verification plus workspace typecheck/smoke as needed. Done.
5. Run required completion reviews. Pending.
6. Close the plan and land a scoped commit. Pending.

## Decisions

- Treat `sourceIdentity` as optional for source pages; the hard cut is for legacy compatibility surfaces, not forcing every source artifact to declare canonical identity immediately.
- Source-local `protocolEvidence` is no longer accepted in page frontmatter. Existing authored blocks were migrated into standalone `evidence_appraisal` JSONL records under `content/evidence-appraisals/source-protocol-evidence/`.
- `scripts/research-init.test.ts` still contains an old fixture string but was already dirty under a separate research-tooling lane, so this task leaves it out of scope rather than mixing rows.

## Verification

- Passed:
- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons test:coverage`
- `pnpm --dir packages/contracts test:coverage`
- `pnpm --dir packages/health-commons generate:check`
- focused hosted-web Health Commons Vitest run for experiment detail/protocol projection files
- `pnpm typecheck`
- `pnpm test:smoke`
- `pnpm --dir apps/web verify:parallel`
- `git diff --check`
- Failed, unrelated:
- `bash scripts/workspace-verify.sh test:diff ...` expanded through reverse dependents into `packages/assistant-engine` and failed on a brittle Health Commons list assertion expecting the red-light protocol inside the first 10 protocols. The current catalog now includes the newly landed Digital Sunset protocol, shifting that list; the failure is outside this task's owned files.
Completed: 2026-04-25
