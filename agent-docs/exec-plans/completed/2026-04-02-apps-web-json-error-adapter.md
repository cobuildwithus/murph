# Apps Web JSON Error Adapter

## Goal

Land section 5 of `docs/architecture-review-2026-04-01.md` in a narrow form by centralizing `apps/web` JSON route error-adapter wiring behind one app-level factory.

## Why

- `apps/web/src/lib/device-sync/http.ts`, `apps/web/src/lib/hosted-onboarding/http.ts`, and `apps/web/src/lib/linq/http.ts` all restate the same `jsonError` / `withJsonError` wrapper pattern.
- Hosted onboarding also carries the only default-header variant (`Cache-Control: no-store`), which fits the same shared seam.
- The target is a small factory that owns generic response/error plumbing while each domain keeps its own matcher list and header policy.

## Scope

- `apps/web/src/lib/http.ts`
- `apps/web/src/lib/device-sync/http.ts`
- `apps/web/src/lib/hosted-onboarding/http.ts`
- `apps/web/src/lib/linq/http.ts`
- Focused `apps/web/test/**` coverage for the helper seam

## Constraints

- Preserve existing public helper behavior and route call sites.
- Do not widen into unrelated route/service refactors.
- Keep the abstraction app-local; do not move it into a shared package.

## Verification

- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
- Focused Vitest coverage for the touched HTTP helper modules and affected routes

## Commit Plan

- Use `scripts/finish-task` if the plan remains active at completion; otherwise use `scripts/committer`.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
