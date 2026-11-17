# Connect a web-sign-in wearable from the Murph app

Status: completed
Created: 2026-11-13
Updated: 2026-11-13

## Goal

- The Murph iOS app can connect a wearable that signs in on its own website
  (Oura, Garmin, Fitbit, Withings and the rest of the Junction link sources)
  without loading Murph's website, and can sync or stop a connected one.
- Server only. The app change is a separate pull request in the app repository.

## Success criteria

- An app session starts a connection, the provider returns to a fixed bridge,
  and the same app session finishes it with a proof the start gave it.
- The website's start, callback route and proof cookie behave as before; their
  existing tests pass unchanged.
- Older app builds keep working: every route is additive and the list only
  gains one field (`connection.actions`).

## Scope

- In scope: the proof authenticator out of its cookie wrapper with a second
  scope; a closed app-return choice in shared ingress; `start`, the return
  bridge, `complete`, `disconnect`, `sync`; `actions` on the list.
- Out of scope: Murph texting the connect link; the app's connected-source
  drawer; any per-source recent values; Apple Health removal.

## Constraints

- Technical constraints: no caller-supplied URL reaches the provider. No new
  stored state, migration, environment variable or production setting.
- Product/process constraints: no legal document changes and no new consent;
  the start reuses the website's existing health-grant check.

## Risks and mitigations

1. Risk: Junction refuses a second return URL.
   Mitigation: checked first in the Junction sandbox. Link tokens for the two
   bridge URLs were accepted, and a simulated provider denial through
   Junction's own callback redirected to the bridge with `murph_state` kept.
   The sandbox also accepted an unrelated host, so Junction enforces no
   allowlist and the closed choice in ingress is the only guard. Production was
   not checked because that needs the production key.
2. Risk: the proof refactor changes the website cookie.
   Mitigation: the browser scope keeps its signing domain, token prefix,
   payload order and cookie attributes; the existing proof and callback tests
   are unchanged, and a new test shows neither proof satisfies the other check
   even with the prefix swapped.
3. Risk: a connected source is removed more widely than the member asked.
   Mitigation: the app route only calls the one-source disconnect, re-reads the
   member's row at the tap and answers a conflict when removing would mean a
   reset or a Fitbit cutover.
4. Risk: a link someone sends finishes a connection.
   Mitigation: the bridge writes nothing; `complete` needs the member bearer
   and a proof bound to that app session and state, checked before the state
   is touched.

## Tasks

1. Junction sandbox check. Done; see risk 1.
2. Proof authenticator with browser and app scopes.
3. Closed `appReturn` choice at the ingress callback-URL seam.
4. Shared start core for the website and the app; app start route.
5. Return bridge; `complete` with a forwarded query.
6. `disconnect`, `sync`, and `actions` on the list.
7. Owner docs: `ARCHITECTURE.md`, `docs/device-sync-hosted-control-plane.md`.

## Decisions

- A failed proof at `complete` changes nothing. The website discards its own
  member's unconsumed state on a failed proof; the app route does not, so an
  app defect cannot destroy a state the website started. The state expires in
  15 minutes either way.
- App return is limited to link flows (`external_link`), whose completion never
  replays the return URL to the provider.
- `disconnect` needs sign-in but not product access or the health grant: it
  only reduces authority. The settings read gains a disconnect-only switch for
  that one caller.
- `sync` buckets its wake time to the minute so repeated taps collapse.
- The app's list keeps `schemaVersion` 1: `actions` is additive and older
  builds ignore it.

## Verification

- Commands to run: focused Web Vitest for the new routes, the list route, the
  proof, the website start and callback; `packages/device-syncd` ingress tests;
  the Postgres authority suite against a dedicated loopback database; Web
  typecheck and lint; `pnpm test:diff` over the touched paths.
- Expected outcomes: all pass; results recorded in the pull request.
- Outcome: `pnpm test:diff` over the touched paths exit 0; the Postgres suite
  on a dedicated loopback database exit 0; `pnpm complexity:diff` exit 0.
  The final ReviewGPT round runs on the pull request.
Completed: 2026-11-13
