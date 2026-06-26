Goal (incl. success criteria):
- Gate only the unknown Linq first-contact signup-link path with a model-backed admission check.
- Preserve existing cheap exits for non-message events, group chats, own messages, known active members, deterministic blocked content, undeliverable contacts, and normal active-member routing.
- Success means classifier-denied first contacts create no member, invite, reply, read receipt, or wake side effect, while allowed first contacts continue through the existing invite path.

Constraints/Assumptions:
- Keep the route thin and keep planning/mutations inside the existing hosted onboarding transaction shape.
- Run classifier work outside the database transaction.
- Fail closed when enforcement is enabled and classification cannot produce an allow decision.
- Do not add new dependencies or new durable state owners.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Use an env-gated `off`/`enforce` rollout mode that defaults to `off`.
- Re-run the existing Linq planner after classification instead of moving invite logic into the service.
- Use direct Responses API `fetch` to avoid adding an SDK dependency.

State:
- Completed; PR review fixes applied.

Done:
- Read supplied task note and patch intent.
- Created isolated worktree/branch from current `origin/main`.
- Added env-gated first-contact admission classifier with fail-closed behavior.
- Wired Linq webhook planning to request classification only after existing cheap first-contact filters and before member/invite side effects.
- Added focused unit/dispatch/env coverage and updated architecture/security docs.
- Verified with focused tests, app typecheck, lint, and repo diff verifier.
- Addressed ReviewGPT round 1 findings: no reclassification for existing members, timeout covers body parsing, malformed confidence fails closed, classifier logs have stable failure categories, unused metadata/rationale fields removed, and security docs describe the bounded first-contact text egress boundary precisely.
- Addressed ReviewGPT round 2 findings: block decisions are terminal in the service, classifier unavailability throws typed non-2xx errors for provider retry, and classifier failure logging now routes through hosted onboarding's shared error redaction path.

Now:
- Rerun ReviewGPT on the updated PR head after round 2 fixes.

Next:
- Sync `main` if required after a zero-finding review round and wait for final CI.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/env.ts
- apps/web/src/lib/hosted-onboarding/linq-first-contact-admission.ts
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq-types.ts
- apps/web/src/lib/hosted-onboarding/webhook-service.ts
- apps/web/test/hosted-onboarding-env.test.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
