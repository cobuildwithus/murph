# Wearable notification replay

## Outcome and invariant

Repeated device-sync applies reuse one immutable recovery notification per
silence episode, without false mailbox payload conflicts. Preserve current
source, access, outreach, recent-inbound, and direct-route eligibility checks.

## Evidence and ownership

The source-delivery-stall materializer rebuilds pending notifications using
each attempt's timestamp under an episode-stable key. Mailbox dedupe correctly
detects different payload hashes. Fix the materializer; retain strict mailbox
comparison and the existing stored notification as authority.

Serialize materialization on the existing source row, then reread the mailbox
identity after eligibility checks. Return an existing item without rebuilding
its envelope. No new state, queue, dependency, or protocol is needed. Crypto
preparation stays outside the bounded database transaction; signaling stays
after commit. Concurrent callbacks converge on the first stored item.

## Product UX

- Outcome: Preserve the existing single private wearable check-in.
- Reaches: Initial, pending, consumed, concurrent, and newly ineligible episodes.
- Proof: Focused replay and suppression tests, mailbox regression tests, Web
  typecheck, scoped lint, and parent diff review. Live delivery is outside this
  local patch's proof.

## Verification and delivery

- [x] Reproduce the repeated-pending append defect: the updated replay test
  failed because the original materializer attempted another append.
- [x] Implement reuse with serialized first materialization.
- [x] Run focused tests: 205 passed across the materializer, runtime apply,
  prepared mailbox append, and mailbox store. The final expanded materializer
  suite passes 27 tests, including overlapping attempts and failed-signal retry.
- [x] Web typecheck, scoped ESLint, and complexity guard pass. The transaction
  callback retains its existing complexity of 23; no new abstraction is needed.
- [x] Parent review confirms unchanged eligibility and envelope contracts,
  source-before-mailbox lock ordering, and post-commit signaling. Privacy and
  diff checks pass. Product UX: Ready for the bounded retry correction.

Local proof covers application concurrency using a serialized transaction
fixture; it does not claim a live provider send or production deployment.
Final source, test, and owner-document changes are ready for a scoped commit.

Web-only implementation change; existing rows and envelope schemas are
unchanged. No Cloudflare release or database migration is required. Mixed old
Web instances may continue logging conflicts until they finish draining.
Changelog: internal retry correction with unchanged copy and delivery policy.
Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
