# Native conversation polls

Status: active
Created: 2026-09-21

## Outcome and Product UX

Feature: members can ask Murph to create a native poll in the current iMessage
or Telegram conversation and later list polls and read results. Telegram can
also close a poll. iMessage questions are sent as text before the native poll;
its native public, multiple-choice voting differs from Telegram's anonymous,
single-choice default. No automatic chat message is sent for each vote.

Journeys: direct and group create/read; Telegram update and explicit close;
wrong conversation or unsupported transport; replay and ambiguous send;
empty tally and stale Telegram results. Provider-shaped synthetic evidence
and a focused real-Codex journey must confirm effects and truthful prose.

## Architecture and state

Reuse signed hosted tool transport, accepted input authority, canonical thread
routing, provider clients, member encryption and blind indexes. Web owns one
poll receipt and encrypted provider/result snapshot; Telegram's poll-only
webhooks require this durable association. No new queue or assistant wake.
Member deletion cascades the receipt. Provider calls and encryption remain
outside database transactions. Creation receipts claim the effect before
dispatch; uncertain Telegram sends cannot be automatically repeated.

## Tasks

1. Add bounded contracts, provider adapters and encrypted poll receipts.
2. Bind current-conversation tool through runtime/Web; ingest Telegram tallies.
3. Add deterministic authority, provider, replay and webhook tests; live journey.
4. Update architecture and changelog; review, typecheck, commit and open PR.
5. Run required exact-head CI and final ReviewGPT; report evidence.

## Deployment and proof

Additive migration first, then Web consumer/webhook, then runtime tool.
Old runtimes do not request the new route. Telegram tally freshness remains
explicit and vote updates never create new assistant turns. No production
provider messages are sent during validation.


## Candidate evidence

- Focused provider, authority, tool, webhook, signed transport and changelog
  tests pass; existing Telegram ingress, iMessage contact and plan-usage tests
  also pass. Successful close persists final counts; repeat close does not send.
- Three isolated real-Codex journeys pass with production instructions and the
  native tool: creation sends exactly once, results respect anonymous votes and
  leave voting open, and an unknown send remains uncertain with no second send.
  Earlier account attempts failed before provider actions; one authenticated
  profile completed all behavior checks. A native poll can complete the request
  without an additional text reply.
- Web, Cloudflare, assistant-engine and assistant-runtime dependency typechecks
  pass. The provider-boundary guard, new Web source lint and diff whitespace
  check pass. Complexity debt decreases; no new function exceeds 20.
- A local PostgreSQL transaction ran the migration against temporary tables,
  exercised single-claim updates (one winner), verified member-delete cascade,
  and rolled back. Creating a scratch schema in the generic local database
  was denied; temporary tables provided isolated equivalent SQL validation.
- Complete first provider-input capability ablation: individual 145085 to
  147160 bytes; group 136061 to 138136 bytes; each adds 2075 bytes. Production
  instructions are unchanged; exact target-model tokenizer counts unavailable.
- No production provider messages or production mutations were used for proof.
  Telegram live tally delivery still needs its post-deploy channel smoke.
- Repository-root Web/Cloudflare test invocation is required. The documented
  changelog command's wrong working directory matches existing Frog entries;
  no duplicate friction entry was added.

Product UX: Ready for PR review. Final ReviewGPT and exact-head CI remain pending.

## Authorized follow-up

The member requested exposing iMessage voter handles and both anonymous and
named Telegram polls. Add an optional creation anonymity flag, preserve anonymous
Telegram defaults, and return paginated voter identities on read. Telegram answer
updates require independently ordered encrypted per-voter receipts so changes,
retractions and answers delivered after close remain correct without rewriting
an unbounded poll document. Keep aggregate provider counts independent of answer
delivery completeness. Do not infer a person behind an anonymous chat identity.

Resume also authorizes the accepted Round 1 correction: repeat the blinded poll
binding lookup after the pending-creation query finds no row. Add the exact
interleaving regression. Retain the locally verified source mappings needed by
clean Web builds. Extend deterministic and real-assistant proof before Round 2.

The user also requested tasteful proactive use for decisions. The system prompt
now admits poll guidance from the same availability decision as the tool. It
creates polls for concrete shared choices on an open conversational floor, while
preserving delegated judgment, settled decisions and human-owned exchanges.
No background initiation or new wake mechanism is introduced.

Follow-up proof: named/anonymous create, named Telegram reads and iMessage handle
reads pass live with the production tool and prompts. Per-voter ordering,
retractions, concurrent inserts, late answers, anonymous non-disclosure, bounded
pages and both binding-race interleavings pass deterministic tests. Local SQL
validates the vote table and cascade in a rolled-back transaction. Web, Worker,
engine and runtime checks pass. CI-discovered migration and public-export
inventories are updated and their complete focused test files pass.

Complete first provider-input measurement now includes proactive prompt guidance:
individual 145085 to 149503 bytes; group 136061 to 140479 bytes (+4418 each).
Instructions add 1158 bytes; tool schemas add 1810; generated guidance accounts
for the remainder. Exact target tokenizer counts remain unavailable.

Tasteful initiation proof: four separate real-Codex runs pass. An unresolved
open group choice creates exactly one poll without a poll request; delegated
judgment chooses directly; a settled decision gets the requested practical
answer; a person-to-person choice receives no poll and no reply. Product UX:
Ready. Full follow-up candidate is ready for Round 2 and exact-head CI.
