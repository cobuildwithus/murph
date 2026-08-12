# Finish direct Linq preparation binding

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Finish the direct-Linq inbound preparation boundary so the exact member and
  mailbox ingress root used by the planner are prepared before `BEGIN`, then
  revalidated under the transaction without provider or KMS work under locks.

## Success criteria

- Direct identity and home-chat candidate reads use narrow blind-index/core
  member projections rather than broad decrypted routing projections.
- Preparation binds the resolved direct member and mailbox ingress root.
- Member, owner, or root drift rolls back and receives at most one fresh
  prepare-before-transaction attempt; repeated drift fails closed.
- Preparation failure may open one transaction to recover an exact durable
  duplicate or settle stable consent/quota owners without private routing;
  an eligible append rethrows the original failure without route mutation,
  append work, or KMS under locks.
- Prepared direct ingress takes control-root authority before a nonblocking
  member-row lock, then home-route and chat-route authority.
- Direct root preparation performs at most two concurrent KMS operations even
  when all six encrypted routing fields reference distinct historical roots.
- Focused hosted Web tests, Web typecheck, scoped lint, privacy/no-JS guards,
  exact-head CI, and required ReviewGPT gates pass.

## Scope

- In scope: direct Linq identity/home-chat resolution, direct mailbox-root
  preparation and binding, bounded preparation retry, and focused tests.
- Out of scope: Telegram, schema or migration changes, new queues, exported
  abstractions, unbounded retries, and new durable attempt state.

## Constraints

- Technical constraints: reuse the existing request-scoped crypto cache,
  privacy blind indexes, narrow member projections, and bounded retry flow.
  Keep provider calls, decryptions, and KMS unwraps outside transactions.
- Product/process constraints: preserve direct-message semantics and recent
  Family invite/recovery behavior; use the worktree/PR lane and exact-head
  completion gates.

## Risks and mitigations

1. Risk: stale preparation encrypts a wake for the wrong member after identity
   or mailbox-root drift.
   Mitigation: bind the exact prepared member/root and revalidate them before
   any transactional mailbox write.
2. Risk: retry logic broadens into hidden state or an unbounded loop.
   Mitigation: reuse the established single retry signal and assert the second
   mismatch fails closed.
3. Risk: the core-candidate change overwrites newer Family changes.
   Mitigation: integrate against current main, inspect the base-to-head diff,
   and retain focused Family tests in the verification slice.
4. Risk: direct ingress and member-first lifecycle owners deadlock on reciprocal
   control-root/member acquisition.
   Mitigation: retain root-first direct ingress, make the following member-row
   acquisition nonblocking, and replay once after releasing root authority.
5. Risk: mandatory direct preparation prevents an exact duplicate from
   repairing a post-commit wake during a KMS outage.
   Mitigation: carry the original preparation failure into a narrow duplicate
   recovery branch and rethrow it for every nonduplicate outcome.
6. Risk: mutable group-outreach state becomes eligible after an ordinary direct
   append commits, then reclassifies the exact provider retry before wake
   repair during a simultaneous preparation outage.
   Mitigation: after active-member authority, treat the unique member/event
   mailbox row as canonical for failure-only recovery and do not consult group
   outreach semantics before that fixed read.
7. Risk: sparse saved-home events have no incoming recipient handle, so a
   thread-only account-key guard can throw before direct preparation records
   either a prepared package or its original failure.
   Mitigation: require the recipient key only for explicit thread/container
   preparation; direct preparation resolves from participant and saved-home
   authority and always returns a package, explicit null, or failure marker.
8. Risk: carrying one preparation failure across the whole active-member path
   can suppress consent-withdrawn and daily-quota outcomes that require no
   private route or mailbox append.
   Mitigation: exact duplicates retain first precedence; stable consent and
   already-at-limit quota owners settle without crypto, while the first branch
   that still needs private routing or append rethrows the original error.

## Tasks

