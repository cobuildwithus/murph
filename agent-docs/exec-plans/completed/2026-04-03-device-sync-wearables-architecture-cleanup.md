# 2026-04-03 Device Sync And Wearables Architecture Cleanup

## Goal (incl. success criteria)

- Make shared provider descriptors the only metadata contract for device-sync public ingress and other runtime metadata reads.
- Split the wearable query pipeline into smaller focused modules while keeping current behavior and test coverage intact.
- Collapse hosted browser-facing wearable control routes onto one settings-authenticated surface, leaving `/api/device-sync/**` for public callback/webhook ingress plus agent/internal APIs.
- Update durable docs and verification proof so the new seams are explicit.

## Constraints / Assumptions

- Preserve unrelated dirty-tree edits already in progress.
- This is a high-risk cross-cutting change touching auth, public routes, shared metadata, and read-model policy.
- The refactor should remove duplicated policy rather than inventing a second abstraction layer.

## Key Decisions

- Keep provider runtime objects behavior-focused and move public metadata reads to shared descriptors, including runtime overrides where necessary.
- Replace hard-coded wearables provider preference tables with descriptor-driven policy derived from `sourcePriorityHints`.
- Keep the calm `/api/settings/device-sync/**` surface as the only browser-facing wearable control API and narrow `/api/device-sync/**` to public callback/webhook plus agent/internal use.

## State

- In progress.

## Done

- Read the required workflow, architecture, security, reliability, verification, and product docs.
- Traced the current provider metadata seam, wearables query monolith, and duplicated hosted browser route surfaces.
- Registered the refactor lane in the coordination ledger and opened this execution plan.

## Now

- Refactor provider metadata ownership and wearables selection policy with the smallest behavior-preserving code motion that removes the duplicated seams.

## Next

- Finish the hosted route cleanup, update durable docs, run required verification, and create a scoped commit.

## Open Questions

- None.

## Working Set (files / ids / commands)

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-03-device-sync-wearables-architecture-cleanup.md`
- `packages/device-syncd/**`
- `packages/importers/**`
- `packages/query/**`
- `apps/web/app/api/{device-sync,settings/device-sync}/**`
- `apps/web/src/lib/device-sync/**`
- `apps/web/test/**`
- `ARCHITECTURE.md`
- `docs/device-provider-contribution-kit.md`
- `apps/web/README.md`
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
