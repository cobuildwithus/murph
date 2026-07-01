# Junction Sleep Cycle Compact Import

## Goal

Fix Junction `sleep_cycle` normalization so provider imports keep dense stage intervals as raw evidence and emit compact sleep-stage product facts that pass the core device batch guard.

## Scope

- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- `packages/core/src/mutations.ts`
- `packages/core/test/device-import.test.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/test/junction-provider.test.ts`
- Focused verification for Junction importer behavior and core dense telemetry policy.

## Constraints

- Do not store raw provider stage timelines as default device samples.
- Preserve raw evidence artifacts for audit/debug.
- Keep normalized sleep-stage facts queryable as compact observations.
- Avoid exposing user identifiers or raw provider payloads.

## State

Implemented. Review follow-ups addressed: parentless, incomplete, and overlapping stage timelines remain raw-only; direct sleep-cycle webhooks fall back to the Junction summary fetch instead of completing from potentially partial inline payloads; complete parented cycles emit clipped, zero-inclusive compact fallback facts anchored to the sleep window; and sleep summary plus sleep-cycle stage metrics share one canonical stage identity under the existing Junction sleep resource type for the same provider/source/window/stage, including cross-midnight sleep windows. Summary ownership now uses exact canonical sleep-window equality, not loose overlap or calendar-day bucketing. Summary-derived stage facts carry a higher external-ref priority than sleep-cycle fallback facts, so a later cycle-only import cannot overwrite a prior summary-owned stage value while a later summary can still supersede fallback. The core reconciler can collapse the one-time legacy-summary plus fallback alias by tombstoning the lower-priority fallback record, preserving the summary-owned observation id. Canonical sleep-stage identity now ignores day key and timezone representation in the hash, while keeping those fields on the event for display/context, so equivalent absolute windows do not split identities across UTC/local/raw timestamp formatting. ReviewGPT round 22 follow-ups are also addressed: Junction sleep-stage events with provider day keys and omitted timezone no longer inherit mutable vault timezone; changed-value legacy sleep-summary stage replays can migrate by exact Junction source and sleep-end occurrence proof; and same-window `sleep_cycle`/`hypnogram` aliases collapse in the importer by canonical source/window/stage identity with deterministic display-field selection instead of relying on order-dependent core supersedes.

## Verification

- `pnpm --filter @murphai/core test -- device-import` passed: 38 files, 523 tests.
- `pnpm --filter @murphai/importers test -- device-providers-junction` passed: 13 files, 273 tests.
- `pnpm --filter @murphai/device-syncd test -- junction-provider` passed: 39 files, 646 tests.
- `pnpm --filter @murphai/core typecheck` passed.
- `pnpm --filter @murphai/importers typecheck` passed.
- `pnpm --filter @murphai/device-syncd typecheck` passed.
- `pnpm build:workspace:incremental` passed.
- `git diff --check` passed.
- Privacy grep over `git diff HEAD` returned no matches.
- `pnpm test:diff packages/importers/src/device-providers/junction.ts packages/importers/test/device-providers-junction.test.ts` was attempted after generating Health Commons artifacts. It passed dependency policy, workspace boundaries, guards, affected package typechecks, affected package tests, apps/cloudflare verify, and then failed in apps/web verify when local dev smoke exited early. A direct `pnpm --dir apps/web dev:smoke` rerun failed because the isolated worktree is not linked to a Vercel project; this is a local worktree setup blocker, not importer behavior.
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01
