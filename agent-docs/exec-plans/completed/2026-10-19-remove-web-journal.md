# Remove the website Journal page while preserving native access

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Goal and protected invariants

Retire the website Journal destination and its exclusive presentation code.
Keep the companion Journal API, canonical capture, query projection, Browser Vault
publication, native clients, shared assets, and Environment behavior unchanged.

## Ownership and evidence

The website owns the dashboard page, Journal view, design study, and UI tests.
The native API reads the shared query-owned projection from the encrypted core
shard independently of those components. Personal Patterns also consumes Journal
records. These shared owners remain in place; no state or schema changes are needed.

## Product UX

- Website navigation no longer advertises Journal.
- Old Journal and History bookmarks go directly to Home through the existing
  permanent-redirect convention for retired pages.
- Patterns retains device connection for members without data and its existing
  conversational guidance for members with data, without a dead Journal action.
- Native Journal reads continue through the same authenticated endpoint.
- Environment is outside this task.

## Tasks

1. Delete the website Journal client, layout, view, study, and exclusive tests.
2. Remove navigation and Patterns links; retire Journal and History to Home.
3. Preserve shared refresh coverage, API contracts, query data, and icon assets.
4. Update live documentation and the member changelog.
5. Review with Claude, run focused tests and Web typecheck, inspect rendered
   remaining states, review the diff, and make a scoped commit.

## Deployment and failure behavior

Web-only removal uses existing redirects. Native API and replica schemas do not
change, so no coordinated runtime rollout, migration, or compatibility layer is
needed. Old clients retain the same API behavior. No production mutations.

## Verification

- Focused Web tests: 214 passing across sidebar, retired routes, Patterns/dashboard,
  Browser Vault context and shard demand, auth, companion Journal API, and changelog.
  Two suites initially needed the fresh-checkout Prisma client; both passed after
  the standard Web typecheck generated it. The dashboard slice also passed after
  deleting its now-unused Journal-only media-query fixture.
- `pnpm --dir apps/web typecheck` and `typecheck:prepared`: pass.
- Targeted ESLint: pass with no remaining warnings.
- `pnpm complexity:diff`: pass, zero changed-source hotspots above 20.
- `pnpm docs:drift` and `git diff --check`: pass.
- Claude read-only removal review: no missing shared owner; retained native icon
  assets and the shared query contracts, corrected stale native/API descriptions.
- API source comparison excluding comments: executable implementation unchanged.
- Scope and privacy review: shared runtime, query, assets, and Environment unchanged;
  no direct personal identifiers in task files.
- Browser: confirmed old Journal and History links reach Home. Desktop and 390px phone Patterns
  empty, needs-context, and learning states inspected; all six captures show the
  expected actions and readable text. Browser assertions passed for both redirects
  and all state actions. The existing mobile card uses `-mx-2` to extend 8px into
  the gallery gutter; its wider local box is intentional and stays in the viewport.
  Local proof used the real components at `/screenshots/health#personal-patterns`.
  The one-off capture spec was removed after inspection; ignored screenshots remain
  under `.artifacts/review-gpt/remove-web-journal/`.
- Product UX verdict: Ready. No difference from the planned member journeys.
- Parent final review: complete; deletion is limited to the website presentation,
  with existing redirects and no replacement state owners or dependencies.

## Decisions

- Retain the standard retired-route redirect instead of a replacement page.
- Keep the contracts subpath type alias because shared query sources still import
  the Journal presentation catalog transitively.
- Historical changelog records remain historical; old links are handled by the
  redirect. Added `2026-10-19 / journal-native-access` for the current outcome.
- This is frontend-only removal plus an API comment correction. No external
  ReviewGPT gate, production mutation, API migration, or runtime change is needed.
- Task delivery is a local scoped commit; no PR, merge, push, or deployment was
  requested.
Completed: 2026-10-19
