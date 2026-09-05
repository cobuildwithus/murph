# One terminal Linq send retry

## Outcome and scope

Recover a runtime-owned iMessage after the provider reports code 4001 with
the exact terminal reason "Message send failed". Retry each failed provider
message at most once, preserving its chat, sender, content, and current egress
restrictions. Other failure reasons keep their current behavior.

## Product UX Patch

- Outcome: an existing conversation can receive the original reply after one
  definitive provider send failure without a regenerated response.
- Reaches: direct and group runtime deliveries, including individual failed
  parts of a multi-message delivery. Manual/provider-only sends and existing
  Web-owned onboarding recovery remain with their current owners.
- Proof: synthetic provider and database tests cover recovery, duplicate and
  concurrent receipts, second failure, late receipt ordering, policy blocks,
  and recovery after acceptance/receipt ordering races.

## Architecture

Use the existing delivery/message owner for the one-attempt claim and replacement
provider correlation. Read the failed message through the official provider SDK
outside database transactions; never persist or log its body. Reuse existing
route/access and line/chat egress checks. No new queue, scheduler, model turn,
dependency, or production-secret access.

Provider retrieval must prove the same failed outbound message and chat before
reconstructing a send. Omit automatic retries for representations whose original
send semantics cannot be recovered exactly. Bound recovery to recent deliveries.
Keep all failures observable.

## Work

- [x] Implement bounded retry and receipt correlation.
- [x] Add focused composed and concurrency proof; run Web typecheck.
- [x] Update durable contracts and member-facing changelog.
- [ ] Parent review, scoped candidate commit, draft PR, exact-head ReviewGPT
  concurrent with CI, final plan closure and scoped commit.

## Evidence

Linq's official code-4001 reference recommends resending, distinguishes terminal
send failure from potentially late delivery failure, and specifies no delay or
retry count: https://docs.linqapp.com/channel/imessage/error/codes/4xxx/4001/

No production rows, identities, messages, or incident details belong in this plan
or its fixtures.

## Candidate proof and walkthrough

- Ready: direct recipients receive the same synthetic content in the same chat;
  concurrent receipts produce one provider send. Group recovery sends only the
  failed message part and preserves the no-receipt status until delivery proof.
- Ready: duplicate receipts and original acceptance replay preserve replacement
  delivery; receipts that precede acceptance catch up through the same owner.
  A second failure, ambiguous dispatch, invalid replacement identity, expired
  delivery, or changed restriction cannot create an extra retry.
- Provider-boundary/PostgreSQL, request reconstruction, HTTP, and delivery-route
  suites: 116 tests passed. Existing observability-store and changelog rendering
  suites: 158 tests passed. Web prepared typecheck passed after regenerating the
  schema client. Complexity diff passed with no added debt; the new owner peaks
  at 17 and existing hotspots retain their policy boundaries.
- Excluded voice memos and interactive cards retain their existing behavior.
  This is transport recovery of an already authored reply; model input, tool
  choice, and generated reply content do not change, so live-model proof is not
  applicable. No production resend was performed.
- The saved implementation session ended before candidate commit. This session
  resumes that same task branch after confirming its recorded base, dirty scope,
  and absence of a PR. Graft and its graph are unavailable in this checkout;
  exact owner reads and focused searches supplied repository context.

ReviewGPT and exact-head required CI remain pending.
