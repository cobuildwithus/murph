# Connect Completion Single Entrypoint

## Goal

- Make `/connect` the only browser-facing device connection start surface.
- Route successful `/connect` provider callbacks to the existing device connection completion page so users can text Murph after connecting a wearable.
- Remove the settings-page device connection start path while preserving settings read/manage actions.
- Persist Junction upstream source-card state at callback time so later source connects do not make the previous source appear disconnected.

## Constraints

- Preserve unrelated dirty work.
- Keep provider callback mechanics and return-origin validation unchanged.
- Keep `/settings` as read/manage only for device-sync sources.
- Do not expose secrets, provider authorization URLs, raw OAuth state, contact identifiers, or local paths in logs/docs/tests.

## State

Implementation draft verified; final UX decision pending.

## Done

- Read repo routing, frontend, security, completion, verification, and testing docs.
- Identified current split: `/connect` stores `/connect?...` as `returnTo`; the assistant route stores `/device-sync/connect/complete?...`.
- Spawned worker for settings-connect route/UI removal.
- Added an app-local completion-return helper and switched `/connect` source starts to use it.
- Removed the settings device-sync connect route/action surface through the worker slice.
- Ran focused route/UI tests, `typecheck:prepared`, and diff whitespace checks for touched files.
- Identified missing durable Junction `device_connection_source` rows as the `/connect` source-card disconnect root cause.
- Added deterministic provider-level Junction source keys, callback-time source upsert, and job-time source projection reuse of the same key.
- Ran focused device-syncd and hosted-web connect/wake tests plus root `pnpm typecheck`.
- Addressed security review by deriving provider-level source keys from local connection id plus source slug instead of Junction external account id.
- Coverage audit added a repeated-Garmin/Peloton callback regression test for stable same-slug keys and distinct different-slug keys.

## Now

- Run final completion review for the durable Junction source-card slice.

## Next

- Apply the agreed UX copy/CTA adjustments.
- Run required audit passes and any final verification.
- Commit the scoped change if the user accepts the final UX.

## Open Questions

- Final completion-page copy and CTA hierarchy are still to discuss after the route behavior is fixed.
- Targeted `test:diff` expanded into reverse-dependent CLI tests and hit an unrelated `packages/cli/test/incur-smoke.test.ts` timeout in `search query schema exposes retrieval-specific filters`; focused owner tests for this slice passed.

## Working Set

- `apps/web/app/(dashboard)/connect/connect-page-client.tsx`
- `apps/web/app/api/connect-sources/[sourceId]/start/route.ts`
- `apps/web/app/api/internal/device-sync/connect-targets/[connectTarget]/connect-link/route.ts`
- `apps/web/src/lib/device-sync/connect-completion-return.ts`
- `apps/web/src/components/settings/hosted-device-sync-settings-client.tsx`
- `apps/web/app/api/settings/device-sync/providers/[provider]/connect/route.ts`
- `apps/web/src/lib/device-sync/public-ingress-service.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- `packages/device-syncd/src/providers/junction-connect-sources.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `packages/device-syncd/src/types.ts`
- focused `apps/web/test/**` device-sync/connect/settings tests
- focused `packages/device-syncd/test/**` Junction/public-ingress tests
