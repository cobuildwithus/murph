Goal (incl. success criteria):
- Make wearable activity summaries consume canonical activity semantics instead of title-derived semantics.
- Add a localhost-only Junction workout diagnostic route that returns raw shape evidence for current-user workout summary records without persisting provider payloads.
- Success means query aggregates `activityType: sauna` even when the title says `Other`, and local diagnostics can show whether Junction exposes richer WHOOP workout identity than the retained raw artifact.

Constraints/Assumptions:
- Query is read-only and must not mutate canonical vault state.
- Importers decide canonical provider semantics; query consumes canonical fields.
- The diagnostic route is local-debug only, must fail closed outside localhost/development, and must not log or persist raw provider payloads.
- Preserve unrelated dirty work in the current checkout.

Key decisions:
- Do not add a broad activity taxonomy or map generic WHOOP `Other` to sauna.
- Keep the route as a temporary explicit diagnostic surface over Junction API data, not a canonical import path.

State:
- Implementation complete; final scoped commit pending.

Done:
- Confirmed retained Junction raw workout rows only have generic `sport: { name: "Other", slug: "other" }`.
- Spawned a query-scoped worker for the canonical activityType aggregation fix.
- Query now carries canonical `activityType` on wearable metric candidates and aggregates activity types from that field before legacy title fallback.
- Added a localhost-only Junction raw workout diagnostic route gated by `MURPH_ENABLE_JUNCTION_RAW_WORKOUT_DIAGNOSTIC=1`, authenticated hosted user ownership, and a 90-day window cap.
- Added route coverage for disabled/non-local access, oversized windows, auth failure before Junction egress, IPv6 localhost, and successful workout `listSummary` wiring.
- Added package-boundary coverage for the new explicit `@murphai/device-syncd/providers/junction-client` subpath export.
- Security/privacy, coverage, and deep-review subagents completed; review findings were addressed.

Now:
- Preparing scoped finish/commit.

Next:
- User can open the diagnostic route from an authenticated local browser session to inspect Junction workout raw fields.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether Junction exposes richer upstream WHOOP sport identity through detail, resource, or alternate summary fields not present in current retained raw artifacts.
- UNCONFIRMED: broad `test:diff` remains red in this checkout because its CLI vault-less probe runs from a repo root containing a local `vault/` directory, so `resolveDefaultVault()` finds that vault and exits 0 instead of `missing_vault`.

Working set (files/ids/commands):
- packages/query/src/**
- packages/query/test/**
- apps/web/app/api/internal/device-sync/junction/workouts/raw/route.ts
- apps/web/src/lib/device-sync/**
- packages/device-syncd/src/providers/junction-client.ts
- packages/device-syncd/package.json
- packages/device-syncd/test/package-boundary.test.ts
- apps/web/test/device-sync-junction-workout-diagnostic-route.test.ts
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
