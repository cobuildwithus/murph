# Tighten hosted wake helper scoping, runner web-control allowlisting, and stale hosted boundary helpers

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Close the remaining hosted-cutover surface gaps that sit outside the quarantine/snapshotRef/docs lane and outside the post-CAS finalize lane:
- exported hosted-wake lookup helpers must fail closed by owner
- runner web-control forwarding must be allowlisted
- dead hosted route/helper residue must leave the live contract and tooling surfaces

## Success criteria

- Exported hosted-wake lookup helpers require `userId` and no longer default to unscoped event-id lookup.
- `apps/cloudflare/src/runner-outbound/web-control.ts` rejects non-allowlisted proxy paths.
- Dead runner debug/helper residue is removed from live internal usage and stale tooling/tests, while published package compatibility exports stay explicit.

## Scope

- In scope:
- `apps/cloudflare/src/runner-outbound/{web-control,results}.ts`
- focused `apps/cloudflare/test/runner-outbound.test.ts`
- `apps/web/src/lib/hosted-wake/{queue,lifecycle}.ts`
- focused hosted-wake tests under `apps/web/test/**`
- `packages/hosted-execution/src/routes.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `scripts/verify-workspace-boundaries.mjs`
- Out of scope:
- quarantine fetch-proof route handling and `snapshotRef` ingress validation
- hosted wake/cutover docs and architecture truth
- Cloudflare post-CAS finalize behavior

## Constraints

- Preserve unrelated in-flight edits already present in the hosted-wake boundary-fixes lane.
- Keep the write set limited to helper scoping, allowlist hardening, and dead helper cleanup.

## Risks and mitigations

1. Risk: helper-signature tightening can ripple through many callsites and tests.
   Mitigation: change the exported helper surface first, then update only the direct callsites surfaced by search/typecheck.
2. Risk: allowlisting the web-control proxy could block a legitimate child-callable path.
   Mitigation: derive the allowlist from the current runtime-platform callsites and add explicit positive/negative tests.
3. Risk: dead helper cleanup could leave verification or tests pointing at removed surfaces.
   Mitigation: delete the stale route/tooling references in the same change and keep focused coverage on the remaining live route surface.

## Tasks

1. Tighten exported hosted-wake lookup helpers to require `userId` and fail closed on owner mismatch.
2. Add a path allowlist to the runner web-control proxy and cover it with focused tests.
3. Delete dead runner debug/helper residue from live internal usage and stale tooling/tests without taking an unannounced package-surface break.

## Decisions

- Keep any remaining global event-id lookup private-only; the exported helper surface should require `userId`.
- Limit the runner web-control allowlist to the currently used child-callable hosted web paths: internal device-sync snapshot/apply/connect-link and hosted usage recording.
- Keep deprecated runner commit/side-effect route builders only as explicit compatibility exports on the published package surface.

## Verification

- `pnpm typecheck`
- `pnpm test:diff scripts/verify-workspace-boundaries.mjs apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/src/runner-outbound/results.ts apps/cloudflare/test/runner-outbound.test.ts apps/web/src/lib/hosted-wake/queue.ts apps/web/src/lib/hosted-wake/lifecycle.ts apps/web/test/hosted-wake-store.test.ts packages/hosted-execution/src/routes.ts packages/hosted-execution/test/hosted-execution.test.ts`

## Expected outcome

- Helper-level hosted-wake lookups are owner-scoped by default.
- The runner web-control proxy only forwards the narrow hosted callback paths still in use.
- Dead hosted route/debug helper residue is removed from live internal usage and stale tooling/tests, with package compatibility called out explicitly.
Completed: 2026-04-19
