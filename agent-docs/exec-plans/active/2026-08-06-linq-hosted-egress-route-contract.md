# Linq hosted egress route contract

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Prevent hosted Linq client routes and the Cloudflare production egress
  allowlist from drifting independently.
- Restore the iMessage capability probe without broadening Linq egress beyond
  the exact runtime operations Murph owns.

## Root-cause proof

- The Linq runtime correctly issues `POST /capability/check_imessage`.
- The hosted-local card journey uses a Linq stub and therefore proved the card
  behavior without traversing the production Cloudflare egress matcher.
- Cloudflare had a separately maintained route matrix that omitted the
  capability endpoint, so the Worker returned 403 before the request reached
  Linq.
- The existing interceptor regression was production-faithful but manually
  duplicated the client routes, allowing both lists to drift together
  unnoticed.

## Success criteria

- One typed contract owns every hosted Linq method, path shape, and diagnostic
  operation.
- Linq runtime callsites build their method and path from that contract.
- The production Cloudflare interceptor matches the same contract and remains
  fail-closed for webhook/control-plane and unknown routes.
- A table-driven interceptor-to-stub-upstream test executes every declared
  route, including the iMessage capability probe.

## Constraints

- Do not add a secret-dependent live-Linq CI lane.
- Preserve Worker-owned credential injection, active write-fence checks,
  provider diagnostics, and unsupported-route denial.
- Keep webhook subscription management outside hosted runtime egress.

## Tasks

1. [x] Capture the current client, interceptor, and hosted-local ownership gap.
2. [x] Add the shared hosted Linq route contract and focused contract tests.
3. [x] Move runtime request construction and Worker matching to the contract.
4. [x] Generate the Cloudflare route matrix from the contract and add the
   capability probe fixture.
5. [ ] Run focused tests, typechecks, and final diff review.
6. [ ] Push the reviewed candidate, complete PR gates, and archive this plan.

## Verification log

- Pending focused verification.
