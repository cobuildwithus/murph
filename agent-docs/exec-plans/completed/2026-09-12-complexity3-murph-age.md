# Remove the active Murph Age feature

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

- Retire active Murph Age runtime APIs, calculators, browser adapters, CLI commands, and current operating docs while preserving saved health records, neutral health mechanics, and historical research.

## Success criteria

- ReviewGPT authors a complete applicable removal patch and focused public-boundary tests.
- All nine age commands disappear from runtime registration, discovery, and generated schemas; dedicated package APIs and aliases are removed.
- Surviving metric/query/CLI behavior, build/typecheck, focused tests, generated artifacts, changelog, privacy, and complexity checks pass before parent review.

## Scope

- In scope: six dedicated source owners, eight dedicated test files, feature-only sections of mixed tests, package exports, CLI manifest and generated artifacts, aliases, obsolete bundle marker cases, current research owner/index, and a retirement changelog fragment.
- Out of scope: completed plans, historical reports, mixed release history, ignored datasets/scripts, local artifact deletion, canonical records, shared metric primitives, and unrelated PR features.

## Constraints

- ReviewGPT implements source/tests; local integration applies its returned patch and runs canonical generation and verification.
- The earlier validator-refactor prompt and completed Pro patch are superseded and must not be applied.
- Baseline: `486a6595e51bff2a6cfa64beb4ee1a953854a8b6`.
- Parent owns submission/download, candidate review, Ready admission, final ReviewGPT, merge, and completion; use the original session wait.
- Preserve independently owned PR #2629 wearable-view/seven-day-query changes in shared manifests, generated outputs, barrels, and docs.

## Risks and mitigations

1. Wholesale mixed-file deletion could remove neutral health tests or other commands.
   Mitigation: delete only dedicated owners wholesale; inspect mixed imports, tests, and shared fixtures.
2. Removed commands could survive in generated schema/types or export maps.
   Mitigation: native CLI regeneration, public removal assertions, package builds, and reference inventory.
3. Research retirement could remove private/local evidence or admit ignored scripts into checks.
   Mitigation: preserve historical artifacts and git/vercel/test/typecheck exclusions; remove readers only.
4. Concurrent work could be lost in shared manifests or generated files.
   Mitigation: preserve unrelated hunks and regenerate from final reconciled source rather than replace whole outputs.

## Tasks

1. Prepare ignored `audit-packages/implementation-murph-age-removal-prompt.md`; parent sends a fresh Pro thread.
2. Await the downloaded `complexity3-murph-age-removal.patch`; inspect privacy, scope, deletion list, and applicability.
3. Integrate Pro removal, run native generation and focused proof, then inspect the complete candidate.
4. Add actual PR provenance to the authored retirement fragment when known, record evidence, close the plan through the normal finish wrapper, and hand stable candidate to parent.

## Decisions

- Active feature/current docs retire; historical reports, completed plans, mixed release history, and ignored data remain.
- No live Web feature route or database migration was found; no data cleanup is part of code removal.
- The public CLI capability retirement merits a content-only changelog entry, with no invented replacement or medical claims.
- Preserve all neutral catalog/MetricPoint/normalization/selector/series/goal/browser/biomarker behavior and general demographic age/sex.

## Verification

- Native CLI generation: `pnpm --dir packages/cli gen:config-schema`; inspect schema, incur types, and skill hash.
- Build and typecheck health-metrics, query, and CLI because public exports change.
- Focused health-metrics suite plus query browser surface, CLI smoke/routing/schema, assistant CLI bootstrap, and Cloudflare bundle-entrypoint tests with at most two workers.
- Generate and test changelog fragments/page; Web typecheck. Use the content-only archive presentation exception.
- `pnpm complexity:diff --base 486a6595e51bff2a6cfa64beb4ee1a953854a8b6`, `git diff --check`, remaining-reference and privacy inspection.
- Exact-head CI and final ReviewGPT remain parent-owned completion gates.

## Implementation and proof evidence

- GPT-6 Pro authored the removal patch. The applied attachment digest is `8419e17884257c56b51ba5c5bd072c5661893ade8d706ea1c2aec7f0c86928bd`; the earlier refactor patch remains superseded and unapplied.
- The main patch deletes six dedicated source owners, eight dedicated tests, and the current research operating doc. No historical plans/reports, mixed release history, ignored data, or protective exclusions were changed.
- AST source-span comparison confirms all 31 surviving neutral tests in health-metrics/index are byte-identical to baseline; 27 feature-specific tests were removed.
- Native CLI generation regenerated configuration schema, Incur types, and skill hash. The schema/types matched the supplied mechanical removals; the hash was refreshed from the actual generated CLI.
- Focused proof passed: health-metrics 55 tests; query export/browser surface 3; runtime-state timing 18; assistant CLI bootstrap and timing transport 30; runner-bundle admission 43; CLI smoke/routing/input-schema/generator 138; documentation scope 10.
- Health-metrics, query, CLI, and runtime-state typechecks passed; health-metrics, query, and CLI builds passed. Web typecheck passed with generated prerequisites. Package builds/typechecks and focused suites used one checker/worker.
- Main-patch complexity guard passed: 150 points of deleted-owner debt removed; no hotspots remain in the changed surviving source files.
- Applied the final Pro-authored six-line assistant-filter deletion (attachment SHA256 `8ffbac6eac03584f691977e92ffe25ca073ab63b97e1daeeca0304f193da8cd7`). The focused bootstrap suite passed all 23 tests again, and assistant-engine typecheck passed.
- Changelog fragment/page proof passed 17 tests; the complete focused matrix contains 314 distinct tests.
- The actual 334-command CLI manifest contains no age commands. The assistant contract before and after filter cleanup is byte-identical: 6,881 bytes, SHA256 `199d42aa78148d55a5f904cf09838bdc4fe25f10acf47a4ba4e3c2edcd157bad`.
- Final working-tree complexity proof covers ten changed source files, removes 150 points of debt, and reports no current changed-source hotspots.

## Product UX walkthrough

- Effort: Product change.
- CLI discovery no longer exposes age commands. Direct calls to the group and each former leaf return the existing COMMAND_NOT_FOUND response.
- Existing saved health records and generic metric, query/browser, wearable, lab, goal, and experiment mechanics remain. The complete surviving health-metrics suite passes.
- The retirement note is content-only, uses the existing changelog archive presentation, and makes no replacement or data-deletion claim.
- Result: Ready for parent candidate review. All selected journeys and focused checks pass; parent owns final review and exact-head CI.

## Implementation handoff

- Draft PR #3370 contains the two verified Pro-authored patches, canonical CLI generated artifacts, and the retirement note with its actual PR provenance.
- Local integration is complete and focused evidence is green. Parent owns candidate review, Ready admission, final ReviewGPT, exact-head CI, and merge.
Completed: 2026-09-12
