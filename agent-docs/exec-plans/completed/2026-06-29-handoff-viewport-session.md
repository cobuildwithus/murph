# Computer Handoff Viewport Session Hint

## Goal

Land the handoff viewport-session patch in an isolated PR lane so the hosted
computer takeover surface uses concrete client/browser dimensions instead of a
blocking server-side UA preset resize.

## Constraints

- Keep handoff takeover instant; viewport resize must be best-effort and must
  not block the user taking over the browser.
- Store only bounded viewport dimensions on the existing hosted app session.
- Preserve hosted app-session authority for reading and writing the viewport
  hint.
- Keep Kernel credentials, live-view URLs, handoff tokens, and local identifiers
  out of logs, docs, fixtures, and ReviewGPT artifacts.
- Prefer the smallest existing ownership boundary: `apps/web` owns the app
  session, handoff page, Kernel resize call, and tests.

## Working Set

- `apps/web/app/computer/handoff/[token]/page.tsx`
- `apps/web/app/api/computer/handoff/[token]/viewport/route.ts`
- `apps/web/src/components/computer-use/computer-handoff-active-view.tsx`
- `apps/web/src/lib/computer-use/*`
- `apps/web/src/lib/hosted-onboarding/app-session.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/*computer_handoff_viewport_session_hint*/`
- focused hosted web tests for handoff, session, Kernel viewport, telemetry, and
  privacy export behavior

## Verification Plan

- Reviewed the patch shape and kept the viewport hint on the existing hosted app
  session boundary.
- Ran focused hosted-web Vitest for the changed handoff/session/viewport tests.
- Ran `pnpm test:diff`, `git diff --check`, `pnpm build:test-runtime:prepared`,
  and `pnpm typecheck`.
- Push the branch, open a PR with the required intent/invariant body, and run
  the PR-lane ReviewGPT loop to zero accepted findings.
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
