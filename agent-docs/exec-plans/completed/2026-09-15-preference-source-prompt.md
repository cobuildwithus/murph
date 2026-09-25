# Expose accepted source identity across conversation transports

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and invariant

Restore source-bound preference updates for batched SMS, RCS, and authorized
email. Preserve newer Settings chronology and existing native-action authority.
Product UX patch: reaches supported direct transports and existing group chats;
proof covers assembled prompts, exact source writes, stale receipts, and replies.

## Evidence and architecture

Round 2 found prompt generation reused native target eligibility, hiding refs
on supported preference routes. Reuse the canonical input ID validator for
source display in both prompt paths; native authorization retains its owner.
No new state, wire field, queue, dependency, or I/O. Web remains the canonical
preference and route authority. Invalid IDs and ambiguous writes fail closed.
Existing callback contracts preserve deployment skew and rollback behavior.
Also repair concrete generated tool declarations and the affected plan digest
identified by exact-head CI. Completed earlier plans remain immutable.

## Tasks

1. Separate source display from native targeting and add transport regressions.
2. Run focused tests, typecheck, and real-Codex source journeys; review replies.
3. Review complexity/privacy, refresh owner docs and provider-input evidence,
   then close this local correction plan and commit.

PR #3467 owns the remaining exact-head CI and third/final ReviewGPT round.

## Verification

- Five focused engine suites: 208 passed, 6 intentional skips. Updated
  personalization guidance, real generated declarations, and route-plan proof:
  14 selected checks passed. Native targeting suite: 22 passed, including email.
- Runtime turn-input suite: 49 passed. Engine and runtime typechecks passed.
- Real Codex source journeys: SMS, RCS, authorized-email tool scope, and iMessage
  group passed on gpt-5.6-terra through a local subscription. Each selected the
  exact two requesting inputs; the older Humor change returned superseded while
  the later tone change saved. Replies accurately reported Humor 0 and sentence
  case; no duplicate writes, unrelated actions, shell, card, or media. Ready.
- Initial SMS wording exposed the internal casing label despite correct writes.
  Existing tool guidance now confirms casing in user-facing terms; unchanged
  assertions passed on rerun. Native targeting permissions remain separate.
- Credential-free complete first provider requests: base/head direct
  160196/161174 bytes and group 147795/148773 bytes (+978 each). Exact target
  tokenizer unavailable; no token counts claimed. Fixed fixtures isolate final
  schema/guidance changes. Transport prompt reference coverage is deterministic.
- Parent review: canonical input-ID validator replaces native capability gating
  only for prompt source identity. No state, callback wire, or I/O change.
  Concrete schema properties preserve generated types and reject ref-only writes.
- Complexity guard and whitespace checks passed. Existing hotspots and debt are
  unchanged; no new abstraction is justified. Owner docs reflect the distinction.
- This plan closes local correction work. PR #3467 retains exact-head broad CI
  and the final full sensitive review gate; no merge or deployment is requested.
Completed: 2026-09-15
