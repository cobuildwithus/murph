# Telegram typing at durable admission

## Outcome and ownership

Outcome: acknowledged direct Telegram input starts its first typing request after
durable admission, independently of runner activation. Reaches: fresh admitted
direct messages; duplicates, groups, denied access, and onboarding keep their
existing runtime behavior. Proof: composed webhook ordering and failure tests,
provider-response tests, slow-wake telemetry tests, and affected typechecks.

The existing Web planner owns access, routing, and mailbox deduplication. Return
an ephemeral typing target only after a fresh direct conversation append. Reuse
the existing Telegram API client and ingress latency timestamp; add no durable
owner, timer, retry, or protocol. The runtime retains ongoing typing and replies.

## Evidence and correction

Code currently starts Telegram typing after runtime admission. A delayed native
RPC therefore delays the first indicator even when mailbox admission is fast.
Successful warm wake summaries also discard timing evidence regardless of delay.
Use synthetic delayed-wake proof and retain existing summaries for slow successes.
The upstream platform dispatch delay is not claimed fixed by this change.

## Failure and rollout

Typing is best effort and never blocks wake handoff or changes its result. Record
acceptance only for a successful Bot API JSON response. One request expires under
the provider's ordinary indicator lifetime; the runtime owns refresh. Old/new Web
and Worker releases remain compatible because no wire schema changes. Deploy Web
for earlier acknowledgement and Worker for slow-success diagnostics independently.
Production provider acceptance and latency remain post-deployment checks.

## Work

- [x] Implement admission acknowledgement and slow-success diagnostics.
- [x] Run focused tests, typechecks, complexity review, and privacy review.
- [x] Record verification and complete the scoped commit.

## Verification

- Web: 119 focused tests passed across Telegram client, composed webhook
  dispatch, ingress latency store, and changelog fragments.
- Worker: 11 processing-summary tests passed, including threshold boundaries
  and preservation of native handler timing on a slow successful wake.
- Web and Cloudflare typechecks passed. Complexity diff passed; existing
  planner/service hotspots did not increase. Privacy and whitespace review passed.
- Product UX: Ready for review. Fresh direct input starts typing after commit;
  a held provider acknowledgement does not delay handoff. Replays, groups, denied
  access and malformed/rejected provider responses preserve their existing paths.
- No production messages were sent. Actual provider acceptance and platform
  dispatch latency remain post-deployment checks. A one-shot Telegram indicator
  expires naturally; this patch does not promise continuous coverage of a long
  platform stall or shorten the eventual reply's model execution.
- Implementation and local review are complete in PR #3806. Exact-head CI and
  required external review remain PR gates; merge and production deployment
  remain separate from this implementation record.
Status: completed
Updated: 2026-09-29
Completed: 2026-09-29
