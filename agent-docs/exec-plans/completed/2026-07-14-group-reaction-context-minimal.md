Goal (incl. success criteria):
- Keep PR #651's bounded silent group-reaction context and add the smallest maintainable affirmative-reply path.
- A member's affirmative reaction to Murph's exact outbound message is admitted through the existing ordinary Linq message planner in both private and group chats.
- Success means replacing the conflicted 44-file PR #655 diff with a compact current-main diff, focused production-path coverage, required audits with no unresolved findings, and a passing exact-head ReviewGPT round.

Constraints/Assumptions:
- Start from current `main`, including merged PR #651; do not copy PR #560 or the old PR #655 implementation wholesale.
- Snapshot semantics are intentional: only context already available when a later actionable turn is selected can inform that turn.
- Reuse the existing one-shot group-route context seam and fold one bounded encrypted buffer into the next ordinary message before it enters the assistant-input lifecycle; add no reaction mailbox kind, wake, assistant candidate, queue cursor, reconciliation loop, or delivery-commit guard.
- Reuse the ordinary Linq planner for affirmative reactions; add no schema, rollout flag, group-tool state, bespoke mailbox pipeline, or reaction-specific retry lifecycle.
- Treat Linq payloads and reacted-message content as sensitive untrusted data; keep validation, bounds, and account/route authority explicit.
- Preserve unrelated worktrees, processes, active plans, and ReviewGPT runs.

Key decisions:
- Prefer a narrow producer-to-existing-input path over mid-turn causal invalidation.
- Adapt an admitted affirmative reaction into the existing `message.received` planner input so private/group routing, access, quotas, mailbox dedupe, and wake handoff retain one owner.
- Keep group join-offer acceptance on its existing exact owner before the generic affirmative-reply fallback.
- Keep the newest ten actor-attributed reactions in insertion order inside the same encrypted nullable route column, analogous to the existing participant-addition hint. This is one bounded transient buffer, not a separately processed queue; the next normal group-message transaction consumes it into the existing tolerant mailbox-input sidecar.
- Missing, malformed, or crypto-unavailable optional context must fail open for the ordinary inbound message; only the exact affirmative case above becomes an assistant reply candidate.
- If an existing primitive cannot express silent context without new lifecycle machinery, narrow the product behavior rather than adding machinery.
- Keep tests proportional: prove trust-boundary rejection, silence, same-group inclusion, and cross-group exclusion without duplicating broad assistant lifecycle suites.

State:
- Local implementation and required gates are complete; replace PR #655's old branch and run its exact-head remote gates.

Done:
- Reconstructed PR #560 growth and identified review-driven mid-turn invalidation as the main complexity ratchet.
- Created an isolated branch from current `main`.
- Implemented one encrypted, account-bound route context seam that folds into the next ordinary group message without creating a reaction mailbox item or wake.
- Carried the bounded context through the existing mailbox sidecar and rendered it only as a quoted weak/untrusted prompt hint.
- Added focused ingress, privacy, route transaction, contract, sidecar, prompt, and captureless-turn proof; the coverage-write audit has no unresolved findings.
- Rebased cleanly onto PR #640 and enabled its shared-host verification profile with host concurrency left at the default of one.
- Corrected reaction account authority to derive the sole active self line from the canonical live roster instead of relying on an undocumented webhook field.
- Deleted the speculative account filter on the generic route reader, unused ignored-reason taxonomy, and unnecessary reaction-target part wrappers identified by the simplification pass.
- Kept authoritative join-offer reactions out of ambient next-message context; the simplification review has no remaining findings.
- Added the canonical `is_from_me` fast rejection so self-reactions stop before route or provider reads.
- Added one exact-target adapter that emits the existing message-planner input for both private and group chats, with the reacted-to provider message id and a non-reactable two-part representation.
- Kept group join-offer acceptance first and retained PR #651's silent bounded context for every nonactionable reaction.
- Passed focused tests/lint plus the diff-aware hosted-web owner lane (all repo guards, typecheck, lint, smoke, build, and 5,150 web tests); the fresh coverage-write audit closed retry and ambiguous-roster proof gaps with no remaining findings.

Now:
- Commit the compact diff and replace PR #655's obsolete 44-file branch.

Next:
- Replace PR #655's branch with the compact head, run ReviewGPT concurrently with CI, then close the plan after all exact-head gates pass.

Open questions (UNCONFIRMED if needed):
- None. The user confirmed that full actor attribution and a newest-ten append cap are required context.

Working set (initial; narrow as investigation resolves ownership):
- apps/web/src/lib/hosted-onboarding/{linq-client,linq-provider-events,webhook-provider-linq-reaction-context,webhook-service}.ts
- apps/web/src/lib/hosted-groups/join-offer-reaction.ts
- apps/web/test/hosted-onboarding-{linq-http,linq-provider-events,linq-reaction-context,webhook-idempotency}.test.ts
- ARCHITECTURE.md
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
