# Exclude draining Linq lines from automatic assignment

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal and invariant

Operators can stop automatic placement on a configured line without disabling
existing direct or group conversations. Existing relationship authority and
provider health checks remain unchanged. Production identifiers stay out of Git.

## Design and scope

The existing HostedLinqLine.assignmentWeight owns placement eligibility: zero
excludes a line, positive weights retain their existing tie-break semantics.
Filter both automatic pools and policy selection, and recheck at proactive
capacity claims. Reuse the ops session and mutation-origin guards for a bounded
read and atomic one-line setting update. No schema migration or new owner.
An attested managed inbound relationship may still bind its contacted line;
this switch controls automatic allocation, not a provider shutdown or migration.

## Product UX

Outcome: new automatic placements use the remaining eligible pool.
Reaches: new signups and proactive outreach; existing members keep their number.
Proof: disabled preference cannot win, exhausted pool does not revive it,
existing inbound/route authority remains valid, operator access is enforced.

## Rollout and risks

Deploy the reader before setting any line to zero. Older builds treat zero as a
low-priority tie breaker, so mixed versions do not guarantee exclusion. Restore
positive weights before rolling back. No production setting changes in this PR.
Zeroing every eligible line intentionally leaves no automatic assignment target;
operators must verify a healthy retained line first. In-flight pre-change work
may complete; no provider calls are canceled or replayed by the setting.

## Tasks and verification

- Implement pool, selector, claim, and authenticated operator control.
- Add focused routing, store, endpoint, and PostgreSQL proof.
- Run relevant tests, Web typecheck, lint, complexity diff, and parent review.
- Open PR, complete exact-head CI and ReviewGPT; preserve the reviewed head.

## Evidence

- Focused routing, store, home-route, and operator endpoint tests: 140 passed.
- PostgreSQL drain/restore test: passed; same-day and rollover capacity claims
  refuse a drained line while incoming line state remains assignable.
- Web typecheck and prepared typecheck: passed.
- Focused Web oxlint: passed with one pre-existing unused parameter warning.
- Complexity diff: passed; no changed source hotspots above 20.
- Parent candidate review: Ready. Existing route ownership and provider inventory
  updates preserve the placement weight; no added calls on the reply path.
- PR CI and external ReviewGPT are the remaining publication gates, tracked on
  the PR rather than by changing the reviewed implementation commit.
Completed: 2026-10-20
