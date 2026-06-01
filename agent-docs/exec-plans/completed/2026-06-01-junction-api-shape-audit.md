# Junction API Shape Audit

## Goal

Align Murph's Junction REST client with the current documented API shapes for
summary, timeseries, user, link, provider-management, device, introspection, and
webhook-driven reads.

## Constraints

- Keep the fix narrow and client-owned where possible.
- Do not add a second Junction resource registry.
- Do not log, persist, or document raw provider payloads or identifiers.
- Preserve existing date-time behavior for Junction resources whose docs allow
  ISO date times.

## Plan

1. Compare local Junction endpoints against official Junction docs through
   endpoint-group subagents.
2. Confirm any reported mismatches directly against implementation and docs.
3. Patch only confirmed data-read shape mismatches in the shared Junction client.
4. Add focused regression coverage for date-only summary resources and documented
   summary envelopes.
5. Run focused device-sync verification plus required completion audits.

## Verification

- Focused Junction provider/client tests.
- `pnpm --dir packages/device-syncd typecheck`
- Diff-aware package verification if the final diff remains scoped.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
