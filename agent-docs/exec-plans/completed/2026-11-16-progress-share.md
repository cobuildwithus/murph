# Progress share generation

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Goal and scope

Build the backend passed-item drawer on the deletion-aware PR A floor. The
locked share plan sections 11 and 12 own the consent, deployment, pre-admission source
read, model, failure presentation and activity projection decisions. Native UI,
production deployment, live provider proof, ReviewGPT and merging are excluded.

## Implementation

- Exact immutable award reads and shareAwardId on passed rung/route views.
- Strict private share GET/POST, JPEG GET and native consent PUT.
- Pure server copy and per-kind prompts from measure identity and saved targets.
- Prepare one source before admission, serialize quotas/attempt election, and
  schedule the winner through after with an independent 240-second deadline.
- Revalidate authority before effects/publication and after image decryption;
  encrypt generated JPEG bytes with share AAD and preserve terminal identities.
- Failed/refused/expired attempts present the medal and never regenerate.

## Product UX and scope decisions

Feature. Cover default-on and denied pictures, missing profile photo, free exercise invitee,
wearable permission loss, quotas, duplicate opens, background completion, expiry,
profile changes, revoke/regrant and account/session loss. Pure and route tests
cover the server contract; physical-device sharing and real deployment disconnect
proof belong to the integrator/native release. Result: Hold for that handoff.

The existing custom-distance route path can produce named activities beyond
walking/running. Its share card uses "done {activity} over the distance from
{from} to {to}" and depicts that activity, following accepted finding 4; the
plan's copy table did not supply this case. The completed-route drawer requires
it. Opaque activities use a neutral progress-milestone line and no image.

No added tables, endpoints, flags or registries beyond the approved share plan.
The authorized checkout now owns the complete port. No storage guard state was
changed. Share source photo preparation uses GameProfile.photoKey; there is no
Progress-pic relation, no consent question and no partial-image streaming.
Account export belongs to PR A. Plank prompts require flat forearms, elbows under
the shoulders and a straight body. Walking cards and distances omit "about" as
required by section 12. No source identity is stored because nothing reads it.

## Verification

- Focused copy, provider, route, fixture and preserved Progress invariants:
  339 tests in ten files, exit 0.
- PostgreSQL admission, publication and cleanup races: 35 tests in two files,
  exit 0. Synthetic members, real session fences and byte encryption; only the
  provider/root lookup and object-store effects are stubbed.
- Web typecheck and lint: exit 0. Complexity against PR A: exit 0, no hotspots.
- Diff selector: SSH admission exit 1 because no worker target is configured;
  the documented local executor passed, exit 0: 16,238 Web tests, affected
  typechecks, lint, dev smoke and the production build.
- Emitted function configuration confirms maxDuration 300 for all three share
  route modules. Authored-content privacy and diff whitespace checks pass.
- No live OpenAI calls. Parent review and native/deployment proof remain with
  the integrator.

## Deployment

Merge only after PR A is deployed and drained; iOS ships after. PR A remains the
rollback floor while any share object exists. Confirm the deployed Worker store,
300-second deployed route configuration, background/disconnect behavior and live
synthetic image quality before native release. No production changes here.
Completed: 2026-11-16
