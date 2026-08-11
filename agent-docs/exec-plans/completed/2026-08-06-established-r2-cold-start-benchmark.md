# Established R2 cold-start benchmark

## Goal

Extend the existing manual hosted-local cold-start benchmark with an
established-workspace lane that restores a real v2 direct-R2 snapshot after a
deterministic cold-container transition. Keep the benchmark usable as an
identical overlay on exact-main and candidate heads so latency changes are
measured rather than inferred.

## Scope

- Reuse the existing full-stack cold-start scenario and provider/Linq stubs.
- Publish a production-median-sized synthetic setup turn through the real
  direct-R2 checkpoint path.
- Verify the exact encrypted object through hosted-local MinIO before timing.
- Restart the entire hosted-local stack with the same isolated database,
  MinIO data, and crypto material but fresh Durable Object state.
- Seed only the Wrangler-emulated locator marker needed while local bridge mode
  checks bucket presence; keep the encrypted object solely in MinIO.
- Attribute the measured provider request, delivery, runtime logs, and cold
  restore latency trace to one exact attempt.
- Emit numeric phase timings only; do not emit message content or identifiers.

## Invariants

- Setup activity stays outside the measured window.
- Recovered/retried attempts are rejected instead of included in percentiles.
- Snapshot integrity and size, mailbox consumption, provider count, delivery
  count, cold App Server initialization, and exact trace bytes are all required
  for a valid sample.
- The benchmark remains manual-only and uses synthetic local data.
- No environment is deployed and no PR is merged.

## Verification

1. Focused helper and harness tests.
2. Cloudflare and Web typechecks for the changed surfaces.
3. One production-median-sized established-v2-r2 hosted-local smoke sample.
4. Exact diff and privacy scan before the scoped commit.

Status: completed
Updated: 2026-08-06
Completed: 2026-08-06
