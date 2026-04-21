# Source person profile images

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Add reusable profile-image support for Health Commons source people in the hosted experiment-detail expert cards.
- Download Bryan Johnson's current X/Twitter avatar into a new local public asset folder and wire it through the generic source-person image path.
- Update Bryan Johnson's displayed expert bio copy to the new user-provided line.

## Success criteria

- Source-person entities can provide an optional profile image URL without hardcoding a one-off UI special case.
- Expert cards render the profile image when present and fall back to initials when absent.
- Bryan Johnson's source-person page points at a downloaded local avatar asset sourced from his X/Twitter presence.
- The Bryan Johnson expert quote updates to the new user-provided copy.
- Directly coupled generated Health Commons artifacts and focused web tests are updated and passing, or any unrelated blocker is named precisely.
- A scoped commit includes only this feature's paths plus plan/ledger closeout.

## Scope

- `packages/health-commons/content/sources/people/bryan-johnson.md`
- directly coupled `packages/health-commons/generated/**`
- `apps/web/public/source-people/**`
- `apps/web/src/lib/health-commons/experiment-detail.ts`
- `apps/web/src/components/experiments/experiment-detail/expert-card.tsx`
- `apps/web/src/types/experiments.ts`
- directly coupled `apps/web/test/{expert-card,health-commons-experiment-experts,health-commons-experiment-detail-page}.test.ts*` only if required

## Constraints

- Preserve unrelated dirty-tree edits already present in `apps/web`, `packages/assistant-runtime`, `packages/core`, and `packages/hosted-execution`.
- Overlap carefully with the active experiment-detail source-ordering row on the same projection file; keep this lane limited to source-person image and quote plumbing.
- Keep the downloaded avatar local to the repo under a new public asset folder instead of hotlinking the image at render time.
- Do not widen into unrelated experiment-detail layout work.

## Tasks

1. [x] Register the plan in the coordination ledger.
2. [x] Download Bryan Johnson's X/Twitter avatar into a new public asset folder.
3. [x] Add generic source-person profile-image support in the experiment-detail projection and expert card.
4. [x] Update the Bryan Johnson source-person data and direct test expectations.
5. [x] Regenerate directly coupled Health Commons artifacts.
6. [x] Run focused verification, fix audit findings, and prepare the scoped commit.

## Verification

- `pnpm --dir packages/health-commons generate` ✅
- `pnpm --dir packages/health-commons generate:check` ✅
- `pnpm --dir packages/health-commons typecheck` ✅
- focused `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/expert-card.test.ts apps/web/test/health-commons-experiment-experts.test.ts` ✅
- `git diff --check` ✅
- `pnpm typecheck` ✅ before an unrelated later dirty-tree deletion of `apps/web/src/components/experiments/experiment-detail/study-card.tsx`
- `pnpm --dir apps/web typecheck:prepared` ❌ now blocked by that unrelated deleted `study-card.tsx` plus the coupled `apps/web/test/study-card.test.ts` edit already dirty in this tree
- `pnpm verify:acceptance` ❌ on the earlier in-flight run for unrelated pre-existing reasons outside this lane: untracked `apps/web/.next-dev-codex-participant-badge/` artifact residue and an existing `apps/web/test/experiment-header.test.ts` expectation mismatch

## Outcome

- Added generic `profileImageUrl` plumbing for source-person experts.
- Downloaded Bryan Johnson's avatar to `apps/web/public/source-people/bryan-johnson/twitter-avatar.jpg` and referenced it from the source-person page.
- Updated Bryan Johnson's expert copy to `Founder of Blueprint and Don't Die. Trying to live forever.`
- Fixed two audit findings before closeout:
  - image-load failures now fall back to initials instead of leaving a broken avatar shell
  - protocol-relative `//...` values are rejected so only root-relative local paths or absolute `http(s)` URLs pass through

## Notes

- X itself is not directly reachable from this environment, so the avatar fetch may need to use an accessible Bryan Johnson posts mirror that links back to the official `@bryan_johnson` account and exposes the current avatar file.
Completed: 2026-04-21
