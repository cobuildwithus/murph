# Preserve one-time iMessage retry when delivery service is unresolved

## Outcome and protected invariants

- Outcome: Restore existing terminal-failure recovery when nullable provider delivery metadata omits transport and the exact canonical failed receipt already proves iMessage.
- Reaches: Runtime-owned direct/group deliveries through the existing retry owner; no historical replay or change to other delivery owners.
- Proof: Synthetic PostgreSQL receipt, retry claim, replacement acceptance and delivered-receipt journeys; unknown/conflicting transport and duplicate attempts remain denied.

## Evidence and owner

The SDK declares retrieved `Message.service` optional/nullable. Linq distinguishes actual `service` from requested `preferred_service`; explicit iMessage disables fallback. The current retrieve guard rejects null/omitted service before the one-attempt claim, ignoring the exact persisted receipt. This mechanism is code-proven; historical lookup values were not retained, so incident attribution remains bounded.

Source contracts: [retrieve](https://docs.linqapp.com/channel/imessage/api/typescript/resources/messages/methods/retrieve/), [protocol selection](https://docs.linqapp.com/channel/imessage/guides/messaging/protocol-selection/), [terminal error](https://docs.linqapp.com/channel/imessage/error/codes/4xxx/4001/).

Canonical authority remains the exact existing delivery/message row, current route/access/line policy and retrieved identity. Derive transport from the exact failed child or legacy scalar and revalidate it under the current parent lock. No schema, state owner, queue or additional provider request. Preserve content, age, one-attempt fence and receipt ordering. Keep diagnostic additions finite and content-free in the existing event.

## Execution

- [x] Inspect current source, official SDK/API contract, production metadata and overlapping ownership; create isolated current-base worktree.
- [x] ReviewGPT authors narrow implementation, tests and affected owner documentation.
- [x] Parent inspects patch; prove regression fails on original source and passes on candidate; run full focused retry suite, Web typecheck and scoped guards.
- [x] Review product journeys, complexity/privacy and changelog; commit/push draft PR, then Ready with final ReviewGPT and exact-head CI started.
- [x] Close the implementation plan after final ReviewGPT PASS. The owning PR task waits for required CI on the final documentation commit before reporting human-merge readiness. No production send, replay, merge or deploy.

## Compatibility and limits

Web-only behavior correction with no schema or runtime protocol change. Existing readers retain old skip behavior; new readers derive exact receipt evidence. Existing one-attempt fields and locking serialize mixed versions. Production provider delivery remains unproved until natural use after an authorized merge; historical failure is not resent by this task.

## Baseline proof

- Current-source retry suite: 55 tests passed (44 PostgreSQL + 11 unit).
- In the existing concurrent recovery journey, changing only the synthetic retrieved message service to null failed: expected one provider send, observed zero. The temporary fixture change was restored byte-for-byte. This proves the guarded recovery gap without touching production.
- Full Web typecheck passed before implementation; generated inputs are prepared for candidate validation.
- Provider receipt and sender metadata inspection was read-only; original provider root cause and historical retrieve value remain unknown.

## Candidate validation and review

- ReviewGPT authored the four-file implementation patch; actual captured model was gpt-6-pro. Parent verified the reloaded response and artifact identity after whitespace-only capture drift, then inspected and applied the same patch.
- New null/omitted PostgreSQL recovery cases both fail on the original production source (zero sends) and pass with the patch. Full focused retry suite: 76 passed (65 PostgreSQL + 11 unit), including concurrent claim, replacement settlement, exact multipart evidence, claim-time changes, consent and diagnostic isolation.
- Web typecheck, scoped ESLint, privacy/log and provider-boundary guards, docs drift/gardening and whitespace checks pass. Changelog archive rendering: 10 passed. Complexity: debt 0 to 0, maximum 19 to 19, no hotspots above 20.
- Parent Product UX result: Ready. Existing direct and group recovery journeys retain the same audience/content and one attempt; unknown/conflicting transport and authority loss remain silent with failed durable evidence. No new provider request, database round trip or runtime model input is introduced. Actual live delivery after rollout remains outside this local proof.
- Parent candidate review found no additional required change. Final ReviewGPT and exact-head CI remain required before merge readiness.

## Final review and handoff

- PR #3108, first-reviewed head `b8335d55353edbd3b82bd60108a398d784136f06`: final ReviewGPT round 1 PASS, zero qualifying findings. Actual response model gpt-6-pro; response SHA-256 `6302eb142c20b083b73ccc8bb6ecc2754e8e6022d9792d1173287b27e1619976`. Reviewer independently checked 720 transport combinations and source/patch identity; PostgreSQL execution is the parent evidence above.
- Parent final review found no required remediation. Current-base merge-tree proof passed. This closure changes only plan documentation; reviewed production and test blobs remain unchanged, so the resolved review applies under the non-production-only completion rule.
- CI was running without failures at closure. The original PR task remains the sole completion owner and must verify required CI on the final pushed head before handoff. The functional PR is for human merge; no production outcome, historical recovery or deployment is claimed.
Status: completed
Updated: 2026-09-09
Completed: 2026-09-09
