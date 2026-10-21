# Reduce assistant context and repeated automation work

Status: completed
Created: 2026-10-01
Updated: 2026-10-02

## Goal

- Reduce repeated model context and tool work while preserving meaningful replies, authorized effects, reminder correctness, and conversation continuity.

## Success criteria

- Reactions use a bounded fresh Luna classifier before escalating meaningful or uncertain inputs to the normal assistant.
- Multi-step eligible work uses native fresh-context Sol children with explicit instructions, bounded results, and one parent-owned response.
- Morning reconciliation reads bounded complete instruction pages instead of inspecting every reminder individually; mutations retain version checks.
- Deterministic owner tests, focused real-Codex Sol/Luna journeys, typechecks, complete-input measurements, parent review, and required PR checks pass.

## Scope

- In scope: reaction routing, native delegation policy, morning inventory reads, measured context/compaction evaluation, focused proof and an implementation PR.
- Out of scope: production changes, private vault edits, provider-price changes, a new scheduler, or copying production data into tests. The weekly usage optimizer and diagnostics tool have their own independent PR lane.

## Constraints

- Technical constraints: reuse native Codex execution and existing admission, usage, outbox, canonical automation, and feedback owners; no shadow billing or conversation state.
- Product/process constraints: retain exact reaction-target authority, user preferences, private/group isolation, no reaction-based grants, and truthful error recovery. Only synthetic verification fixtures and public-safe evidence may be committed.

## Risks and mitigations

1. A classifier suppresses a meaningful reaction. Escalate uncertain/malformed/failing classification and prove closed-question and confusion cases.
2. Delegated work escapes current authority or duplicates effects. Preserve native child restrictions, parent delivery ownership, and current-turn cancellation; prove fresh-context isolation and single result delivery.
3. Inventory bounds hide reminders. Return explicit completeness and pagination metadata and retain exact inspection for oversized or changing records.
4. Earlier compaction loses context or increases spend. Measure the existing native threshold before changing it; prefer removing repeated work and preserve cache reuse.

## Tasks

1. Bootstrap current-main task checkout and dependencies; read owner contracts.
2. Implement the three independent lanes with scoped agent ownership.
3. Consult Opus on native context, compaction, and cost tradeoffs; resolve findings against current source.
4. Integrate focused deterministic proof, compile/typecheck, and run production-composed live Sol/Luna journeys.
5. Measure complete initial input and hot-path work, update owner docs/changelog, review diff, and create a draft PR.
6. Complete applicable external review and exact-head CI, close this plan, and report the PR and practical limitations.

## Decisions

- Runtime work shares one task worktree; the weekly optimizer has a separate worktree because its transport, feedback authority, and seed form an independently reviewable change.
- Preserve the production usage ledger as the diagnostics source of truth in the separate optimizer lane.
- Use existing bounded read and native delegation primitives before adding state or orchestration.
- Do not edit Codex CLI source; use its existing native APIs and Murph configuration.
- Opus reviewed context and compaction economics. Preserve compaction thresholds: earlier compaction can erase useful cache reuse, and no measured cache-hit evidence supports a new threshold.
- Defer unchanged-snapshot omission. Current resume identity cannot prove that a snapshot survived native compaction, failure, restart, or restore. A synthetic private fixture repeats 7,217 bytes of current state, but deleting that repetition without durable context-presence proof could omit needed facts. Group context already excludes that private snapshot. This byte measurement is not a full-input or cost estimate.

## Product UX

- Outcome: lightweight acknowledgments stay quiet at lower cost; meaningful reactions and multi-step requests still receive a correct answer; scheduled reminders remain accurate.
- Entry and promise: existing private/group messages and scheduled morning work use the same user-facing channels and records.
- Affected journeys: plain acknowledgment, affirmative closed-question reply, question reaction, uncertain classifier; simple direct work versus multi-step delegation; complete, paginated, oversized, and concurrently edited reminder inventories.
- Proof: synthetic current-owner tests plus real Sol/Luna turns, exact tool/effect assertions, quiet-path absence of delivery, and parent prose review.
- Done when: selected journeys are Ready, no authority or completeness regressions remain, and verification records distinguish local evidence from CI and deployment.

## Verification

- Commands to run: focused owner tests and typechecks; `pnpm test:assistant:live -- --test <focused-pattern> --model gpt-6.1-sol` and Luna classifier journeys; `pnpm complexity:diff`; applicable docs/privacy/protocol checks and exact-head CI.
- Expected outcomes: required/forbidden effects proven, no copied private data, measured request/cost reductions without unsupported quality claims, and Ready user-facing outcomes.

## Evidence so far

- Frozen dependency install, incremental workspace build, Assistant Engine/Runtime/CLI/Query/Web typechecks, and changelog archive checks pass.
- Reaction proof: 194 engine and 33 Web tests; real priority Luna classifies four scenarios correctly. A real production quiet turn uses one Luna request and no reply; confusion uses Luna plus Sol and one useful reply, with no canonical writes. Quiet routing preserves resume identity and fingerprint.
- Fresh delegation proof: 109 prompt tests, 25 hosted config checks, and real pinned native child capture. Real Sol read workflow uses one child, exactly three canonical reads, zero root source reads and no writes. Real onboarding write uses one child and one canonical write, without duplicate root effects. Both user-visible journeys are Ready.
- Inventory proof: 39 CLI tests, three pagination tests and ten prompt contracts; count/byte caps, oversize fallback, cursor completeness and existing compact projection preserved. Model guidance now preserves factual/timing repair settings. Live Luna two-pass journey is Ready: one instruction page and four correct canonical repairs; repeat one page, zero inspections and zero patches. Exact candidate/readback bounds, event-relative offset, models, audiences and unrelated reminders are preserved. The synthetic adapter now forwards the supported offset field. Final connected prompt/schema coverage passes 61 tests.
- Complete initial provider input: private 165,247 to 167,136 bytes; group 142,993 to 143,071 bytes on identical synthetic fixtures. Exact target tokenizer unavailable. Final base/head remeasurement after shared automation-tool wording passes both fixtures; deferred registration grows 180 bytes outside the first request.
- Native child fixture: 44,803 bytes versus 137,607 parent bytes, with parent transcript/member snapshot and parent dynamic schemas absent. This is distinct-request size evidence, not measured dollar savings.
- No Codex CLI source, production configuration, private vault, or production data was changed.

## Implementation completion

All focused user journeys and local owner checks are Ready. Parent diff, privacy and architecture review is complete. Required external review and exact-head CI remain PR gates; neither deployment nor merge is part of this task.
Completed: 2026-10-02
