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
- Device Sync, Assistant Engine, Assistant Runtime, Cloudflare, and Web typechecks passed. Prisma validation passed.
- Complete initial provider requests were captured through the pinned real Codex App Server with identical synthetic direct/group fixtures and `gpt-tokenizer` 3.4.0 `o200k_harmony`. Direct changed from 31,676 tokens / 143,991 bytes to 31,795 / 144,510; group changed from 27,982 / 127,221 to 28,101 / 127,740. Each route adds 119 tokens / 519 bytes (+0.376% direct, +0.425% group tokens): 309 bytes are the device-tool description and 210 are its generated declaration/schema; other provider-visible fields are unchanged. The weekly automation instruction is loaded only for that scheduled occurrence, not these initial ordinary turns. Measurement-only instrumentation was removed.

## Product UX Walkthrough

- Unexpected quiet source: the source reaches five days, the existing exact-text notification owner emits one check-in, and the ordinary committed transcript retains it. Materialization and provider-entry tests prove current source, route, and preference revalidation. Result: one truthful check, not a disconnected claim.
- Intentionally quiet source: a private accepted turn sets ten days or off in canonical member-plus-provider state. A queued five-day check is suppressed at provider entry after the preference changes; reset deletes the row and restores five days. Group and missing-authority writes fail before mutation.
- Explicit authorization failure: the weekly digest retains reconnect guidance only for `reauthorization_required` or a reconnect-required authentication error. Ordinary stale/no-data evidence cannot enter that branch.
- Differences from plan: none. No rendered image adds material proof because the changed surface is a conversational message, timing, and delivery authority rather than Web presentation.
- Result: Ready.
