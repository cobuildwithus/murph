# Finish direct Linq preparation binding

Status: completed
Created: 2026-08-11
Updated: 2026-08-13

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
  duplicate or settle a withdrawn-consent owner without private routing;
  an eligible append rethrows the original failure without route mutation,
  append work, or KMS under locks.
- Prepared direct ingress takes control-root authority before a nonblocking
  member-row lock, then home-route and chat-route authority.
- Direct root preparation performs at most two concurrent KMS operations even
  when all six encrypted routing fields reference distinct historical roots.
- Stable inactive existing members prepare a missing control root before
  private Family, group-reply, instant-start, signup, or route policy runs;
  active mailbox work additionally prepares ingress, while a Family token
  prepares every activation domain.
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
   can suppress a consent-withdrawn outcome that requires no private route or
   mailbox append, while carrying it into quota policy can let new policy state
   mask required preparation failure.
   Mitigation: exact duplicates retain first precedence and withdrawn consent
   settles without crypto; quota, Family, group, and other branches retain the
   original preparation failure before their policy or private-state work.
9. Risk: evaluating quota, Family, or group owners before the failure gate can
   reopen policy reads, collection scans, private routing projection, or KMS
   while the transaction is open.
   Mitigation: rethrow immediately after exact duplicate and consent handling,
   before quota admission or any Family or group owner.
10. Risk: an existing but inactive direct member is excluded from mailbox-root
    prewarm even though Family, group-reply, instant-start, signup, and route
    policy can still decrypt or rewrite that member's private routing and a
    Family acceptance can provision every activation root.
    Mitigation: split narrow direct-member resolution from mailbox eligibility;
    pre-sign a control candidate for ordinary inactive handling or all four
    domain candidates for a valid Family token, then commit only prepared roots
    after revalidating control, member, home, chat, routing, and invite state.

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
- A direct preparation failure is deferred only across exact duplicate and
  consent-withdrawn owners. It is not a new policy authority: quota, eligible
  append, group join, and other private-route work retain the exact original
  failure.
- The failure gate sits before quota admission, Family token resolution, and
  group-outreach classification. None of those owners is consulted when direct
  preparation failed.
- Existing-member preparation is no longer synonymous with mailbox access.
  The outer phase always prepares control for a stable direct member, prepares
  ingress only for active mailbox work, and prepares all activation domains
  for the exact Family token revalidated by the transaction. Candidate signing
  and control/ingress unwrap lanes are independently capped at two provider
  operations.
- A bounded route-authority retry reuses any still-uncommitted signed
  candidates from the rolled-back attempt after re-reading active domains.
  This keeps the request-scoped `@active` unwrap cache bound to one candidate
  while still discarding a candidate when another writer has committed a root.
- After the shared prepared-crypto capability landed on main, direct control
  and ingress authority use its request-local opaque tokens and exact prepared
  mailbox append. The raw candidate map remains only for all-domain Family
  activation; transaction-local private reads run cache-only and typed root
  drift is converted into the existing bounded direct-preparation retry.

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
  canonical consent-withdrawn handling. An intermediate correction also let an
  already-at-limit quota outcome cross the failure, but later audit verification
  removed that shortcut because mutable quota policy must not mask required
  preparation failure. The final boundary retains exact duplicate precedence,
  lets withdrawn consent settle without private routing, and rethrows the
  identical failure before quota, Family, group, or eligible-append work.
- Control- and ingress-root failure proofs seed an otherwise eligible group
  delivery and a valid Family token, then assert the exact original error, zero
  quota/Family/group traversal, zero post-`BEGIN` provider work, and no route,
  mailbox, daily-count, invite, or response mutation.
- ReviewGPT round 7 found that the mailbox-eligibility resolver still excluded
  stable inactive existing members even though later direct branches could
  project private routing or activate all Family crypto domains. The correction
  introduces a narrower preparation-member resolver, commits a prepared
  control candidate before any private routing policy, forwards the exact
  preflight Family candidate set through phone acceptance, and defers ingress
  authority until an active mailbox path is actually reached.
- Regression proof now covers inactive group handling with control-only
  preparation, Family acceptance with all four candidates signed and warmed
  before `BEGIN`, candidate-signing failure with zero Family/group/daily/route/
  mailbox mutation, and opaque prepared-root drift across the inactive-to-active
  transition. The earlier manual-root PostgreSQL fixture was retired after the
  shared prepared-capability contract landed on main.
- The final retry review also retained the same ephemeral candidates across a
  rolled-back direct-authority retry. The domain-root unit proof verifies that
  reuse performs no additional signing calls, and dispatch proof verifies that
  the second preparation receives the prior candidate set.

## Verification

- Commands run: focused hosted Web Vitest files selected from the final diff;
  Web and workspace typechecks; scoped ESLint; `pnpm test:diff`; privacy and
  architecture/diff guards. Exact-head GitHub checks remain the publish gate.
- Expected outcomes: the direct route is unchanged for a stable identity/root;
  drift or member contention gets one fresh pre-transaction preparation;
  preparation/KMS failure recovers an exact duplicate or settles withdrawn
  consent; no new persisted state or privacy expansion.
- Final affected slice: 708 tests pass across nine hosted crypto, Family,
  mailbox, dispatch, prewarm, thread-route, usage-reset, and idempotency files.
  Workspace typecheck and the authoritative diff verifier pass; the latter
  covers 730 passing files and 9,890 passing tests, zero-error lint, dev smoke,
  and a production build.
Completed: 2026-08-13
