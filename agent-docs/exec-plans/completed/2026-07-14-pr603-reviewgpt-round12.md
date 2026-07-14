# PR 603 ReviewGPT Round 12 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Preserve replies to authenticated Telegram inbound targets even when the member's preferred proactive route remains a different, more-specific target.
- Make partial Telegram delivery rollback work for business, forum-topic, and direct-message-topic targets without granting arbitrary delete authority.
- Restore the hosted runner bundle size gate on the final reviewed implementation.

## Accepted findings

1. Provider-entry authorization compares only with the member's mutable preferred Telegram route, so a valid reply target from an accepted inbound message can be rejected when route preference deliberately retains another target.
2. Hosted Telegram rollback rejects `deleteBusinessMessages`, while scoped `deleteMessages` bodies cannot reproduce all canonical target fields, so partial multi-message replies can remain permanently truncated.
3. The pushed head's CI static boot closure is 4,385 bytes above the checked-in runner bundle budget.

## Constraints

- Reuse persisted authenticated mailbox input and the existing member-row lock; add no route table, queue, reconciliation service, or second delivery owner.
- Keep proactive sends bound to the current stored route and preserve bot/token, request-body, write-fence, callback, and upstream-header checks.
- Authorize deletion only with Worker-signed proofs bound to the authenticated member, bot, exact target, and provider message id.
- Preserve terminal ambiguity when rollback genuinely cannot be confirmed; never blindly replay a non-idempotent Telegram send.
- Ratchet the bundle budget only to the measured final static closure size.

## Tasks

1. Add focused regressions proving accepted-inbound reply authority and scoped/business rollback failure.
2. Validate reply authority from persisted Telegram mailbox input under the existing member routing lock, with current-route fallback for proactive sends.
3. Mint and verify bounded Telegram cleanup proofs at the Worker boundary and carry them only in cleanup metadata.
4. Run focused owner tests/typechecks, required coverage and security/privacy re-audits, and the final bundle-size measurement.
5. Finish-task, push the exact head, run ReviewGPT with CI, reconcile the base, and merge when all gates are clean.

## Verification log

- ReviewGPT round 12 on `791c152ec434`: two High findings accepted after static production-path confirmation; the exact-head response includes `REVIEW_COMPLETE` and a matching requested-model response sidecar.
- CI run `29335925452`: hosted runner bundle static closure measured 7,061,472 bytes against a 7,057,087-byte budget; downstream hosted gates failed only through that prerequisite.
- Focused regressions: Web Telegram authorization 9/9, Cloudflare runner egress 232/232, assistant channel runtime 47/47, and operator-config runtime helpers 34/34 passed.
- Changed-owner typechecks passed for contracts, operator-config, assistant-engine, assistant-runtime, Cloudflare, and Web; the diff-aware reverse-dependency typecheck also passed across 22 workspace projects.
- Diff-aware policy, workspace-boundary, stale-name, Temporal, crypto, raw-log, and contracts artifact/test guards passed. Its broad package-test fanout was stopped after unrelated Core/CLI tests hit resource-contention timeouts; isolated reruns passed Core preferences 19/19 and the three timed-out CLI files 22/22.
- Cloudflare verification passed the complete Node surface after the intentional bundle-budget assertion update (1,805 tests total) and the Workers-runtime lane 1/1.
- Web verification passed 4,973 tests with 135 existing skips, lint with zero errors, dev smoke, and the production Next.js build.
- Final runner assembly passed at the reviewed ratchets: 1,472,241-byte entry, 7,094,001-byte static boot closure, and 8,715,570-byte total under the unchanged 9,300,000-byte ceiling.
- Completion coverage remediation passed: Web authorization 11/11, Cloudflare egress/platform 352/352, assistant-engine channel/helper/outbox 127/127, hosted callbacks 166/166, and operator runtime helpers 35/35. These regressions cover exact-message rejection, lock ordering, photo/voice proof minting, cleanup-proof tamper/wrong-bot/duplicate/missing rejection, multi-image reply retention and rollback, proof metadata round-trips, and aligned proof/id batches.
- Post-remediation Cloudflare, Web, assistant-engine, assistant-runtime, and operator-config typechecks passed. Web lint passed with zero errors and 11 unrelated pre-existing warnings.
- Required coverage/write re-audit closed all six findings with zero actionable findings. Required security/privacy audit found zero medium-or-higher findings and confirmed the bounded retained-mailbox authority, proof bindings, upstream header stripping, fail-closed skew behavior, and identifier/secret hygiene.
Completed: 2026-07-14
