# Let Murph vote in conversation polls

## Outcome and invariants

Murph may contribute its own vote when it fits the conversation, including a playful preference or a tie-breaker. iMessage receives a native vote from Murph's line; Telegram receives only a truthful spoken pick because bots cannot vote. Keep current-conversation, runtime, access and egress authorization; never impersonate a person or invent a tally.

## Existing owners and design

Extend the existing murph.poll contract and Web provider owner with vote, a zero-based optionIndex, and explicit add/remove operation. Resolve the immutable option ID from a fresh scoped Linq read, recheck authority, then submit the vote. Reuse encrypted poll receipts and signed transport. No new persistence, dependency, tool or queue. Expose provider acceptance separately from confirmed device delivery; failures never imply success. Old actions remain compatible. Deploy Web before a runtime that produces vote requests and retain that Web support while new runtimes run.

Provider contracts: Linq messages/poll/vote supports add/remove for the sending line; Telegram messages.sendVote is user-only. Scope remains polls created by Murph in the current conversation.

## Product UX

Entry: current iMessage or Telegram conversation. Affected: participating group members and direct-chat users. Prove a useful voluntary iMessage vote, removal, Telegram verbal choice, and respecting a settled decision. Voting is discretionary, never mandatory or a substitute for answering a direct question. Read before claiming a tie or result; keep existing quiet paths. Provider acceptance is not delivery confirmation.

## Verification and completion

- [x] Implement contract, provider, authority and guidance.
- [x] Deterministic schema, scoped read/write, revocation, unsupported-channel and failure proof.
- [x] Focused real-Codex journeys and reply review.
- [x] Relevant tests, typechecks, parent review, changelog and complexity guard.
- [x] Required external review and final local completion evidence.

Live production messaging is not part of synthetic verification. Changelog describes iMessage voting and Telegram's distinct limitation.

## Evidence so far

Web poll suites: 42 passed; assistant poll tool: 21 passed; signed transport: 2 passed; changelog rendering: 10 passed. Web, assistant-engine and hosted-execution typechecks passed. Provider-boundary and complexity checks pass; no new hotspot exceeds 20. Existing system-prompt hotspots are unchanged. Focused tests cover both operations, native SDK arguments, scoped option resolution, live revocation, blocked delivery, wrong conversation, unsupported Telegram, and lost acknowledgement.

Complete initial provider input measured with the existing native Codex scripted provider capture and an exact base-input ablation against 2013c92511. Individual: 150140 to 151961 bytes; group: 140544 to 142365 bytes; both +1821. Instructions +431 bytes, registered tools +840 bytes; generated provider guidance accounts for the remainder. Cache key excluded; exact Terra tokenizer unavailable, so token counts remain unmeasured. Ablated instructions and tool description match the base source exactly.

The default local subscription and several alternate homes failed authentication or quota before provider actions. An available subscription completed the tie-breaker journey using the production prompt/tool: one read and one native vote. Remaining live cases are in progress. No production messaging was used.

Existing Frog entries cover the documented changelog test working directory and fresh-worktree Prisma generation; no new duplicate report was created.

Live recovery initially repeated an uncertain vote after readback. The owning tool description and failure reply now prohibit automatic resubmission; deterministic recovery proof passes and the exact live case is rerunning. Removal fixture now models the removed ballot in its returned counts. Full native/deferred/code-only contract selection passes (16 tests). Worker typecheck passes.

Final local evidence: five isolated real-Codex journeys pass on gpt-5.6-terra through a local subscription. Tie-breaker and removal each submit one vote; Telegram and settled decisions submit none; uncertain acknowledgement submits once and may read back without resubmitting or claiming success. Every synthetic reply reviewed: Ready. Web, Worker, engine and hosted-execution typechecks pass; focused contract capture and full native/deferred/code-only tool-contract selection pass. Changelog entry references PR #3658. Parent candidate review confirms native own-line effects, unchanged old actions, provider limits, signed current-conversation authority, no fake Telegram tally, and consumer-first rollout. Final external review and exact-head CI remain pending on PR #3658.

## Final review and handoff

Round 1 ReviewGPT passed on 7f26b795365dfed827594b7bb2301888fb8316da with no qualifying Critical/High finding or material Complexity Collapse. Eragon selected and verified gpt-6-pro; exact accepted turn, guarded full snapshot, response identity, minimum 180-second marked-response gate and REVIEW_COMPLETE marker validated. Parent read the full result and accepts the source-based audit. The first browser lane could not start, so the same round used an available lane; no finding was discarded. Parent final diff/privacy review passes. The only later change archives this plan and updates its index link; production code is unchanged.

Implementation and local proof are complete. PR #3658 owns the final exact-head CI result and remains the deployment handoff. Final CI is still running at archival time; do not treat this historical plan as evidence of a deployment or a live channel smoke. Deploy Web before the runtime, then test native iMessage add/remove and truthful Telegram fallback.
Status: completed
Updated: 2026-09-22
Completed: 2026-09-22
