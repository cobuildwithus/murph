# Group sponsorship moments

Status: completed
Created: 2026-07-27
Updated: 2026-07-28
PR: #1026

## Goal

Make a verified one-time group usage-credit purchase feel like part of the chat:
the contributor may attach a bounded public alias, note, and temporary harmless
running-bit request, while the existing purchase and credit ledger remain the
only financial owners.

## Scope

- Reuse the saved-card and Checkout lifecycle already merged from PR #996.
- Offer group-only $5, $10, and $20 sponsorship packs while preserving the
  existing personal and Family catalog.
- Freeze optional encrypted sponsorship content with the purchase and treat it
  as untrusted participant-authored data.
- After verified fulfillment, queue one exact-group, replay-safe creative
  acknowledgment and activate an expiring running bit when permitted.
- Project the current bit through the existing mailbox sidecar to ordinary
  route-authorized group turns only.
- Add a server-built sponsorship link to private Murph's group-membership read.
- Cover deletion, authorization, reconciliation, runtime projection, prompt
  boundaries, payment recovery, accessibility, and responsive UI.
- Leave capped automatic refill for a separate later decision and PR.

## Ownership and invariants

- Stripe reconciliation remains the only authority that grants usage.
- `HostedUsageCreditPurchase` and the existing ledger remain the only financial
  sources of truth.
- The browser submits only an offer code, request key, and bounded optional
  participant-authored content. Cash, grant, duration, and creative scale are
  server-owned.
- Funding authority and public customization authority are separate. A valid
  nonparticipant may fund but cannot publish content or activate a bit.
- Custom content is reauthorized after verified payment.
- Quiet or unauthorized sponsorship still grants usage and never exposes payer
  identity or authored content.
- No direct-message fallback, public nonpayer list, sponsor tier/entitlement,
  exact-message ledger, provider-level freshness machinery, second queue, or
  automatic-refill scheduler is added.
- Sponsor material cannot alter health guidance, facts, safety, privacy,
  permissions, routing, tools, scoring, access, or response quality.
- Personal and Family $5/$10/$25 offers remain compatible; historical $25
  purchases remain parseable.

## Implementation route

1. Audit the recovered patch and PR #989 donor code against current `main`.
2. Implement the smallest compatible schema, service, UI, mailbox projection,
   Assistant input, and private-Murph handoff.
3. Add focused owner tests and design-catalog studies.
4. Run `pnpm test:diff` for all touched owners and direct browser/runtime proof.
5. Complete the required product, UI, prompt, coverage, ReviewGPT, acceptance,
   and exact-head CI gates.
6. Close this plan with `scripts/finish-task`, merge PR #1026, close superseded
   PR #989, and retire the task worktree.

## Verification

- Focused Web sponsorship notification tests passed 6/6.
- Focused Web dialog tests passed 45/45, including the ReviewGPT-supplied
  nonparticipant customization case.
- Focused Assistant planning, notification-runtime, and song-tool tests passed
  107/107 after restricting the creative turn to exactly `generate_song`.
- Canonical acceptance passed every feature-owning workspace. Its only failure
  was an unrelated Setup CLI TTY selection under parallel load; the exact file
  passed 6/6 in isolation and the full Setup CLI package passed 124/124 with
  coverage.
- `pnpm test:frontend-design-proof` passed locally for all five changed
  user-facing UI paths after the PR evidence labels were corrected.
- Desktop and mobile `/design` captures exercise the real reusable sponsorship
  component at the $20/three-day and $10/one-day states.
- Preliminary `completion-specialists` ReviewGPT returned two findings. Both
  were resolved: the creative turn now receives only `generate_song`, the
  shared song-tool description defers content policy to the owning prompt, and
  the supplied focused UI coverage patch was inspected before application.
- `git diff --check` passed on the clean pushed candidate.
- Final ReviewGPT, exact-head CI, merge, superseded-PR closure, and worktree
  retirement remain the post-plan PR gates.

## Deployment compatibility

The database migration must be additive. The runtime consumer must accept an
absent sidecar before Web starts producing it. Final rollout guidance must state
the safe database, Cloudflare/runtime, and Web ordering and the rollback floor.

Completed: 2026-07-28
Completed: 2026-07-28
