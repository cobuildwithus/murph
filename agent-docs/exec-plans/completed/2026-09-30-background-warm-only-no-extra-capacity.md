# Use existing ready capacity for background startup

## Intent and scope

Supersede the prior extra-capacity proposal: keep the configured standby target
and container limits unchanged. Background work uses a retained warm runner or
an existing ready slot. An empty pool releases its brief member admission and
retries without a cold start. Remove the new reserve policy, background pool RPC,
and extra-inventory calculation; preserve warm-only readiness and dispatch.

## Decisions and product behavior

Use the existing coordinator claim for both modes. Background can consume shared
ready slots, so foreground may still need its own cold fallback. The guarantee
is removal of background cold startup under the member fence, not an absolute
latency bound or separate resource quota. Background freshness may be deferred.
No new capacity, queue owner, dependency, persistent state, or provider call.

## Verification and completion

- [x] Remove added capacity and reserve machinery; update live owner docs.
- [x] Run focused runtime, pool, receiver, deploy tests and Cloudflare typecheck.
- [x] Inspect the final diff and request a narrower Opus 5.5 review.
- [x] Prepare the scoped candidate commit and updated task PR evidence.

Remaining completion gates are recorded on the PR: capture the additional Opus
review, resolve final exact-head ReviewGPT, and require green exact-head CI.
The preceding full review passed on the superseded candidate; it does not
substitute for final-head proof.

## Evidence

Focused proof: 495 tests across five suites, Cloudflare typecheck, complexity
guard, diff check, and 10 changelog rendering tests pass. The concurrent pool
response test admits foreground after the one-second background timeout while
a late response cannot launch. The 100-claim SQLite burst consumes only the
existing two-slot inventory, replays exactly, then refills to the same target.
Single-slot deployment remains supported; no reserve-plus-one calculation remains.

Parent review traced target selection, exact retirement, native warm-only I/O,
old-receiver handling, and pool sharing. Shared inventory is intentionally not a
foreground capacity guarantee. The earlier completed plan remains historical
evidence of the superseded candidate, not the current inventory contract.
Status: completed
Updated: 2026-09-30
Completed: 2026-09-30
