# Hosted Linq Welcome Identity Fix

## Goal

Fix the hosted Linq/iMessage duplicate welcome by making signup notifications and inbound Linq imports resolve the same assistant conversation identity.

## Scope

- Share the hosted assistant identifier blinding helper instead of keeping it runtime-local.
- Use the shared assistant-facing identifiers for Linq signup notification routes while keeping raw Linq identifiers only for delivery.
- Convert the duplicate-welcome characterization into a regression test that expects the follow-up onboarding question and transcript continuity.

## Constraints

- Preserve privacy: do not persist or log raw contact identifiers in prompts/tests/docs beyond synthetic test constants.
- Preserve unrelated dirty work in assistant-runtime, device-sync, hosted-local dev, and Health Commons lanes.
- Do not change prompt copy as the fix.
- Export the identifier helper through a dedicated hosted-execution public subpath so the root package export does not pull crypto helpers into unrelated callers.

## Verification

- `pnpm test:diff` with the intended touched-file set passed before the final security-review fix, covering assistant-runtime, hosted-execution, apps/cloudflare verify, apps/web verify, and reverse dependents.
- Security/privacy review found raw `delivery.target` was still used as assistant-facing thread identity in runtime notification handling; source and runtime tests now keep `route.threadId` separate from raw delivery target.
- Task-finish review found raw `delivery.target` could not be passed through `deliveryTarget` for non-explicit routes because assistant-engine treats that as an explicit delivery override. Added a separate assistant-engine `bindingDeliveryTarget` path so hosted notifications can keep blinded assistant-facing identity and raw provider binding delivery target separate.
- Security re-review found the raw Linq binding delivery target could still be rendered into provider prompt context. Linq binding context now says the route is available without printing the raw target, and provider-prompt coverage asserts the raw target is absent.
- Expanded `pnpm test:diff` with assistant-engine, assistant-runtime, hosted-execution, hosted web, and Cloudflare touched paths passed after the final privacy rendering change.
- Later security re-review found provider-created Linq chat ids could still become assistant session thread identity after first-contact send, the identifier blind used only public member id material, and one runtime test still used raw participant ids in assistant-facing fields.
- The final clean fix keeps provider-created Linq chat ids only in delivery binding unless the actor id already equals the participant delivery target, so hosted blinded signup sessions remain actor-scoped for inbound fallback continuity while local raw participant sessions keep the legacy thread promotion.
- Hosted Linq assistant identifiers now derive their blind from the secret-derived phone lookup key plus member id instead of member id alone.
- Focused regressions passed: hosted-execution assistant identifiers, assistant-engine outbox/outbound materialization, assistant-runtime hosted events/mailbox import, hosted-web activation/home routing, and `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`.
- Security re-review found one remaining immediate-send path that could promote an already-materialized hosted Linq raw thread delivery target into assistant `threadId`; the outbound retarget branch now only rewrites assistant `threadId` when the previous thread id already matched the delivery target.
- Task-finish re-review found inbound auto-reply session resolution still passed the raw Linq reply route only as an explicit send target, allowing the blinded `hid_*` thread id to replace binding delivery after the first inbound reply. Auto-reply now passes the raw route through `bindingDeliveryTarget`, with regression coverage for both the auto-reply call and binding patch.
- Focused assistant-engine regressions passed after the auto-reply binding fix.
- Expanded scoped `test:diff`, local Linq first-contact E2E, `git diff --check`, final task-finish re-review, and security/privacy re-review passed before closeout.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
