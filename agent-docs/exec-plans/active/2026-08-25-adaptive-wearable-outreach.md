# Adaptive wearable no-data outreach

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Keep helpful wearable no-data outreach while eliminating duplicate or misleading reconnect messages. One deterministic owner waits five days by default, records its message in the normal transcript, and honors a member-requested longer interval or opt-out.

## Success criteria

- The weekly health digest no longer initiates outreach from ordinary stale/no-data evidence; it may mention reconnection only for explicit authentication failure.
- The deterministic push-primary source notice waits five days by default and keeps one message per silence episode.
- A private attended member turn can use `murph.device` to set a 5–30 day source-specific interval, disable the notice, or restore the default.
- The setting is canonical typed database state and is re-read before mailbox enqueue and immediately before provider dispatch.
- Automated exact-text notifications remain available to later attended turns through the existing committed transcript path.
- Focused tests and affected typechecks pass, then specialist and final ReviewGPT passes review the exact pushed PR head alongside CI.

## Scope

- In scope: Garmin push-primary no-data policy, the hosted device tool and signed callback, canonical preference persistence, delivery-time revalidation, weekly digest instructions, copy, tests, migration, and owner documentation.
- Out of scope: changing the internal 36-hour source-recovery signal, treating no data as proof of disconnection, adding a new queue, or generalizing the setting to providers without an evidence-backed no-data policy.

## Constraints

- Technical constraints: preserve foreground priority and the existing mailbox/transcript/delivery owners; keep transactions short and database-only; bind writes to the signed member plus accepted private input authority.
- Product/process constraints: use neutral synthetic examples only; keep the PR draft until the exact candidate is locally proven; run ReviewGPT concurrently with CI once pushed.

## Product UX Plan

- Effort: Feature. This adds one member-controlled preference and its private-input authority relationship to an existing proactive check-in journey.
- Outcome: a quiet but still connected wearable produces at most one honest check-in after a useful default wait, and Murph can honor the member's stated longer wait or opt-out on later silence episodes.
- Entry and promise: a configured push-primary source remains silent for five days; Murph sends one direct check-in through the existing notification route, records it in the ordinary transcript, and accepts a private conversational preference of 5–30 days, off, or default.
- Affected people: a direct member whose connected Garmin is unexpectedly quiet; a direct member who intentionally removes it; and a member whose wearable authorization actually failed. Group and scheduled turns may not mutate the personal setting, and ordinary missing data may not initiate reconnect guidance.
- Done when: default, custom, off, reset, stale-queued, recovery, and unauthorized paths have production-shaped proof; exact-auth failures retain the reconnect owner; no new queue or visible configuration screen is required.

## Risks and mitigations

1. Risk: A queued notice becomes stale after the member lengthens or disables outreach.
   Mitigation: Re-read the effective preference in the mailbox materialization transaction and the provider-dispatch claim transaction.
2. Risk: Two outreach owners create repeated messages or call a quiet source disconnected.
   Mitigation: Remove ordinary staleness from the weekly automation branch and reserve reconnect language for explicit auth failure.
3. Risk: A scheduled or group turn mutates a personal setting without direct member authority.
   Mitigation: Require an accepted direct invocation in the engine and revalidate the accepted direct mailbox wake in Web before the upsert/delete.
4. Risk: Rollout changes suppress or duplicate an existing silence episode.
   Mitigation: Retain the existing episode identity and delivery fence; only its current eligibility policy changes.

## Tasks

1. Add the canonical source-provider preference model, migration, and effective-policy reader/writer.
2. Extend the existing device tool and signed device-sync port with the member-authorized configuration action.
3. Apply the effective interval at candidate materialization and provider-dispatch revalidation; change the default to five days and make the copy preference-aware.
4. Remove the weekly digest's ordinary stale-source outreach branch while retaining explicit authentication recovery.
5. Add focused contract, authority, policy, materialization, egress, and prompt tests.
6. Run affected tests/typechecks and direct behavior proofs; inspect the complete diff.
7. Push a draft PR, complete its description, run specialist and final ReviewGPT passes alongside CI, and remediate accepted findings.

## Decisions

- Missing preference row means the product default; a stored nullable interval means custom days or disabled. Restoring the default deletes the row.
- The supported custom interval is 5–30 days. This permits the demonstrated longer-wait behavior without letting the tool create more aggressive outreach than the product default.
- Preference identity is member plus source-provider slug so it survives source-row and connection replacement.
- The existing durable mailbox, exact-text notification turn, transcript persistence, and delivery idempotency key remain the only delivery machinery.

## Verification

