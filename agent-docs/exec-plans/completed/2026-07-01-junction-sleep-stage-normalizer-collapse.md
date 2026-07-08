# Junction sleep-stage normalizer collapse

Status: completed

## Goal

Collapse Junction sleep-stage precedence into a simple importer-owned normalizer flow.

Success criteria:

- Junction summary sleep-stage facts and `sleep_cycle` fallback facts derive the same canonical external reference from stable provider/source/window/stage facts.
- The normal core import path no longer carries Junction-specific multi-id priority, alias, or tombstone cleanup behavior.
- A later lower-quality cycle fallback cannot overwrite an already-imported summary fact for the same canonical stage.
- Push-primary Garmin sleep and `sleep_cycle` direct imports remain parseable inline carriers; unclear webhook payloads still degrade to fetch/floor instead of silence.
- Tests prove summary-first, cycle-first, cycle-only fallback, and cross-midnight behavior without day-only or timezone wildcard ownership.

## Current Evidence

ReviewGPT found the current PR split sleep-stage precedence across:

- `packages/importers/src/device-providers/junction.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/core/src/mutations.ts`

The concrete bug fixes already landed on this branch showed the split protocol is fragile:

- direct source-reference resolution had to be repaired in `device-syncd`
- summary/cycle ownership had to be tightened in `importers`
- core still carries generic-looking Junction priority and legacy alias collapse for one provider-specific sleep-stage concern

## Intended Shape

- `device-syncd` stays transport/lifecycle only: verify, resolve source refs, enqueue/import parseable snapshots, fetch when needed.
- `importers` owns Junction sleep-stage canonical identity and stage-quality metadata.
- `core` keeps only the minimal same-external-ref overwrite guard needed to preserve a higher-quality existing fact when a lower-quality fallback arrives later.
- Legacy duplicate cleanup is not part of the normal import loop.

## Verification

Completed checks:

- `pnpm --filter @murphai/importers test -- device-providers-junction` — passed
- `pnpm --filter @murphai/importers typecheck` — passed
- `pnpm --filter @murphai/core test -- device-import` — passed
- `pnpm --filter @murphai/core typecheck` — passed
- `pnpm --filter @murphai/device-syncd test -- junction-provider` — passed
- `pnpm --filter @murphai/device-syncd typecheck` — passed
- `pnpm build:workspace:incremental` — passed
- `pnpm typecheck` — passed
- `pnpm test:smoke` — passed
- `git diff --check` — passed

## Open Questions

- UNCONFIRMED: whether existing legacy duplicate cleanup should move into a future explicit repair command. This plan removes it from the normal import path; focused tests passed without keeping the old priority/alias cleanup.
Updated: 2026-07-01
Completed: 2026-07-01
