# Keep exercise image provenance truthful

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Keep Murph truthful and natural when a member asks where a previously sent
  exercise image came from or whether the matching exercise also has reviewed
  catalog media.

## Success criteria

- Murph distinguishes the provenance of the specific delivered image from the
  existence of other catalog images for the same movement.
- A later catalog lookup does not cause Murph to retract a correct statement
  that an earlier image was generated.
- No catalog id, slug, or source token appears in member-visible text.
- Focused deterministic and real-Codex proof pass on the affected model.

## Scope

- In scope: the shared exercise catalog presentation reference and its focused
  deterministic/live regression coverage.
- Out of scope: catalog storage, image generation, media delivery, routing,
  provider selection, and historical conversation repair.

## Constraints

- Technical constraints: reuse the existing catalog lookup and response-media
  paths; add no state owner, provider call, or runtime machinery.
- Product/process constraints: use synthetic evidence only, preserve the
  existing PR's reviewed scope, and rerun the exact relevant Luna and Sol
  journeys before returning the PR to Ready.

## Risks and mitigations

1. Risk: provenance guidance could encourage unnecessary catalog reads.
   Mitigation: require lookup only when catalog availability is asked about;
   answer specific-media provenance from recorded conversation/tool evidence.
2. Risk: a synthetic test could reveal its expected answer to the model.
   Mitigation: provide only neutral prior-media facts and assert the distinction
   in the result without instructing the reply wording.

## Tasks

1. Add deterministic provenance guidance coverage.
2. Extend the focused Linq real-Codex journey with legacy generated-media and
   catalog-availability follow-ups.
3. Add the smallest shared-guidance correction and run focused proof.
4. Review, commit, update the PR, and wait for exact-head checks.

## Decisions

- Keep ownership in the existing shared exercise catalog reference. This is a
  presentation-truthfulness issue, not a new media-provenance service or state
  problem.
- Narrow production metadata confirmed three successful Sol replies: the first
  used thread evidence only, the second performed one catalog command, and the
  next attached catalog media. The defect was model narration and tool choice,
  not provider or delivery failure.
- Product UX replay covers three materially different people/states: a member
  receiving a just-in-time movement cue, a member repairing missing media, and a
  member distinguishing one delivered image from other catalog alternatives.
- A broad warning against exposing media sources caused one live Luna sample to
  omit the internal attachment source field. The final rule is explicitly
  member-visible-only and preserves exact media-tool routing metadata.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-skill-assets.test.ts
  test/exercise-catalog-runtime-guidance.test.ts`: passed, 26 tests with 7
  intentional skips.
- `pnpm test:assistant:live -- --test "keeps exercise catalog ids private and
  repairs missing Linq media without generation" --model gpt-5.6-luna`:
  passed after the final guidance wording; both synthetic turns looked up and
  attached exact catalog media with no generated substitute or visible routing
  data.
- `pnpm test:assistant:live -- --test "keeps generated exercise image
  provenance distinct from catalog availability" --model gpt-5.6-sol`: passed
  after the final guidance wording; the synthetic follow-ups kept specific-image
  provenance distinct from catalog availability, exposed no internal id or
  provider/model name, and made no extra generation or attachment call.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- Parent candidate review: accepted. The change stays in the existing shared
  prompt owner, exercises the real completion and media-tool contracts, and
  adds no runtime state, provider call, or product-data owner.
- The PR's preliminary specialist pass is intentionally one-shot and was not
  rerun after substantive remediation. This follow-up adds no cross-cutting
  final-gate trigger.
- `git diff --check`: passed. Privacy scan found no member identifier, local
  path, screenshot name, credential header, or environment-file reference in
  the changed files.
- Frog: existing entries inspected; no new repository-scoped friction entry
  qualifies.
- Remaining after the scoped commit: push, exact-head CI, and current-base merge
  proof.
Completed: 2026-08-27
