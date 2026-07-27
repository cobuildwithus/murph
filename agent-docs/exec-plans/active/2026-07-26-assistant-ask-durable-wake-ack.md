# Assistant Ask durable wake acknowledgment

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Return Assistant Ask request/completion success only after Temporal accepts
  the durable mailbox signal.
- Keep the existing payloadless Cloudflare direct wake as a best-effort latency
  hint that starts only after Temporal acceptance.

## Proven cause

- The mailbox append is committed transactionally, but the former
  post-response scheduler deferred the Temporal signal with Next.js `after()`.
- A rejected deferred signal is swallowed, so both Assistant Ask HTTP routes
  can return `200` even though no durable wake owner accepted the work.
- Exact Assistant Ask mailbox identities already make caller retry safe; no
  second queue, receipt, scheduler, or persisted state is needed.

## Constraints

- Preserve the encrypted mailbox as the only durable Assistant Ask work owner.
- Preserve Temporal as the sole durable wake and reconciliation authority.
- Preserve request/completion idempotency and the direct wake's best-effort
  behavior.
- Do not overlap the active hosted-ingress wake-repair lane.

## Approach

1. Replace the post-response scheduler with one awaited mailbox handoff that
   signals Temporal first and starts the existing direct wake second.
2. Await that handoff at both Assistant Ask HTTP boundaries.
3. Add focused helper and route regressions for Temporal rejection and wake
   ordering.
4. Run canonical diff verification and acceptance, preliminary
   completion-specialists ReviewGPT, parent review, and final PR ReviewGPT with
   exact-head CI.

## Verification

- Focused hosted mailbox-wake, group-tool route, and Assistant Ask runtime-route
  Vitest files.
- `pnpm test:diff ...` for every changed path.
- `pnpm verify:acceptance`.
- Preliminary `completion-specialists`, parent final review, then final
  `pr-review` rounds concurrent with CI.

## Deployment

- Web-only control-flow correction. No Cloudflare/runtime API or schema change.
