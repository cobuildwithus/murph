# Address-book retention follow-up

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Keep an opted-in address-book projection active until the member stops
  sharing, deletes the account, or the companion next reconciles revoked
  Contacts permission in the foreground.
- Add a separate iOS pull-request gate that requires exact-head simulator evidence for user-facing SwiftUI changes.

## Success criteria

- The backend schema, status contract, read path, and hosted retention job contain no time-based address-book expiry.
- Explicit stop, permission-loss cleanup, account deletion, CAS/replay safety, feature gates, and privacy boundaries remain unchanged.
- The iOS feature PR remains on its already-reviewed head, while an independent tooling PR adds and tests a visual-proof gate for future UI changes.
- Focused backend and iOS tooling checks pass, the affected PR descriptions remain truthful, and the required review gates complete.

## Scope

- In scope: the unmerged address-book projection migration and implementation, current architecture/security/product docs, focused backend tests, and independent iOS visual-proof workflow/tooling.
- Out of scope: phone-token cryptography, advisory-name authority, Contacts onboarding UI behavior, signup prefill, contact refresh/background observation, and deployment.

## Constraints

- Delete the unused timer, column, index, cleanup owner, response field, and tests rather than preserving an unshipped compatibility shape.
- Do not modify the immutable completed execution plan for the earlier architecture.
- Keep the screenshot gate dependency-free and outside the iOS ReviewGPT protected control-plane paths.
- Do not change the exact reviewed iOS contact-feature head.

## Risks and mitigations

1. Risk: removing expiry could accidentally make deletion unavailable.
   Mitigation: retain authenticated DELETE after access loss and all existing CAS/replay tests.
2. Risk: an enabled projection could be read without current member access or consent.
   Mitigation: preserve the existing live owner access and launch-consent checks on every advisory lookup.
3. Risk: a visual-proof check could accept stale or unrelated screenshots.
   Mitigation: require changed tracked PNG evidence, an exact PR-head marker, and exact-head raw GitHub image URLs in the rendered PR body.
4. Risk: screenshot tooling could invalidate the five-round-reviewed feature PR.
   Mitigation: land it on a separate branch and PR based on iOS `main`.

## Tasks

1. Remove address-book TTL state and retention cleanup from backend code, schema, migration, tests, and current docs.
2. Run focused backend verification and inspect the final privacy/deletion path.
3. Add and locally test an independent iOS exact-head visual-proof check, workflow, template, and routing note.
4. Capture/read back the current contact-onboarding screenshots and update the existing iOS feature PR body without changing its head.
5. Commit, push, run the applicable independent reviews, and report the deployment configuration and remaining hosted-CI blocker.

## Decisions

- Retention is user-controlled rather than time-controlled: projection rows remain until explicit stop, permission-revocation reconciliation, or account deletion.
- Provider/session/recipient copies of labels retain their own existing lifecycle and remain outside this projection deletion guarantee.
- The iOS gate uses committed simulator PNGs and exact immutable raw-GitHub URLs, avoiding another image host, credential, or dependency.

## Verification

- Pending.
Completed: 2026-07-26
