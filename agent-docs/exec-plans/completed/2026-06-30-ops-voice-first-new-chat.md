Goal (incl. success criteria):
- Change hosted ops onboarding new-chat sends from text-opener-plus-link to a no-text, audio-first interest check.
- Existing-chat sends should keep direct setup-link delivery.
- Success means new-chat ops sends require an audio file, create the Linq chat with an audio media part and no text opener, do not issue/send a setup link, and the existing inbound reply path remains the link trigger.

Constraints/Assumptions:
- Do not send any opener text for new chats.
- Current Linq native voice memo send requires an existing chat id; Linq chat creation supports media parts by uploaded attachment id.
- Keep the architecture simple: provider wrapper primitive, one new-chat branch, focused tests, no queue or new persisted state.
- Preserve privacy by keeping raw phone numbers, filenames, upload URLs, and invite URLs out of logs/fixtures beyond synthetic test values.

Key decisions:
- Use a media-only first message for new chats because it is the only no-text chat-creation primitive exposed by the installed Linq SDK.
- Do not issue hosted invites for new-chat interest checks; the established inbound first-contact reply path issues and sends the signup link after the recipient replies.

State:
- Implementation and local verification complete. Ready for plan closure, PR, and CI/review lane.

Done:
- Confirmed current code sends text opener, then setup link, then optional voice memo.
- Confirmed Linq chat creation requires a message container but permits media-only parts by attachment id.
- Confirmed inbound Linq reply flow binds pending chat state and issues the signup link on reply.
- Added a media-only Linq chat creation primitive and exported it through the existing Linq module.
- Updated ops onboarding invite delivery so existing chats still send direct setup links, while new chats require audio and do not issue/send invite links.
- Removed the new-chat opener field from the ops UI and updated result copy for voice-first new chats.
- Added focused service, route, and Linq HTTP tests for audio-only new-chat sends.
- Verified with focused Vitest, hosted web typecheck, hosted web lint, and scoped `pnpm test:diff`.

Now:
- Close the active plan and create the scoped commit.

Next:
- Push the branch, open the PR, run PR checks/review lane, and merge when green.

Open questions (UNCONFIRMED if needed):
- Whether Linq offers a native voice-memo chat-creation endpoint outside the installed SDK is UNCONFIRMED; this change uses the current SDK contract.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/linq-client.ts
- apps/web/src/lib/hosted-onboarding/linq.ts
- apps/web/src/lib/hosted-ops/onboarding-invites.ts
- apps/web/app/api/ops/onboarding-invites/route.ts
- apps/web/app/(dashboard)/ops/onboarding-invites/onboarding-invites-client.tsx
- apps/web/test/hosted-onboarding-linq-http.test.ts
- apps/web/test/hosted-ops-onboarding-invites.test.ts
- pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-store-config test/hosted-ops-onboarding-invites.test.ts --no-coverage
- pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-integrations test/hosted-onboarding-linq-http.test.ts --no-coverage
- pnpm --dir apps/web typecheck
- pnpm --dir apps/web lint
- pnpm test:diff apps/web/src/lib/hosted-ops/onboarding-invites.ts apps/web/src/lib/hosted-onboarding/linq-client.ts apps/web/src/lib/hosted-onboarding/linq.ts apps/web/app/api/ops/onboarding-invites/route.ts apps/web/app/(dashboard)/ops/onboarding-invites/onboarding-invites-client.tsx apps/web/test/hosted-ops-onboarding-invites.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
