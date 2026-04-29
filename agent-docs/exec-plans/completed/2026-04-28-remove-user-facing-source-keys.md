# Remove User-Facing Source Keys

## Goal

Remove literal `source_artifact:*` source-key references from user-facing Health Commons copy while preserving structured source references needed by the catalog, source pages, and evidence graph.

Also harden the Health Commons research workflow and default prompts so future generated protocol, family, biomarker, and other user-facing prose uses readable citations or source-card references instead of exposing internal source keys.

## Scope

- `packages/health-commons/content/**` body copy where internal source keys are rendered as prose.
- Health Commons research skill and prompt templates that shape protocol, family, biomarker, and page-builder output.
- Direct validation/searches for leaked source-key prose.

## Out Of Scope

- Structured frontmatter, typed `sourceKeys`, `relations`, `sourceKey`, evidence appraisals, source artifact page keys, generated indexes, and tests that intentionally validate internal source-key graph behavior.
- Active long-running research workspace outputs under `output-packages/**`.
- Unrelated hosted runtime, assistant, Cloudflare, and active research-lane edits already present in the worktree.

## Current State

- Prose cleanup is applied across Health Commons family/protocol/biomarker fields found by source-key scans, including frontmatter fields rendered as copy.
- Research prompt hardening is applied to shared header, section synthesis, page builder, evidence QA, safety QA, final landing reducer, legacy `scripts/research.sh`, and the Health Commons research skill.
- Completion review findings are resolved: prompt/skill guardrails now include biomarker prose, and remaining rendered-copy references to internal provenance mechanics were replaced with user-facing evidence-section wording.
- Structured source-key fields, relations, source pages, evidence appraisals, and generated source graph references remain in place.
- Existing worktree is dirty with unrelated active rows.
- `.agents/skills/health-commons-research/SKILL.md` already had unrelated local edits; preserve them and patch additively.

## Verification Plan

- Targeted `rg` scans proving no literal user-facing `Source keys:` lines or bracket/parenthetical source-key dumps remain in Health Commons prose.
- Health Commons generation or focused package verification if touched content requires catalog proof.
- `pnpm typecheck` per repo policy, unless blocked by unrelated active work.

## Verification Results

- PASS: field-aware Health Commons family/protocol/biomarker prose scan reported `content_prose_leaks=0`.
- PASS: `pnpm --filter @murphai/health-commons generate`.
- PASS: `pnpm --filter @murphai/health-commons generate:check`.
- PASS: `pnpm --filter @murphai/health-commons typecheck`.
- PASS: `pnpm --filter @murphai/health-commons test`.
- PASS: `pnpm typecheck`.
- PASS: `git diff --check` for the touched source-key cleanup and prompt/skill paths.
- FAIL unrelated: scoped `test:diff` reached `packages/cli` release-audit tests and failed on pre-existing repo state: `agent-docs/exec-plans/active/2026-04-28-hosted-thin-runner-snapshot.md` has no matching coordination-ledger row, and `packages/hosted-execution/package.json` release validation expects `@murphai/core` in `bundleDependencies`.
- REVIEW: security/privacy review reported low-severity prose/prompt scope issues; fixed.
- REVIEW: task-finish review reported the same biomarker prompt scope gap; fixed.
- POST-REVIEW PASS: field-aware source-key prose scan reported `content_prose_leaks=0`.
- POST-REVIEW PASS: internal provenance term scan found only structured field names.
- POST-REVIEW PASS: `pnpm --filter @murphai/health-commons generate`.
- POST-REVIEW PASS: `pnpm --filter @murphai/health-commons generate:check`.
- POST-REVIEW PASS: `pnpm --filter @murphai/health-commons typecheck`.
- POST-REVIEW PASS: `pnpm --filter @murphai/health-commons test`.
- POST-REVIEW PASS: `pnpm typecheck`.
- POST-REVIEW PASS: `git diff --check` for the touched source-key cleanup and prompt/skill paths.
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
