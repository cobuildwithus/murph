# Join OpenGraph fallback

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Make the join invite page use the same Open Graph image copy and design as the homepage.
- Use the root app Open Graph image as the inherited fallback instead of maintaining a join-specific override.

## Success criteria

- `apps/web/app/join/[inviteCode]/opengraph-image.tsx` no longer overrides the root app image.
- Join invite routes inherit the homepage Open Graph image while keeping their route-specific metadata title/description.
- Focused regression coverage protects the intended fallback behavior.
- Required verification and completion audits run, or any unrelated blocker is named precisely.
- A scoped commit includes only this task's files plus plan/ledger closeout.

## Scope

- In scope: the join invite route's Open Graph fallback behavior, directly coupled tests, and plan/ledger updates.
- Out of scope: changing homepage Open Graph copy/design, changing join invite page UI, changing broader metadata copy across unrelated routes, or adding new route-specific Open Graph images.

## Constraints

- Preserve unrelated dirty-tree edits, especially the existing homepage Open Graph image work already in this tree.
- Do not expose direct personal identifiers in docs, generated files, commit messages, or handoff.
- Prefer the smallest Next.js-native solution, using route metadata inheritance rather than duplicate image routes.

## Tasks

1. [x] Register the task in the coordination ledger.
2. [x] Remove the join invite route-level Open Graph image override so the root image becomes the fallback.
3. [x] Add or update focused regression coverage for the inherited fallback behavior.
4. [x] Run focused verification and direct scenario proof for the touched hosted-web slice.
5. [x] Run required completion audits and create the scoped commit.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/join-page.test.ts test/opengraph-image.test.ts`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff 'apps/web/app/join/[inviteCode]/opengraph-image.tsx' apps/web/test/join-page.test.ts apps/web/test/opengraph-image.test.ts`
- Direct proof: started `next dev` on port `3100`, fetched `/join/test-invite?preview=verify`, and confirmed the dev HTML referenced the root `apps_web_app_opengraph-image--metadata_*` chunk with no join-specific Open Graph metadata chunk. This is inference from dev-mode HTML rather than a direct rendered `og:image` tag.

## Completion audits

- `coverage-write` on `gpt-5.4-mini`: no additional test/proof edits needed.
- `frontend-review`: no findings.
- `task-finish-review`: no findings.
Completed: 2026-04-21
