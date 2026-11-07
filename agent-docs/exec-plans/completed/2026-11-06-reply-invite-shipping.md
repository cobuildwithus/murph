# Reply email review correction and deployment

Status: completed

## Outcome and owner

Finish PR #4723 and deploy the email/invite authorization fix through managed
Web and protected Cloudflare production workflows.

## Accepted review finding

Final ReviewGPT round 1 on 92fca63cd14f, Mountain, verified GPT-6 Pro, completed
with one high-risk finding after more than eight minutes. Exact prompt/attachment
and completed response were captured with REVIEW_COMPLETE. The parent reproduced
comment-address confusion in the existing runtime-state From resolver: an actual
outsider mailbox plus a different mailbox inside an angle-bracketed comment
selects the comment mailbox. The new trusted-verifier path could therefore
activate a previously closed public route with mistaken sender authority.

Accept and fix at the existing sender parser: support a single bare mailbox or
single display-name mailbox, reject unsupported/ambiguous forms, and require the
same parsed sender in the production verifier and signed Web admission. No new
state, schema, dependency or authority path. This is direct remediation of the
reviewed finding and does not require a second review round.

## Proof and rollout

Add failing regressions for comments, misleading display names, duplicate
mailboxes, noncanonical public ingress and personal aliases. Preserve ordinary
bare and named senders. Run focused package/Worker/Web tests and typechecks.
Keep required exact-head CI green, merge, wait for managed Web production
admission and serving alias, then dispatch the protected Worker-only rollout.
Do not send operator mail to members or inspect member data for smoke proof.

## Progress

Review finding reproduced; correction and deployment in progress.

The source call-site audit confirms that this parser's production callers are
Web email admission and Worker email/bootstrap admission only; no runner effect
uses it. Worker-only rollout remains sufficient despite the shared package.
Focused tests: runtime-state 12, Worker 78, Web callback/privacy 48 passed.
Both composed comment-mailbox Worker regressions fail on the reviewed head.
Canonical bootstrap continues to reject ambiguous identity and never admits
private assistant input. Ordinary named/quoted-name/bare mailboxes pass.

## Correction result and release handoff

Runtime-state, Cloudflare and Web typechecks passed. Complexity diff passed;
the parser correction removes the obsolete address-candidate collection rather
than adding a dependency or authority owner. Parent review accepts the supported
syntax restriction and verifies that quoted display text cannot select a sender.
No remaining accepted review finding is unresolved.

Local correction and release preparation are complete. Exact-head CI, merge,
managed Web production admission, and the protected Worker-only rollout remain
pending as of this immutable record; their receipts are owned by PR #4723 and
the production deployment workflows. No production mutation has occurred yet.
The first CI attempt hit the already-recorded empty-table query-plan instability
(Frog 20261106165915-game-account-deletion), unrelated to this patch; use the
new head's required checks before merge.
Updated: 2026-11-06
Completed: 2026-11-06
