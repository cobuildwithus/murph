# Temporarily disable Strava connection offers

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Stop Murph and the web product from offering Strava connection or reconnection while preserving existing Strava ingestion, stored connections, and disconnect behavior for a small future re-enable.

## Success criteria

- The shared connect-target catalog omits Strava for direct and Junction-backed starts even when credentials or provider filters include it.
- Murph's hosted device capability list cannot advertise or issue a new Strava connect link.
- `/connect` hides Strava for members without an existing Strava lifecycle state and never renders a Strava connect/reconnect action.
- Existing active or recovery-state Strava connections remain visible where needed for status and disconnect, without a connect target.
- Public homepage connection examples no longer advertise Strava.
- Focused tests, web/device-sync typechecks, required UI review, and the selected PR review gate pass on the exact pushed head.

## Scope

- In scope: shared device connect availability, assistant/web connect target derivation, `/connect` presentation, public homepage examples, focused regression tests, and completion evidence.
- Out of scope: Strava provider/importer/webhook deletion, credential removal, stored connection mutation, historical data changes, or setup CLI support for self-hosted provider configurations.

## Constraints

- Technical constraints: preserve provider registry/runtime configuration so already-authorized Strava accounts continue syncing; fail closed at the shared user-facing connection-target owner; avoid an environment flag or new persisted state.
- Product/process constraints: use an isolated worktree and scoped PR; preserve unrelated ledger rows; keep re-enable to deleting one availability entry and restoring two marketing examples.

## Risks and mitigations

1. Risk: hiding Strava by deleting provider support could stop existing sync or revocation.
   Mitigation: keep routes, provider configs, importers, webhooks, and stored-connection handling intact; filter only connect-target issuance.
2. Risk: a hidden card could still be reachable through a direct start route or an old assistant intent.
   Mitigation: enforce the gate in both ordinary and exact reconnect target catalogs, which own direct starts and intent resolution.
3. Risk: removing Strava from `/connect` could also remove disconnect controls for existing members.
   Mitigation: retain lifecycle-state cards while stripping their connect target; hide only idle Strava cards.

## Tasks

1. Add a shared, reversible source-connection availability gate and apply it to connect and reconnect targets.
2. Make `/connect` omit idle disabled sources while preserving existing-source status/disconnect behavior.
3. Remove Strava from public homepage connection examples.
4. Update focused device-sync, route, assistant/runtime, and web presentation tests.
5. Run required verification, UI proof, completion reviews, commit, push, open the PR, and complete the selected review gate.

## Decisions

- Preserve Strava as a configured provider and ingestion source; "disabled" applies only to starting or renewing a user-facing connection.
- Centralize the temporary product decision in `packages/device-syncd` so Murph, `/connect`, start routes, old connect intents, and recovery-link tooling agree.
- Carry the derived availability fact into the `/connect` client so a locally disconnected Strava card disappears as soon as its last lifecycle state is removed.
- Keep disabled recovery states visible for truthful status/disconnect handling, but replace reconnect promises and disabled connection affordances with explicit temporary-unavailability copy.

## Verification

- Focused device-sync, web route/page, assistant-runtime, and homepage tests passed; the final connect-page remediation suite passed 76/76.
- Affected package typechecks passed. The affected package test lane passed through all reverse dependents after preparing the fresh-worktree CLI and assistant-runtime build artifacts; the hosted-local harness passed 406 tests and the remaining five downstream packages passed 700 tests.
- `pnpm test:apps` passed: hosted web typecheck, 5,916 tests, lint with eight unrelated warnings, dev smoke, and production build; Cloudflare typecheck and 1,842 tests also passed.
- `pnpm docs:drift` and `git diff --check` passed. The required coverage audit added a homepage no-Strava assertion and returned no unresolved findings.
- The frontend audit's two accepted findings were fixed and its re-review returned no findings. Approved desktop/mobile browser proof remains blocked by `No browser is available`; the allowed Fable and Opus checks were both blocked by an expired OAuth session, so the local frontend audit is the documented substitute.
- ReviewGPT and required GitHub CI remain the post-push exact-head gates.
Completed: 2026-07-20
