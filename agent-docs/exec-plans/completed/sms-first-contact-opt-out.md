Goal (incl. success criteria):
- Block standalone SMS/RCS opt-out commands from hosted first-contact invite creation for unknown phone participants.
- Add focused tests for STOP, stop, UNSUBSCRIBE, CANCEL, END, and QUIT.

Constraints/Assumptions:
- Keep the change scoped to hosted first-contact invite gating.
- Preserve existing first-contact invite success for normal SMS/RCS phone messages.
- Do not touch unrelated Temporal active work.

Key decisions:
- Apply stricter standalone opt-out detection only when service is SMS/RCS or unknown with a phone contact.
- Keep the blocker on the first-contact branch after active-member routing, so already-active members are not affected by this change.

State:
- Implementation and verification complete; audit passes in progress.

Done:
- Loaded routing, verification, completion, security, and testing docs.
- Patched hosted Linq first-contact blocked-content detection.
- Added focused first-contact SMS tests for standalone STOP, stop, UNSUBSCRIBE, CANCEL, END, and QUIT.
- Ran `pnpm --dir apps/web test -- hosted-onboarding-linq-dispatch.test.ts` successfully.
- Ran targeted `bash scripts/workspace-verify.sh test:diff ...` successfully; it escalated to `apps/web verify`.
- Coverage worker added RCS STOP plus direct unknown-service phone/email/iMessage helper proof, then reran targeted `test:diff` successfully.
- Security/privacy review found no medium-or-higher findings.
- Final completion review found no findings.

Now:
- Complete.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- Coverage-write model selector is unavailable in current subagent tooling; report if needed.

Working set (files/ids/commands):
- `apps/web/**`
- `agent-docs/exec-plans/active/sms-first-contact-opt-out.md`
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
