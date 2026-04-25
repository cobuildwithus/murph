# Complete Tabata Health Commons research and land content

Status: completed
Created: 2026-04-24
Updated: 2026-04-25

## Goal

- Complete the existing Tabata 20/10 interval training Health Commons research workflow from the current post-discovery state through final landing.
- Land an evidence-disciplined Health Commons family/protocol/source/artifact package for `tabata-interval-training` / `tabata-20-10-interval-training`.

## Success criteria

- Existing discovery outputs are treated as the source of truth and later seams are run or locally materialized without duplicating completed discovery threads.
- The final landed package includes authored family, protocol, source, artifact-manifest, and change-log content with deterministic generated catalog updates.
- Claims are conservative, source-keyed, and keep original Tabata lab cycling, practical 20/10 adaptations, generic HIIT/SIT, Wingate, Norwegian 4x4, and clinical/safety-only evidence separate.
- Health Commons generation/checks and the scoped repo verification lane are run, with unrelated failures documented if the dirty worktree blocks full acceptance.
- The active plan is closed through the repo finish path and a scoped commit is created when safe.

## Scope

- In scope:
  - `output-packages/research/tabata-20-10-interval-training/**` later-stage prompt/command/results artifacts.
  - `packages/health-commons/content/**` Tabata family/protocol/source/artifact/change files.
  - Directly coupled `packages/health-commons/generated/**` catalog outputs.
  - Focused Health Commons tests or schema fixtures only if required by the landed content.
- Out of scope:
  - Apps/web UI changes, generic experiment-card layout work, and unrelated Health Commons protocol families.
  - Changing research orchestration tooling beyond this workspace's concrete prompt/command files.
  - Committing ignored research workspace artifacts unless repo policy or an explicit user request changes that.

## Constraints

- Technical constraints:
  - Preserve all unrelated dirty work in the shared checkout.
  - Do not commit large PDFs or copyrighted full-text artifacts; use manifests and source pages.
  - Do not expose local account paths or direct personal identifiers in committed files.
- Product/process constraints:
  - Follow the Health Commons research skill workflow and prefer normalized workspace downloads over prose logs.
  - Keep safety language stronger than efficacy where evidence is thin or adjacent.
  - Use the existing repo completion workflow for verification, audits, plan closure, and commit.

## Risks and mitigations

1. Risk: Tabata is overloaded between original lab cycle protocol, popular bodyweight circuits, generic HIIT, SIT/Wingate, and public fitness copy.
   Mitigation: Keep source roles and protocol boundaries explicit in the ledger, source pages, and protocol claims.
2. Risk: The dirty checkout contains many active rows and overlapping generated Health Commons artifacts.
   Mitigation: Stage/commit only the Tabata-owned authored files, generated files directly produced from them, plan, and ledger closure artifacts.
3. Risk: Later research seams may be long-running or template-only.
   Mitigation: Materialize concrete prompts and wrappers from templates, run `review:gpt` seams where needed, and recover from normalized downloads/thread exports.

## Tasks

1. Validate completed discovery artifacts and identify gaps.
2. Materialize and run snowball/gap-fill.
3. Run source-ledger reducer and create extraction batches.
4. Run extraction, section synthesis, page builder, QA, and final reducer.
5. Land authored Health Commons content and generated outputs.
6. Verify, run required completion workflow, close plan, and commit.

## Decisions

- Existing normalized discovery files under `downloads/*/source_candidates_v1.json` are valid completion evidence for the discovery tranche.
- The landed package will use `experiment_family:tabata-interval-training` and `protocol_variant:tabata-interval-training/tabata-20-10-interval-training`, matching the materialized charter workspace.
- The source-ledger reducer produced 268 canonical sources, 265 extraction records, and 15 themed extraction batches; the user confirmed continuing with all 15 is acceptable after asking why the fanout was that large.
- Extraction sends were distributed across the lower-tab `eragon` and `phlebas` browser lanes; harvests should continue with controlled concurrency because other research wakes are active in the shared browser pool.
- Source extraction is complete across all 15 reducer batches with 502 total atomic findings and 257 artifact candidates; two broad boundary batches (`batch-012`, `batch-014`) use conservative local fallback artifacts after original and retry model seams completed without downloadable files.
- Local dry-build validation of the page-builder zip found a mechanical Health Commons parser blocker: the generated frontmatter uses same-line object array items (for example `- type: ...`) that must be normalized to the repo-compatible multi-line style before landing. The package also does not include a `content/changes` record, so landing must add one.
- Further local dry-build probes found schema/catalog blockers to resolve in final landing: invalid page-quality value `limited`, one overlong source title, duplicate source keys already present in other source directories, mismatched protocol `researchLandscape` group ids versus source `protocolEvidence` group ids, and non-existent `endpointKeys` values.
- Evidence QA failed with a ChatGPT `Thinking failed` response; safety QA completed with blocker findings. Final landing therefore applied the safety QA replacements plus local deterministic schema/catalog checks instead of waiting on a failed evidence-QA seam.
- Final review found an empty `researchLandscape.groups` list. The protocol now lands explicit source-keyed groups for original 20/10 cycling, practical 20/10 variants, adjacent HIIT/SIT boundary evidence, definitions/taxonomy, public Tabata-style claims, wearable/recovery context, and safety boundaries.

## Verification

- Passed:
  - `pnpm --filter @murphai/health-commons generate`
  - `pnpm --filter @murphai/health-commons generate:check`
  - `pnpm --filter @murphai/health-commons artifacts:r2:dry-run`
  - `pnpm --dir packages/health-commons test:coverage` (9 files, 21 tests)
  - `pnpm --filter @murphai/health-commons typecheck`
  - `node --check scripts/run-with-workspace-artifact-lock.mjs`
  - `MURPH_WORKSPACE_ARTIFACT_LOCK_HELD=1 node scripts/run-with-workspace-artifact-lock.mjs "tabata final proof" -- node -e "process.exit(0)"`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `git diff --check` over the Tabata-owned paths
  - Privacy scan over Tabata-owned paths for local account/home identifiers found no matches.
- Completion audits:
  - `security-privacy-review`: no blocking findings; noted residual clinical-review/evidence-QA risk and future R2 rights-review discipline.
  - `coverage-write`: no additional coverage required; no edits.
  - `task-finish-review`: one medium finding on empty research groups; fixed before final verification.
Completed: 2026-04-25
