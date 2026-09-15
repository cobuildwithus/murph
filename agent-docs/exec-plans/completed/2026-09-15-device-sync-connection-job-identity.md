# Preserve distinct device connection work during retained retries

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and owner

Keep a new same-epoch source connection request runnable while earlier history
jobs retain their exact progress and retry deadlines. Web owns initial job
identities; the runtime owns atomic transfer into an existing continuation.

## Evidence and change

The producer hashes provider job identity and connection epoch but omits the
connection completion occurrence. A provider can reuse a day-window identity
across separate completions. Runtime admission rejects the resulting collision
and leaves that input and following dirty hints behind ongoing history work.
Prove this with synthetic repeated completion and retained-job tests.

At existing runtime admission, recover canonical job-key collisions with a stable
identity bound to the incoming event. Keep arbitrary collisions, wrong authority,
ambiguous duplicate keys, full queues, and attempted items fail-closed. No new
queue, state schema, scheduler, provider policy, or production mutation.

## Product UX

Outcome: A source connection can start its initial sync during older history retries.
Reaches: Repeated same-day connection completion; existing retained work; cold restore.
Proof: Producer identity, atomic admission, failure/restart, and unchanged backoff.

## Failure and rollout

The existing checkpoint claim owns transfer and recovery. Existing records remain
readable. Producer payloads and their replay identities remain unchanged. Runtime recovery
is required for already-queued collisions. Deploy through the normal reviewed flow;
read-only live diagnostics do not establish deployment or live recovery.

## Verification

- Synthetic producer reproduction established that an occurrence-bound key avoids
  the collision; the final change keeps producer payloads unchanged to preserve replay.
- Runtime coverage and composed mailbox tests plus runtime typecheck.
- Candidate privacy/diff review, complexity guard, and owner-doc check.
- Public artifacts use synthetic evidence only.

## Results and handoff

- The synthetic collision regression failed before the fix: neither the new
  connection request nor its following dirty hint joined the retained owner.
- Runtime focused suites: 228 passed, including atomic claim, failure, restored
  exact identities, retained backoff, unrelated connection and authorization barriers.
- Runtime typecheck passed after all test changes. Web typecheck also passed.
- Changelog archive rendering: 10 passed. The entry has no source PR yet because
  this local task has not opened a PR.
- Complexity guard passed: unchanged debt 5 and maximum 25. The existing parser
  hotspot is unchanged. Docs drift and whitespace checks passed.
- Candidate review: one existing admission boundary changes; no queue, schema,
  producer payload, provider API, permission, or foreground network call changes.
- Product UX: Ready for local patch scope; live recovery remains unverified.
- No production mutation, PR push, external review, or deployment was performed.
  PR review and exact-head CI remain required before shipping. Deploy the runtime
  through its normal workflow and confirm the affected system frontier advances;
  do not treat successful local tests as live incident resolution.
- Existing Frog entries cover fresh-checkout Prisma preparation. No new task-owned
  developer-friction entry was needed.
Completed: 2026-09-15
