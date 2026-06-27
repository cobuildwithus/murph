Goal (incl. success criteria):
- Fix Eragon round 28 PR 320 findings: stale first-contact ownership must apply before explicit Linq thread-route active routing, and same-event invite retries must reuse an older same-event invite before creating a new invite.

Constraints/Assumptions:
- Preserve explicit thread-route behavior for ordinary active routed messages.
- Preserve immutable `linqFirstContactEventId` ownership.
- Keep same-event retry send identity stable across newer invites from other events.

Key decisions:
- Reuse the existing stale first-contact suppression as a planner helper and call it before both explicit thread-route routing and the normal active-member routing path.
- Keep `linqFirstContactEventId` invite ownership in `issueHostedInviteTx`: first try an unexpired same-event invite, then fall back to the latest unexpired invite.
- Preserve same-event retry identity without rebinding invites owned by a different event.

State:
- Ready to commit.

Done:
- Round 28 findings received from Eragon.
- Added explicit thread-route stale first-contact regression.
- Added same-event invite reuse regression when a newer invite belongs to another event.
- Verification completed.

Now:
- Commit and push the round 28 fix, then rerun Eragon.

Next:
- Run Eragon round 29 on the pushed PR head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/src/lib/hosted-onboarding/invite-service.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts
- pnpm --dir apps/web typecheck:prepared
- git diff --check
- pnpm --dir apps/web verify
- pnpm typecheck (fails unrelated assistant/operator-config baseline)
Status: completed
Updated: 2026-06-27
Completed: 2026-06-27
