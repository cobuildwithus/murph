# Main Vercel Browser Query Fix

## Goal

Fix the current `main` Vercel build failure caused by browser client code importing a broad query entrypoint that pulls Node-only modules into a Turbopack client chunk.

## Constraints

- Preserve unrelated dirty dashboard, Cloudflare, assistant-runtime, and query work in the checkout.
- Keep browser imports on declared package public entrypoints.
- Do not reintroduce sibling package internal imports from `apps/web`.

## Plan

1. Confirm the current failing status and available logs.
2. Add or narrow a browser-safe query public entrypoint for experiment-result selectors.
3. Point `apps/web` experiment-run projection code at that browser-safe entrypoint.
4. Run focused package/app verification and report any unrelated blockers.

## Verification

- Pending: focused `apps/web` build or verify lane.
- Pending: focused query/web typecheck as needed.
