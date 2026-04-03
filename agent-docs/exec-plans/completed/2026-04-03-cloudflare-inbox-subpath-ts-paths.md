# Cloudflare Inbox Subpath TS Paths

## Goal

Make fresh-checkout TypeScript resolution match the declared `@murphai/inboxd` public subpath exports so the hosted Cloudflare GitHub deploy workflow passes from CI.

## Scope

- Add explicit workspace path mappings for inbox public subpaths used by the hosted/runtime code.
- Re-run the focused Cloudflare verification.
- Re-dispatch the production Cloudflare deploy workflow after the fix is pushed.

## Constraints

- Keep the change limited to public entrypoint resolution; no behavior changes.
- Preserve unrelated dirty-tree work and active plans.
- Use the same public entrypoints already declared in `packages/inboxd/package.json`.

## Plan

1. Add explicit `tsconfig.base.json` path mappings for the inbox public subpaths used in hosted/runtime code.
2. Re-run focused Cloudflare verification locally.
3. Commit the fix, push it, and retry the production deploy workflow.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
