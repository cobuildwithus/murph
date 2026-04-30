# Experiment Start Murph Phone

## Goal

Resolve the authenticated hosted member's assigned Linq/Murph phone number on experiment detail pages so the Start Experiment button can open the correct SMS route when available.

Also route the dashboard/sidebar "Chat with Murph" action through the same server-resolved member contact context so it opens the preferred chat channel instead of the dead `/chat` route.

## Scope

- `apps/web/app/(dashboard)/experiments/[experimentId]/layout.tsx`
- `apps/web/app/(dashboard)/experiments/[experimentId]/experiment-start-button-server.tsx`
- `apps/web/app/(dashboard)/experiments/[experimentId]/experiment-layout-client.tsx`
- `apps/web/app/(dashboard)/experiments/[experimentId]/results/page.tsx`
- `apps/web/app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx`
- `apps/web/src/components/dashboard/dashboard-shell.tsx`
- `apps/web/src/components/dashboard/sidebar.tsx`
- `apps/web/src/components/dashboard/sidebar-chat-action.tsx`
- `apps/web/src/components/experiments/experiment-detail/experiment-header.tsx`
- `apps/web/src/components/experiments/experiment-detail/results-tab.tsx`
- `apps/web/src/lib/hosted-onboarding/hosted-contact-context.ts`
- `apps/web/src/lib/murph-contact-routing.ts`
- Focused experiment detail tests under `apps/web/test/`

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Do not expose raw linked-account identifiers to client props; pass only minimized contact-channel flags and the assigned Murph phone value already used by settings.
- Keep the public experiment layout static-first; put dynamic hosted auth/routing behind a Suspense server slot.
- Keep server-only auth/routing reads out of client sidebar code; pass the chat action as a server-rendered slot.
- Do not create or mutate experiment runs from the button.

## Verification

- Focused hosted-web test covering experiment detail contact routing.
- App-scoped typecheck or documented blocker.
- Required completion workflow reviews for hosted-web/auth-contact behavior.

## State

- Done: experiment start and sidebar chat actions resolve hosted member contact context through server Suspense slots.
- Done: assigned member phone is used only for eligible SMS routes; sidebar no-channel states render disabled placeholders.
- Done: focused tests, typecheck, file-scoped lint, and required completion reviews completed.
- Done: scoped task commit prepared after user request; unrelated overlapping dirty hunks were left unstaged.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
