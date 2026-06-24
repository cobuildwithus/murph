# Onboarding Follow-Up Managed Definition

## Goal

Make the hosted onboarding follow-up automation use one managed definition and reconcile existing Murph-owned records without changing signup-specific creation behavior.

## Constraints

- Preserve signup-only creation: create the follow-up only after welcome delivery is accepted.
- Preserve signup route and first-occurrence local-day deferral.
- Do not create missing onboarding follow-ups from background maintenance.
- Do not retarget, reactivate, or revive archived automations.
- Keep the primitive narrow and reusable for managed definition drift only.

## Plan

1. Move onboarding follow-up slug/title/summary/tags/schedule/instructions into assistant-engine as a shared managed definition.
2. Add an update-only managed automation reconciliation helper that finds an existing Murph-owned automation by slug and updates definition-owned fields while preserving route/status/runtime state.
3. Use the shared definition from hosted signup seeding.
4. Call the update-only reconciliation from hosted managed automation maintenance.
5. Add focused assistant-engine, assistant-runtime, and core integration tests.
6. Point the hosted-local onboarding follow-up E2E fixture at the shared definition.

## Validation

- Focused assistant-engine managed automation tests.
- Focused assistant-engine core integration tests.
- Focused assistant-runtime hosted notification/workspace phase tests.
- Cloudflare package typecheck for the hosted-local E2E fixture import.
- Typecheck.
- PR-lane completion audits required by workflow routing.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
