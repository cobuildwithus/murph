# Daily game post notifications

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Outcome and protected invariants

Game participants can receive an iPhone notification when another participant posts, at most once per recipient per game per game day. Preserve free-player access and post-to-unlock. Notification payloads contain no private content.

## Ownership and evidence

The game posting transaction already owns accepted entries and the unique-key game event ledger. The companion push route and Apple sender already own device addresses and delivery. Posting previously emitted no push. Native registration was wearable/paid-access gated. Reuse those owners; add no queue, timer, dependency or native daily state. A nullable game-session binding on the existing route is required to make late registration inert after sign-out.

## Product UX plan

- Entry: first joined game asks for iOS alert permission once. A first photo or heart-rate post alerts the other player, including free invitees.
- Destination: tapping waits for game home and refreshes the signed-in roster before selecting the game. Locked entries remain locked.
- Timing: recipient's frozen game zone, 3am to 3am; offline-grace entries consume the current receipt day, not the entry date. Development time travel does not reset the cap.
- Quiet paths: own posts, retakes, excuses, denied permission, missing/invalid routes and disabled games do not notify.
- Failure: atomic claim precedes APNs outside the transaction. Ambiguous delivery never releases a claim. Accepted posts survive provider and outcome-recording failures. Invalid tokens are removed by exact match.

## Scope and delivery

Backend branch: feat/game-daily-notifications from current main.
Native branch: feat/game-post-notifications from the requested feat/game-in-murph branch. Existing native feature worktree and branch remain untouched.
No production mutations or live member notifications. Deploy compatible Web before the updated iOS app; apply the additive route game-session migration before Web. Legacy wearable-only registrations do not enroll game notifications.

## Verification

- Focused notification unit tests: passed, including day rollover, DST, receipt identity, feature gates, permission revocation, invalid tokens and uncertain failure.
- Real PostgreSQL game service: passed, including concurrent retry, retake, separate game/recipient/day identities, denied permission, excuses and post success despite provider failure.
- Web typecheck: passed after correcting test-double typing.
- iOS build and 32 focused simulator tests passed, including push registration, cold-launch routing, free-player admission and sign-out. XcodeGen and full SwiftFormat lint passed.
- Independent native cross-cutting review complete with all concrete findings resolved.
- Physical APNs delivery is not claimed; no production credentials or member messages used.

## Completion

Focused proof, parent review, privacy inspection and independent native review are complete. Scoped local commits close this task; no push, merge or deployment is claimed. Changelog: game-post-notifications; no fabricated PR provenance for this local task.

## Review disposition

- Accepted free-player registration finding: select the game route first. Optional wearable registration cannot evict a ready free member on paid-access rejection; real AppSession regression added.
- Accepted sign-out race finding: bind game registration to the authenticated session and recheck it under the auth owner lock. Delivery requires that same unexpired session to remain present. PostgreSQL proof deletes the session while preserving the route and observes no further send.
- Follow-up independent review found a coupled writer: a wearable registration could move another device's game enrollment. Fixed under the existing member lock: preserve enrollment only for the same installation and complete target; otherwise clear it. Six focused store tests prove preservation and clearing. Final re-review reported no remaining findings. Normal token revocation and unauthorized companion operations retain their existing boundaries.

## Final verification and UX walkthrough

- `DATABASE_URL=<local-test-database> MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/game-service-postgres.test.ts apps/web/test/game-post-notification.test.ts apps/web/test/game-push-route.test.ts apps/web/test/companion-push-route.test.ts apps/web/test/companion-push-route-store.test.ts`: 47 passed. Separate game route regression suite also passed after the auth helper change.
- `pnpm --dir apps/web typecheck:prepared`: passed. Local Node was 24.14.1; install emitted the declared 24.22.1 engine warning but focused tests and typecheck completed successfully.
- Changelog generation and `changelog-page.test.tsx`: 10 passed.
- `pnpm complexity:diff`: passed; no changed function above 20. `pnpm docs:drift` and diff whitespace checks passed.
- Native `xcodebuild test` selected GameAPIClientTests, AppDelegateTests and the three affected AppSession scenarios: 32 passed on iOS Simulator. `xcodegen generate` and `swiftformat --lint .` passed.
- UX Ready for the implemented software boundaries: first photo and heart-rate posts notify only the opponent; retries/retakes remain quiet; free registration stays in ready; notification routing buffers a cold-launch destination and only selects a refreshed member game. Permission opt-out and logout suppress further sends; no private post content enters APNs.
- Physical-device APNs receipt and real system permission presentation remain unverified. Release requires the nullable game-session migration, Web deployment, then an iOS build based on the game feature branch. No real member notification was sent during verification.
Completed: 2026-10-21
