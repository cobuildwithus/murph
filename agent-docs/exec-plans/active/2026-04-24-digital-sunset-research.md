# Run Digital Sunset Health Commons research

Status: content landed; current verification passed
Created: 2026-04-24
Updated: 2026-04-27

## Goal

- Run a Murph Health Commons research workflow for a "Digital Sunset" protocol: no personal screens before bed.

## Success criteria

- A dedicated research workspace exists under `output-packages/research/digital-sunset`.
- The charter separates the direct screen-curfew protocol from red-light glasses, blue-light filter software, room-light redesign, broad sleep-hygiene bundles, CBT-I, shift-work protocols, and psychiatric virtual-darkness protocols.
- The charter treats the likely mechanisms honestly: evening light exposure, cognitive or emotional arousal, bedtime displacement, and routine stability.
- Discovery, reducer, extraction, synthesis, builder, and QA seams are run or an explicit blocker is recorded.
- No Health Commons family, protocol, source, artifact, or generated catalog pages are edited until the research package is evidence-ready.

## Scope

- In scope:
  - `output-packages/research/digital-sunset/**`
  - This active plan and its coordination-ledger row
  - Research prompts, local research artifacts, thread URLs, normalized downloads, and recovered responses for this protocol
- Out of scope:
  - Landing Health Commons content pages before the final research package is ready
  - Editing the existing red-light-glasses protocol
  - Broad sleep-hygiene, CBT-I, or device-settings product work

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree work.
  - Keep generated research files path-relative and do not hardcode local absolute paths.
  - Treat `output-packages/research/**` as the research source of truth during the run.
- Product/process constraints:
  - Prefer a low-burden, bounded self-experiment framing over moralized screen-discipline language.
  - Keep evidence language conservative, especially where studies bundle screens, light, bedtime, and broader sleep hygiene.

## Risks and mitigations

1. Risk: The protocol boundary merges screen curfew with red-light glasses or generic evening light reduction.
   Mitigation: Start with a direct "no personal screens before bed" charter and mark glasses, filters, and room lighting as adjacent variants.
2. Risk: Digital sunset evidence may be mostly bundled, observational, or pediatric.
   Mitigation: Require directness labels and preserve indirect evidence as context rather than efficacy claims.
3. Risk: The protocol can become shame-coded or too restrictive.
   Mitigation: Keep burden, social cost, exceptions, and stop conditions first-class in synthesis and onboarding.

## Tasks

1. Register the task in the coordination ledger.
2. Scaffold the `digital-sunset` research workspace.
3. Tailor the charter prompt for protocol boundaries, outcomes, confounders, and safety or burden concerns.
4. Run and harvest the charter.
5. Materialize post-charter prompts and commands.
6. Continue discovery, reduction, extraction, synthesis, builder, QA, and final reducer as the workflow allows.
7. Verify the generated workspace state and record blockers or outcomes.

## Decisions

- Use `digital-sunset` as the stable workspace/protocol slug for the starter screen-curfew variant.
- Use `evening-screen-curfew` as the provisional family slug unless the charter produces a better canonical split.
- Treat `experiment_family:evening-light-reduction` as related context, not automatically the parent, because screen curfews can act through light, arousal, displacement, and routine effects.
- The completed research package has already landed in `packages/health-commons/content/**`; later Health Commons hard-cut migrations changed the file shape after landing, so the original final reducer patch should not be reapplied over the current content.

## Verification

- Commands to run:
  - `git diff --check`
  - research artifact validation through the generated `pnpm research:run` harvest wrappers
  - `pnpm typecheck` or the narrowest truthful repo check if tracked repo files beyond the plan/ledger are edited
- Expected outcomes:
  - Research workspace files stay relative-path safe and contain no local identifiers.
  - Required research artifacts normalize under `downloads/<seam>/...` when each artifact seam completes.

## Outcome

- Final reducer harvested on 2026-04-25 with a patch bundle.
- Content is already landed in the current repo history; `git apply --check` for the original reducer patch now fails because the target files already exist.
- Current package proof should use the migrated repo content and Health Commons checks rather than the original reducer file hashes, because later source-identity/private-protocol migrations intentionally changed the content after the final reducer package was produced.
- Final package artifacts:
  - `output-packages/research/digital-sunset/responses/34-final-landing-reducer.md`
  - `output-packages/research/digital-sunset/downloads/34-final-landing-reducer/downloads/digital-sunset-final.patch`
  - `output-packages/research/digital-sunset/downloads/34-final-landing-reducer/downloads/digital-sunset-final-repo-patch-files.zip`
  - `output-packages/research/digital-sunset/downloads/34-final-landing-reducer/downloads/digital-sunset-final-file-manifest.json`
  - `output-packages/research/digital-sunset/downloads/34-final-landing-reducer/downloads/digital-sunset-final-source-ledger.json`
  - `output-packages/research/digital-sunset/downloads/34-final-landing-reducer/downloads/digital-sunset-final-research-artifacts.json`
- Final package scope: 288 files, 287 Markdown pages, 285 source pages, 284 artifact records, 17 direct intervention/registry records, 10 external guidance/policy records, 1 metadata-blocked record.
- Local checks completed:
  - `git apply --check output-packages/research/digital-sunset/downloads/34-final-landing-reducer/downloads/digital-sunset-final.patch`
  - `unzip -t output-packages/research/digital-sunset/downloads/34-final-landing-reducer/downloads/digital-sunset-final-repo-patch-files.zip`
  - raw home path and account username scans over `output-packages/research/digital-sunset` returned zero matches.
- Current landing verification on 2026-04-27:
  - `pnpm --filter @murphai/health-commons generate` passed.
  - `pnpm --filter @murphai/health-commons generate:check` passed.
  - `pnpm --filter @murphai/health-commons artifacts:r2:dry-run` exited successfully; the command reports rights-blocked artifacts by design and did not fail.
  - `pnpm --filter @murphai/health-commons typecheck` passed.
  - `pnpm --filter @murphai/health-commons test` passed with 10 files and 35 tests.
- Browser recovery note on 2026-04-27:
  - ChatGPT conversation `69ec305e-09a0-839d-965e-92ed12427e86` belongs to `output-packages/research/digital-sunset`, seam `12-source-extraction-008`.
  - That original seam was already replaced by completed seams `12-source-extraction-008a` and `12-source-extraction-008b`; do not keep reharvesting the original `008` thread.
  - A stale harvest attempt for original `008` was marked stopped because live `phlebas` CDP did not show the conversation and the replacement seams already hold the extracted artifacts.
