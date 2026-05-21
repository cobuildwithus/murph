# Runtime processing final hardening

Status: active
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Finish the hosted runtime processing cutover so Temporal remains the only
  orchestrator, Cloudflare only accepts/activates processing, and the accepted
  start/wake path cannot hide dead runtime attempts behind stale write fences.

## Success criteria

- `ensureRuntimeProcessing` returns after start/wake acceptance and registers
  background runtime work with Durable Object lifetime ownership.
- Fresh startup races are short-rechecked, while stale non-wakeable write
  fences are replaced instead of reported as healthy.
- Cold-start and replacement acceptance use short rechecks; confirmed active
  wakes may keep the dirty-runtime recheck margin.
- Temporal clamps legacy long ensure timeouts for the new processing Activity
  while keeping legacy ensure-execution compatibility explicit.
- Docs, logs, and tests no longer describe webhook-to-Cloudflare runner nudges
  as the normal path.

## Scope

- In scope:
  - Cloudflare `UserRunner` start/wake lifecycle safeguards and focused tests.
  - Hosted execution ensure-processing contract cleanup.
  - Temporal workflow timeout normalization, wait-reason naming, and focused
    tests.
  - Stale docs/test wording that conflicts with Temporal-only orchestration.
- Out of scope:
  - Removing legacy ensure-execution route/activity before deploy-skew drains.
  - Adding a webhook-to-Cloudflare fast path.
  - Broad hosted-local E2E expansion beyond focused regression proof.

## Constraints

- Preserve unrelated dirty verification/CLI edits in the current checkout.
- Preserve unrelated active plan rows; this plan owns only the files touched for
  runtime-processing hardening.
- Keep Temporal workflow state pointer-only and deterministic.
- Keep Cloudflare logs metadata-only and free of payloads, local paths, raw ids,
  prompts, provider responses, and secrets.

## Tasks

1. Patch Cloudflare lifecycle ownership, stale-fence replacement, and recheck
   timing.
2. Patch Temporal timeout normalization and processing retry naming.
3. Simplify retry-later contract surface and stale terminology where it matters.
4. Add focused regression tests for waitUntil, stale non-wakeable fences, short
   cold-start rechecks, and workflow timeout normalization.
5. Run focused verification plus typecheck, completion audits, and scoped commit.

## Verification

- Pending.