1. Collect and inspect the independent ReviewGPT core and binding patches.
2. Integrate only the smallest compatible current-main change.
3. Add or refine executable drift, zero-transaction, and cache-hit proof.
4. Run focused verification and inspect the privacy-safe diff.
5. Commit through `scripts/finish-task`, publish a draft PR, and run the
   specialist and final exact-head ReviewGPT/CI gates.
6. Resolve actionable findings and merge when every required gate is green.

## Decisions

- Keep the direct-Linq core and mailbox-root binding in one PR because the
  narrow candidate is the preparation input the binding must authenticate.
- Do not duplicate the independently landed fail-fast drain change.
- Preserve the exact duplicate read/wake path during direct KMS failure while
  keeping all mutation and encryption paths fail closed.
- Warm historical control roots sequentially within one control-lane owner;
  ingress remains the only concurrent lane, so peak KMS concurrency is two.
- An ordinary direct mailbox row is the durable classification authority for
  failure-only wake repair. Later group-membership or delivery-state changes
  cannot veto that exact retry, while absence of the row still rethrows the
  original preparation failure.
- Direct saved-home preparation does not require incoming recipient metadata.
  The recipient account key remains mandatory for explicit thread/container
  routes, while sparse direct events use their participant and durable home
  route to prepare outside the transaction.
- A direct preparation failure is deferred only across exact duplicate,
  consent-withdrawn, and already-at-limit quota owners. It is not a new policy
  authority: eligible append, group join, and other private-route work retain
  the exact original failure.

## Review retrospective

- ReviewGPT found that failure-only recovery consulted the mutable group-join
  outreach reader before the unique mailbox dedupe key. That reader performs a
  collection query and per-candidate authority checks, and a delivery becoming
  eligible after an ordinary append could therefore suppress the missing wake
  repair during the same KMS outage.
- The earlier implementation incorrectly treated current group semantics as a
  prerequisite even after the ordinary direct append had durably classified
  the event. The corrected requirement is that active member access and the
  exact `(memberId, eventId)` mailbox row own recovery; group semantics only
  classify events that have not already committed as ordinary direct mail.
- Regression proof covers delivery terminalization after the original append,
  one exact repair handoff with no second append/count/routing mutation, no
  collection read on failure recovery, and a paired missing-row retry that
  preserves the original preparation error.
- ReviewGPT then found that sparse direct events threw at the shared recipient
  account-key guard before the direct branch could return a prepared package
  or failure marker. Because the outer warm-up is best effort, that property
  absence reopened the legacy transaction-time crypto path.
- The corrected boundary keeps the guard on explicit thread/container routes
  only. Production-format sparse saved-home proof now covers pre-transaction
  control/ingress provider work, request-cache-backed routing decrypt, the
  root/member/home/chat/ingress lock order, one append and wake, and sparse
  duplicate failure recovery with the original no-row error preserved.
- ReviewGPT then found that the carried crypto failure still ran ahead of
  canonical consent-withdrawn and daily-quota terminal owners. The correction
  keeps exact duplicate precedence, allows stable consent and quota reply or
  suppression to settle without private routing, and preserves the identical
  failure object for an eligible append.

## Verification

- Commands to run: focused hosted Web Vitest files selected from the final
  diff; opt-in real-PostgreSQL activation concurrency; Web typecheck; scoped
  ESLint; `pnpm test:diff`; privacy and architecture/diff guards; exact-head
  GitHub checks and ReviewGPT gates.
- Expected outcomes: the direct route is unchanged for a stable identity/root;
  drift or member contention gets one fresh pre-transaction preparation;
  preparation/KMS failure recovers an exact duplicate or settles an existing
  no-append policy owner; no new persisted state or privacy expansion.
- Focused proof after the terminal corrections: 224 direct-dispatch and
  mailbox-root-prewarm tests pass, including sparse direct preparation,
  consent drift, quota reply/suppression, exact duplicate recovery, and exact
  eligible-append failure preservation.
Completed: 2026-08-12
