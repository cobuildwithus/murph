# Ops Onboarding Invite ReviewGPT Fixes

## Goal

Resolve PR 342 ReviewGPT blockers before merge:
- New-chat ops invites must bind the created Linq chat into hosted member routing before sending the setup link.
- Voice memo uploads must enforce a bounded body read before multipart parsing.

## Constraints

- Keep the ops tool scoped to manual hosted onboarding.
- Preserve existing hosted routing ownership primitives.
- Do not introduce a second routing authority or unbounded upload path.

## Plan

1. Validate new-chat sender phone numbers against configured hosted Linq conversation phones.
2. Persist created new-chat ids as pending hosted member Linq bindings before sending the setup link or voice memo.
3. Bound multipart request bodies before `formData()` parsing and keep per-file validation.
4. Add focused regressions and rerun relevant hosted-web tests/typecheck.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-ops-onboarding-invites.test.ts`
- `pnpm --dir apps/web typecheck:prepared`

Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
