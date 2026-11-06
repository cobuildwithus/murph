# Simplify hosted Responses WebSockets with platform pass-through

Status: completed

## Outcome and invariants

Native Codex retains healthy provider WebSockets across turns without a Murph
frame relay. Keep real provider credentials outside containers, current runner
admission, image entitlement, canonical writes and delivery idempotency.

## Evidence and design

The existing relay accepts both socket halves and forwards every frame through
Worker JavaScript. Returning an unaccepted upgrade uses Cloudflare pass-through
instead. Native memory is disabled; its egress accounting and relay diagnostics
can be deleted. No new transport state, service, retry owner or provider key.

Use the existing image entitlement at upgrade admission. Ineligible or unavailable
admission returns 426 so native Codex uses HTTPS and its existing per-request
image check. Runtime authority is checked on connection admission; already-open
connections follow the existing native process/container lifetime. Consent
withdrawal destroys the container. Keep canonical write fences independent.

## Work and proof

- Delete the relay, its diagnostics, and disabled native-memory egress support.
- Prove unaccepted response identity, real workerd socket reuse/close propagation,
  and pinned Codex warm turns, reconnect/fallback and bounded recovery.
- Preserve image admission, ordinary usage accounting and authority denials.
- Run focused tests/typechecks, review the deletion and update owner docs.
- Commit, prepare a PR, run exact-head CI and ReviewGPT concurrently, address
  concrete findings, and deliver a green ready PR.

## Rollout

Existing Worker and runtime versions remain compatible; no schema or new binding.
Production improvement requires normal Worker rollout. Local workerd proof does
not establish behavior of the managed Containers network; report that boundary
and any available isolated deployed proof honestly.

## Candidate evidence

- Production relay and disabled memory accounting deleted; native Codex and
  Cloudflare own socket reuse and forwarding. No production config changes.
- 260 focused Node tests and four Workers tests pass. The pinned Codex/workerd
  proof retains one socket across 35 seconds of idle, recovers a provider close
  through HTTPS, and falls back to HTTP when image admission is denied.
- Hosted Codex config suite with native auth proof enabled: 58 passed, three
  unrelated opt-in cases skipped; disabled memory remains excluded.
- Cloudflare typecheck, docs drift and complexity guard pass. Existing hotspots
  are the OpenAI policy boundary (26) and provider diagnostic projection (25);
  neither warrants a new abstraction for this transport deletion.
- Ten changelog rendering tests pass. PR #3590 owns the final exact-head CI
  and ReviewGPT gate; implementation/local proof is complete. No production
  deployment is authorized or claimed by this plan.
Updated: 2026-09-19
Completed: 2026-09-19