- Focused device-sync contracts and staleness policy: 110 tests passed.
- Focused Assistant Engine device-tool and managed-automation behavior: 68 tests passed; the final private-authority regression also passed after least-authority tightening.
- Focused Assistant Runtime device-port behavior: 1 passed with 304 unrelated tests skipped.
- Focused Web preference, notice materialization, and Linq provider-entry behavior: 62 tests passed.
- Focused Cloudflare device port and proxy allowlist behavior: 6 tests passed with 217 unrelated tests skipped in the allowlist module.
- The generated changelog module was refreshed and all 7 changelog-fragment tests passed for the PR-number-bound member-facing entry.
- Preliminary `completion-specialists` ReviewGPT returned four accepted findings: expose the supported range and stop choice in the check-in, state the current-private/Garmin-only model boundary in the device-tool description, add a real-Codex decision suite, and remove a calendar-dependent provider-entry timestamp. Its test-only patch touched only the provider-entry test, matched SHA-256 `3acb2ca87fa816d3b4e1e3553f504b19472c68a84b78c024f2502e6dc99e5a56`, passed `git apply --check`, and was deliberately applied.
- After specialist remediation, 68 focused Assistant Engine tests and 69 focused Web tests passed, and the Assistant Engine typecheck passed. The targeted real-Codex suite is compiled and opt-in; its explicit local run failed closed before a model turn because the required provider credential is unavailable in this checkout.
- Device Sync, Assistant Engine, Assistant Runtime, Cloudflare, and Web typechecks passed. Prisma validation passed.
- Final ReviewGPT round 2 on the account-deletion-corrected head returned one accepted authorization finding: a signed reply-alias email could satisfy directness without the existing authenticated-sender authority bit. The correction now requires both directness and `assistantStyleSettingsAuthorized`, matching the established personalization input gate and adding no new state or owner.
- After that correction, the focused Web preference suite passed 4 tests, including rejection before any preference read/write for an unauthorized direct email and successful mutation for an authenticated direct email. Web typecheck passed.
- Final ReviewGPT round 3 returned one accepted production-wiring finding: the hosted runtime's abort-guard wrapper reconstructed the device port without forwarding the optional no-data outreach operation. The correction forwards that operation through the existing `guard` helper and adds no state, owner, or abstraction.
- After that correction, the production-entrypoint abort-guard suite passed all 6 tests, including a regression proving that the first outreach-setting call reaches the underlying device port and a later call is fenced after host cancellation. The existing hosted device phase proof passed with 304 unrelated tests skipped, and the Assistant Runtime typecheck passed.
- Complete initial provider requests were captured through the pinned real Codex App Server with identical synthetic direct/group fixtures and `gpt-tokenizer` 3.4.0 `o200k_harmony`. After the specialist description correction, direct changes from 31,676 tokens / 143,991 bytes to 31,811 / 144,605; group changes from 27,982 / 127,221 to 28,117 / 127,835. Each route adds 135 tokens / 614 bytes (+0.426% direct, +0.482% group tokens): 404 bytes are the device-tool description and 210 are its generated declaration/schema; other provider-visible fields are unchanged. The correction was remeasured at the same serialized tool-fragment boundary because it is the only provider-visible field changed after the complete-request capture. The weekly automation instruction is loaded only for that scheduled occurrence, not these initial ordinary turns. Measurement-only instrumentation was removed.

## Product UX Walkthrough

- Unexpected quiet source: the source reaches five days, the existing exact-text notification owner emits one check-in, and the ordinary committed transcript retains it. Materialization and provider-entry tests prove current source, route, and preference revalidation. Result: one truthful check, not a disconnected claim.
- Intentionally quiet source: a private accepted turn sets ten days or off in canonical member-plus-provider state. A queued five-day check is suppressed at provider entry after the preference changes; reset deletes the row and restores five days. Group and missing-authority writes fail before mutation.
- Explicit authorization failure: the weekly digest retains reconnect guidance only for `reauthorization_required` or a reconnect-required authentication error. Ordinary stale/no-data evidence cannot enter that branch.
- Specialist refresh: the check-in now exposes the actual 5–30-day range and permanent stop choice, avoiding an unsupported free-form answer and making the intentionally-quiet path discoverable without another correction turn.
- Differences from plan: none in purpose, state ownership, or interaction count. No rendered image adds material proof because the changed surface is a conversational message, timing, and delivery authority rather than Web presentation.
- Result: Ready.

## Round-three anomaly retrospective

- Original requirement: keep one useful Garmin no-data check-in, avoid duplicate or misleading reconnect outreach, and let an authorized member extend the wait or turn it off.
- First-reviewed versus current shape: both use one member-plus-provider preference row, the existing `murph.device` operation, the existing signed Web callback, and the existing mailbox/transcript/delivery owner. Review remediation added no owner or lifecycle; it clarified copy and tool scope, strengthened deletion and sender-authority proof, and preserves the optional operation through the existing hosted-runtime abort wrapper.
- Churn: the current authored-source shape remains below the 2,000-line trigger. The round-three correction adds one optional forwarding branch to the existing wrapper plus one production-entrypoint regression; it introduces no mechanism that warrants redesign or splitting.
- Repeated mechanism: none. The round-two and round-three findings were missed reuse of existing authority and cancellation boundaries, not evidence that the preference or delivery architecture needs another mechanism.
- Decision: keep the corrections inside the existing input gate and abort-guard owners. Splitting or redesigning would add coordination without removing a source of truth or owner.
