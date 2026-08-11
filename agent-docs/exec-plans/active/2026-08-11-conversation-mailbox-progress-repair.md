# Conversation mailbox progress repair

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Ensure accepted hosted Linq reactions durably consume the exact conversation mailbox inputs they answered, and ensure progress alerts count only genuinely unconsumed conversation work.

## Success criteria

- Accepted reaction delivery records exact answered mailbox item IDs and retries only the authenticated Web confirmation, never the provider send.
- The progress monitor excludes rows already marked consumed before choosing a lane head or counting pending work.
- The monitor's raw candidate scan is bounded without changing system-lane semantics.
- Focused engine, runtime, and Web tests plus package typechecks pass.
- A standalone PR targets current `main` and does not contain the paired system-mailbox PR changes.

## Scope

- In scope: reaction outbox metadata, accepted-delivery replay confirmation, signed exact-consume callback reuse, conversation progress-monitor filtering, regression coverage, and owning reliability/protocol docs.
- Out of scope: system-mailbox execution, device sync, Temporal orchestration, PR #1597, PR #24, deployment, and production backlog mutation.

## Constraints

- Technical constraints: preserve provider-delivery idempotency; Web remains the authenticated owner of mailbox consumption; no new queue, scheduler, lifecycle owner, or persisted cursor.
- Product/process constraints: use Review GPT's returned patch as the implementation basis, preserve foreground behavior, keep diagnostics metadata-only, and satisfy the repository's PR review and verification gates.

## Risks and mitigations

1. Risk: retrying confirmation could resend a reaction already accepted by Linq.
   Mitigation: retain the accepted receipt and retry only exact Web consumption.
2. Risk: filtering too late could leave an already consumed row as the reported head.
   Mitigation: apply `consumed_at IS NULL` in the database candidate query and cover head/count behavior with unit and PostgreSQL tests.
3. Risk: the patch was prepared from a different worktree snapshot.
   Mitigation: apply it to current `main`, inspect every changed path, and run current-base focused tests and typechecks.

## Tasks

1. Inspect and apply the Review GPT patch to the isolated current-main worktree.
2. Review exact-consume ownership, accepted-receipt retry behavior, and monitor query bounds.
3. Run focused tests, package typechecks, docs checks, and privacy/diff hygiene.
4. Commit and push the scoped branch, open the PR, and run required CI and Review GPT gates.

## Decisions

- Reuse the existing signed exact-consume callback; do not add a second mailbox-consumption API.
- Keep the provider receipt as the durable retry owner after acceptance so a failed Web confirmation cannot replay the provider reaction.
- Filter conversation rows at the database boundary while leaving system-lane selection unchanged.
- After current-main integration, make the durable delivered intent the dispatch-failure owner before the confirmation hook; this lets failure classification see the concrete reaction receipt instead of misclassifying it as provider ambiguity.
- Treat a fresh exact-consume reaction with no delivery receipt as an ordinary provider send; the recovery hook handles only intents that already carry delivery evidence.
- Make only a concrete accepted Linq reaction receipt with exact answered IDs schedulable for callback-only retry. Ambiguous non-idempotent sends remain parked and cannot replay.
- Prove the admitted 100-ID Web boundary as one set-based transaction and an idempotent replay instead of adding batching or another persistence layer.

## Review round 2 retrospective

- Original requirement: once Linq accepts a reaction and the concrete receipt names exact answered mailbox items, the remaining work is irrevocable post-provider bookkeeping until exact Web confirmation reaches a durable terminal state. Current automation and route authority may govern fresh provider work but must not revoke that bookkeeping obligation.
- Current implementation: the existing receipt classifier correctly admitted callback-only retries, and the outbox dispatcher correctly resolved those receipts before provider or route work. However, the hosted delivery wrapper ran the mutable auto-reply channel gate before entering that resolver, so disabling auto-reply after provider acceptance could terminally fail the intent and clear the confirmation obligation.
- Review-growth check: the prior review repair changed 12 behavior-source lines in the hosted callback owner (nine additions and three removals). The repeat finding came from gate ordering at the same provider-acceptance phase boundary, not from a new queue, scheduler, lifecycle, or persistence owner.
- Ownership decision: keep the accepted receipt and exact-consume hook as the existing post-provider owner. Classify the disabled-channel gate as fresh-provider-only, bypass it only for a concrete accepted reaction receipt awaiting exact consumption, and leave the dispatcher responsible for confirmation and terminalization. Fresh sends without a receipt still use the channel gate; ambiguous non-idempotent sends remain parked.
- Regression decision: prove channel revocation between provider acceptance and callback retry, exact-consume confirmation once, no provider or route-authority replay, and no terminal mirror mutation. Preserve the existing fresh-disabled and ambiguous-no-receipt proofs.

## Verification

- Passed locally: assistant outbox (101 tests), hosted callbacks plus the real Linq outbox regression (255 tests), focused Web route/store/monitor coverage (158 tests), assistant-engine/runtime/Web typechecks, assistant-engine/runtime builds, runner-bundle assembly, runner-bundle policy tests (50 tests), docs drift, and diff/privacy checks.
- PostgreSQL proofs: three tests are present but skipped locally because the loopback PostgreSQL server is unavailable; exact-head CI owns their execution.
- Review GPT round 1 accepted findings: repaired fresh-intent resolver ordering, concrete-receipt wake ownership, and maximum-cardinality transactional proof. The preliminary specialist pass returned the same wake-ownership finding plus the coverage bound; no patch artifact was returned.
- Review GPT round 2 accepted the three round-1 repairs and required this retrospective for the repeated provider-acceptance phase-boundary defect before tactical remediation.
- Remaining: push the corrected candidate, obtain a passing final Review GPT round, finish exact-head GitHub Actions, and close this plan.
