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

## Verification

- Passed locally: assistant outbox (101 tests), hosted callbacks (243 tests), Web monitor (8 tests), assistant-engine/runtime/Web typechecks, assistant-engine/runtime builds, runner-bundle assembly, runner-bundle policy tests (50 tests), docs drift, and diff/privacy checks.
- PostgreSQL proofs: three tests are present but skipped locally because the loopback PostgreSQL server is unavailable; exact-head CI owns their execution.
- Remaining: required GitHub Actions and both Review GPT completion gates on the exact pushed PR head.
