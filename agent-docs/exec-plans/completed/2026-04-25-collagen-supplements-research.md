# Run collagen supplementation Health Commons research

Status: completed
Created: 2026-04-25
Updated: 2026-05-06

## Goal

- Run a Health Commons research workflow for collagen supplements, starting with a charter that defines the right family/protocol boundary for user-facing supplement use.
- Success means the workspace has a coherent charter, generated post-charter seams, completed discovery/reducer/extraction/section/page/QA/final-reducer phases, and a verified Health Commons content landing for the bounded starter protocol.

## Success criteria

- Research workspace exists under `output-packages/research/collagen-supplementation/**`.
- `01-charter` is sent, harvested, and saved to `responses/01-charter.md`.
- Charter keeps overloaded collagen modalities separate unless it gives a concrete evidence reason to merge them.
- If the charter is coherent, `pnpm research:materialize --workspace output-packages/research/collagen-supplementation` generates later seams.
- Direct readback confirms `workflow.json`, final reducer artifacts, and generated content package are internally consistent.
- The final reducer diff applies cleanly and the Health Commons generation/check/dry-run commands pass or any unrelated blocker is recorded.

## Scope

- In scope:
  - New research workspace for collagen supplementation.
  - Initial family/variant scoping, charter, and materialized research commands.
  - Final Health Commons content pages returned by the completed reducer for the bounded starter protocol.
- Out of scope:
  - Editing live Health Commons content outside the reducer-returned package.
  - Committing regenerated `packages/health-commons/generated/**` artifacts unless explicitly required by the verification lane.
  - Touching existing active Tabata, digital-sunset, skin-PBM, HBOT, or generated-catalog lanes.
  - Collapsing hydrolyzed collagen peptides, undenatured type-II collagen, gelatin/tendon-loading, bone broth, topical/injectable collagen, and clinical wound-care nutrition unless the charter explicitly supports that boundary.

## Constraints

- Technical constraints:
  - Use the repo research orchestrator commands and workspace-specific review:gpt config.
  - Prefer an idle managed browser lane; avoid disrupting currently running long research harvests.
  - Preserve unrelated dirty work in the shared checkout.
- Product/process constraints:
  - Keep safety language stronger than efficacy language where evidence is mixed or thin.
  - Keep claims evidence-led, conservative, and source-bound.
  - Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: "Collagen supplements" conflates several interventions with different mechanisms and evidence.
   Mitigation: Treat this as a family plus starter variant; require the charter to preserve adjacent exclusions.
2. Risk: Existing active Health Commons/generated-output work overlaps later landing files.
   Mitigation: Keep this lane in `output-packages/research/**` until landing is evidence-ready and coordinated.
3. Risk: Long model seams may look stalled while still running.
   Mitigation: Use the workspace harvest/wake commands and their normal long timeout budgets.

## Tasks

1. Initialize the collagen supplementation workspace. Done.
2. Send and harvest `01-charter` on an idle managed lane. Done.
3. Review the charter for modality boundaries and safety coverage. Done.
4. Materialize post-charter seams if the charter is coherent. Done.
5. Record verification/readback and next steps. Done.
6. Run discovery fanout and harvest source-candidate artifacts. Done.
7. Complete source-ledger, extraction, section synthesis, page builder, evidence QA, safety QA, and final landing reducer. Done.
8. Apply the final reducer diff and run Health Commons verification. Done.

## Decisions

- Use `collagen-supplementation` as the provisional family and workspace slug.
- Charter resolved the starter protocol as `hydrolyzed-collagen-peptides` under family `collagen-supplementation`.

## Current state

- Workspace: `output-packages/research/collagen-supplementation`
- Charter thread: `https://chatgpt.com/c/69ec2fd3-56d8-839d-8cd7-8d8a7c64870b`
- Charter harvest: completed; recovered inline charter text with no attachments.
- Resolved identity: family `collagen-supplementation`, starter protocol `hydrolyzed-collagen-peptides`.
- Post-charter seams: materialized.
- Discovery sends:
  - `02` through `09` completed on staggered managed lanes.
  - `10-discovery-registries-unpublished` initially failed on `vonneumann` with a Pro model-selection warning; per the research workflow recovery rule, the failed logs were preserved and the seam was retried once on another lane.
  - `10-discovery-registries-unpublished` retry on `phlebas` completed and recorded thread `https://chatgpt.com/c/69ec464a-31e8-839b-9067-11e02e010070`.
- Discovery, source-ledger, extraction batches, section synthesis, page builder, evidence QA, safety QA, and final landing reducer are complete.
- Final reducer artifacts: `output-packages/research/collagen-supplementation/downloads/34-final-landing-reducer/downloads/`
- Final diff: `output-packages/research/collagen-supplementation/downloads/34-final-landing-reducer/downloads/final-unified.diff`
- Final reducer summary: 310 added content files, including 304 collagen source pages, 3 biomarker pages, one artifact manifest, one family page, and one hydrolyzed-collagen-peptides protocol page. No PDFs committed.
- Current repo step: bounded content package is applied and verified; close/commit the active plan only when the shared dirty ledger scope is safe.

## Verification

- Commands to run:
  - `git diff --check -- agent-docs/exec-plans/active/2026-04-25-collagen-supplements-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - Direct readback of `workflow.json`, `responses/01-charter.md`, and generated command list.
- Expected outcomes:
  - No whitespace/privacy leakage in touched tracked planning files.
  - Research workspace state matches the current seam phase.

Results:
- `01-charter` send and harvest completed.
- `pnpm research:materialize --workspace output-packages/research/collagen-supplementation` succeeded.
- All research phases through final landing reducer completed.
- `git apply --check output-packages/research/collagen-supplementation/downloads/34-final-landing-reducer/downloads/final-unified.diff` passed before applying.
- Privacy scan of the final diff did not find local path/account, redaction placeholder, bearer-token, or authorization-header strings.
- Final reducer diff was applied to Health Commons content with no PDFs committed.
- Added source-protocol evidence appraisal edges for all landed collagen research-landscape source references so the generator can validate the protocol evidence graph.
- Removed the duplicate FDA dietary-supplement Q&A source by retargeting references to the canonical FDA dietary-supplement source.
- `pnpm --filter @murphai/health-commons generate` passed.
- `pnpm --filter @murphai/health-commons generate:check` passed.
- `pnpm --filter @murphai/health-commons artifacts:r2:dry-run` completed; expected rights-policy blocks were reported for non-redistributable artifacts, with no structural failure.
- `pnpm --filter @murphai/health-commons typecheck` passed.
- `pnpm --filter @murphai/health-commons test:vitest` passed after updating the deterministic protocol-order fixture for the new collagen protocol.
- `git diff --check -- <touched health-commons content/test/planning files>` passed.
Completed: 2026-05-06
