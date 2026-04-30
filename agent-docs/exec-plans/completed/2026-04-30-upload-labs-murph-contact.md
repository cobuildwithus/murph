# Upload Labs Murph Contact

## Goal

Route the dashboard home "Upload labs" CTA through the same server-resolved Murph contact context as sidebar chat, prefilling a lab-report review message for eligible contact channels.

## Scope

- `apps/web/app/(dashboard)/home/page.tsx`
- `apps/web/src/components/home/onboarding-steps.tsx`
- `apps/web/src/components/home/upload-labs-action.tsx`
- `apps/web/src/components/murph/hosted-murph-contact-action.tsx`
- `apps/web/src/components/murph/murph-contact-link.tsx`
- `apps/web/src/components/dashboard/sidebar-chat-action.tsx`
- `apps/web/src/lib/murph-contact-routing.ts`
- Focused hosted-web tests for home/sidebar Murph contact routing

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Do not expose raw linked-account identifiers in rendered contact actions.
- Keep hosted auth/routing reads in server components behind Suspense.
- Reuse the cached hosted Murph contact context and avoid duplicating contact-link/new-tab rendering.

## Verification

- Focused hosted-web Vitest coverage for lab upload and sidebar contact routing.
- App typecheck, file-scoped lint, and diff hygiene.
- Required completion reviews for user-facing contact/UI behavior.

## State

- Done: factored shared hosted Murph contact resolver and contact link.
- Done: dashboard home Upload labs CTA opens preferred Murph channel with lab-report message.
- Done: Telegram upload-labs fallback avoids unsupported `?text=` bot prefill and prefers email when drafting a lab-report message.
- Done: focused tests, typecheck, file-scoped lint, diff hygiene, and required reviews passed.
- Done: plan closed for a scoped commit; the separate onboarding-step reorder row remains unstaged.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
