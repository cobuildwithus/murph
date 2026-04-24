# Land whole-body photobiomodulation Health Commons research package

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Land the final reducer patch from the whole-body red and near-infrared light exposure research run as a Health Commons whole-body photobiomodulation family, starter protocol, source corpus, and artifact manifest.

## Success criteria

- The reducer patch applies cleanly to the current checkout without touching unrelated active work.
- Authored Health Commons content includes the whole-body photobiomodulation family, protocol, source pages, and rights-safe artifact manifest.
- Derived Health Commons generated outputs are refreshed from the landed authored content.
- Required Health Commons verification commands pass, or any blocker is clearly identified as unrelated.
- Required completion review/audit passes run before handoff.
- A scoped commit lands only this plan, ledger cleanup, and the whole-body PBM landing files.

## Scope

- In scope:
  - `packages/health-commons/content/families/whole-body-photobiomodulation.md`
  - `packages/health-commons/content/protocols/whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure.md`
  - `packages/health-commons/content/sources/whole-body-photobiomodulation/**`
  - `packages/health-commons/content/artifacts/whole-body-photobiomodulation/research-artifacts.json`
  - Directly regenerated `packages/health-commons/generated/**`
  - This active plan and the coordination ledger row for this task
- Out of scope:
  - Uploading or committing copyrighted PDFs
  - Changing Health Commons schemas or loaders unless verification proves the reducer patch depends on it
  - Editing unrelated active Health Commons, hosted-web, or runtime lanes

## Constraints

- Preserve unrelated dirty-tree work.
- Keep source keys canonical and avoid `source_artifact:pmcid-*` landed keys.
- Keep artifact entries rights-safe and manifest-only; no raw research PDFs in Git.
- Do not widen into future protocol variants such as localized pain, cosmetic/photoaging, or athlete recovery.

## Risks and mitigations

1. Risk: The reducer artifact downloader timed out and left no patch on disk.
   Mitigation: Re-download the final reducer artifacts from the completed thread with a longer timeout before applying.
2. Risk: Generated Health Commons outputs could include unrelated dirty content.
   Mitigation: Inspect the generated diff and commit only the files caused by this landing.
3. Risk: The shared checkout has many unrelated active lanes.
   Mitigation: Use scoped paths for verification, staging, and commit helpers; preserve all unrelated dirty files.

## Tasks

1. [x] Register this task in the coordination ledger.
2. [x] Inspect the reducer patch and manifests for unsafe identifiers, secrets, and unexpected paths.
3. [x] Apply the reducer patch and review the resulting authored content diff.
4. [x] Regenerate Health Commons derived outputs.
5. [x] Run Health Commons verification and required completion audits.
6. [ ] Land a scoped commit through the repo finish helper.

## Decisions

- Use the final reducer patch from seam 34 as the source of truth for authored content.
- Re-run artifact downloads rather than rerunning the reducer because the reducer itself completed successfully and only the downloader timed out.

## Verification

- `pnpm --filter @murphai/health-commons generate` passed.
- `pnpm --filter @murphai/health-commons generate:check` passed.
- `pnpm --filter @murphai/health-commons artifacts:r2:dry-run` passed; existing non-redistributable artifacts remained blocked, and the new whole-body PBM manifest emitted five dry-run upload commands plus one expected blocked non-redistributable placeholder.
- `pnpm --dir packages/health-commons verify` passed, including package typecheck, 7 Vitest files / 16 tests, and `generate:check`.
- `git diff --check` passed for the scoped files.
- Sensitive-pattern scan passed for the scoped landed content.
- Reducer invariant scan passed for no `source_artifact:pmcid-*`, no `pmid-32483749`, and no `adverse-event:` namespace.
- Required `task-finish-review` audit ran; it found only this plan-verification-status cleanup.
Completed: 2026-04-24
