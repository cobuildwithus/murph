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
- [ ] Focused real-Codex journeys and reply review.
- [ ] Relevant tests, typechecks, parent review, changelog and complexity guard.
- [ ] Required external review and final completion evidence.

Live production messaging is not part of synthetic verification. Changelog describes iMessage voting and Telegram's distinct limitation.

## Evidence so far

Web poll suites: 42 passed; assistant poll tool: 20 passed; signed transport: 2 passed; changelog rendering: 10 passed. Web, assistant-engine and hosted-execution typechecks passed. Provider-boundary and complexity checks pass; no new hotspot exceeds 20. Existing system-prompt hotspots are unchanged. Focused tests cover both operations, native SDK arguments, scoped option resolution, live revocation, blocked delivery, wrong conversation, unsupported Telegram, and lost acknowledgement.

Complete initial provider input measured with the existing native Codex scripted provider capture and an exact base-input ablation against 2013c92511. Individual: 150140 to 151934 bytes; group: 140544 to 142338 bytes; both +1794. Instructions +431 bytes, registered tools +813 bytes; generated provider guidance accounts for the remainder. Cache key excluded; exact Terra tokenizer unavailable, so token counts remain unmeasured. Ablated instructions and tool description match the base source exactly.

The default local subscription and several alternate homes failed authentication or quota before provider actions. An available subscription completed the tie-breaker journey using the production prompt/tool: one read and one native vote. Remaining live cases are in progress. No production messaging was used.

Existing Frog entries cover the documented changelog test working directory and fresh-worktree Prisma generation; no new duplicate report was created.
