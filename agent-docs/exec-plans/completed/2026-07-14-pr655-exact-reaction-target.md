Goal (incl. success criteria):
- Resolve PR #655 ReviewGPT round 2 without adding state or rollout machinery.
- An affirmative reaction always carries the exact attested sent Murph target into model-visible context, including same-session delayed reactions.
- The durable deploy guide records the marker-aware runner-first order and rollback floor for independent Web/Cloudflare deployment.
- Success means focused proof, required coverage audit, green exact-head CI, and a passing ReviewGPT correction round.

Constraints/Assumptions:
- Reuse the outbox deliveries already loaded for attestation; add no provider read, query, schema, queue, state, or lifecycle.
- Preserve cross-session fallback semantics for ordinary inputs.
- Preserve the existing immediate rollout, runner fingerprint admission, and managed-container smoke controls; document rather than duplicate them.
- Preserve private and group reaction behavior and unrelated working-tree/ledger work.

Key decisions:
- Return the exact reply-target delivery separately from the cross-session-only context candidate.
- Render a narrow affirmative-reaction target context from the exact stored outbox message for both same- and cross-session matches.
- Keep the marker-aware runner as a rollback floor once Web can emit synthetic reaction wakes.

State:
- ReviewGPT round 2 findings accepted; implementation and focused proof complete.

Done:
- Confirmed the same-session filter discards the exact target message after attestation.
- Confirmed the existing cross-session context wording is inaccurate for a same-session reaction target.
- Confirmed deploy fingerprint admission and immediate rollout already exist; only the reaction-specific order/floor is missing from the durable deploy guide.
- Reused the already-loaded exact reply-target delivery for same- and cross-session affirmative-reaction context without adding a query or state.
- Documented the marker-aware runner-first rollout and rollback floor using the existing immediate-rollout and fingerprint-smoke controls.
- Added direct same-session older-target proof; the fresh coverage-write audit found no unresolved actionable gap after one test-only assertion improvement.
- Passed focused assistant-engine proof, assistant-engine typecheck/build, diff checks, and diff-aware affected package/app verification.

Now:
- Close the scoped plan and commit.

Next:
- Merge current main without rewriting the first-reviewed ancestor, push, then run ReviewGPT round 3 concurrently with exact-head CI.

Open questions (UNCONFIRMED if needed):
- None.

Working set:
- packages/assistant-engine/src/assistant/automation/reply.ts
- packages/assistant-engine/test/assistant-automation-reply-event-path.test.ts
- apps/cloudflare/DEPLOY.md
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
