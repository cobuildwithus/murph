# PR #1705 Current-Sender Replacement

Status: ReviewGPT round-9 unseparated privacy remediation in progress; corrected exact-head CI, follow-up PASS, and merge remain active.
Baseline: supplied snapshot at `fb965713898e0fb00afc215a69e93d16c8c6fb78`.
Owner: Assistant Ask current-sender admission and completion owners.
Risk: High — privacy-sensitive cross-runtime disclosure.

## Outcome

Replace the failed model-selected origin and audience remediation with one trusted, auditable flow:

- the model can call `ask_current_sender` with only one opaque `message_ref`;
- trusted current-turn state requires that ref to belong to the accepted group turn;
- Web reloads that exact source and alone decides admission, sender, and fixed audience;
- a private request requires a same-channel direct route before personal work;
- the existing consented read and outgoing reviewer can only allow or deny the answer for that fixed audience;
- every admitted request converges on one authorized terminal experience.

No service, dependency, schema, queue, classifier turn, reconciliation path, or broad abstraction is added. The replacement deletes the second audience-selection model path and legacy completion authority.

## Invariants

- One origin creates at most one canonical accepted request across replay and bounded legacy aliases.
- Multiple valid origins in one accepted turn remain independent instead of collapsing to the newest message.
- Linq native-reply and Telegram reply-context evidence remain admission authority.
- Neither group nor personal model supplies a member or an audience; Web derives both from the exact selected source.
- Completion cannot change the persisted target kind.
- Private reviewed text is delivered only by the exact current same-channel direct route.
- Private delivery has a separate deterministic identity and cannot occupy the canonical group completion/fallback identity.
- Route loss at completion or provider entry, and request expiry before prepare, persist only a fresh non-disclosing `cannot_answer` result to the authorized originating group.
- Terminal or unavailable control responses without a persisted completion are retryable, not successful consumption.

## Implementation

- [x] Limit `ask_current_sender` to one opaque current-turn `message_ref`, with no member, question, audience, destination, privacy, or route argument.
- [x] Preserve independent simultaneous requests by allowing each valid accepted ref to reach Web exact-source admission.
- [x] Make Web the deterministic exact-source admission owner and retain provider reply evidence.
- [x] Derive and persist sender, target kind, and fixed permission before enqueue.
- [x] Require private routing at admission and revalidate it at completion.
- [x] Remove reviewer-selected audience, model-produced destination, and post-read audience resolution.
- [x] Make completion fixed-audience and terminal persistence explicit.
- [x] Keep only the strict body marker plus deployed unmarked old-runner and bounded mailbox drain compatibility.
- [x] Add synthetic unit and opt-in PostgreSQL proof for mixed senders, group/private admission, ambiguity, route loss, replay/restart, and concurrency.
- [x] Update architecture, security, reliability, protocol, testing, and changelog owners.

## Focused Validation

- [x] `git diff --check`
- [x] Hosted execution, Assistant Engine, Assistant Runtime, Cloudflare, and prepared Web typechecks.
- [x] Focused Assistant Ask parser, tool, runtime, Web authority, route, and Cloudflare port suites: 310 tests.
- [x] Opt-in PostgreSQL mixed-sender, route-loss, and concurrency proof: 4 tests.
- [x] Focused Web ESLint and agent-doc drift checks.
- [x] ReviewGPT round 3 findings remediated: common private wording, expiry/route-loss terminal convergence, and undeployed compatibility deletion.
- [x] Remediation proof includes fresh provider-entry expiry/route-loss fallbacks, duplicate-terminal suppression, legacy/current private-ID dirty-checkpoint dispatch on Linq and Telegram, and a 572-test affected runtime pass.
- [x] ReviewGPT round 4 findings remediated: explicit confidentiality wording cannot default to the group, an exact retained terminal is replayed after request expiry and a lost response so the next queued ask can advance, and the obsolete runtime expiry assertion now follows the live Web fallback handshake.
- [x] ReviewGPT round 5 findings remediated: a bounded terminal-clause parser recognizes explicit confidentiality or fails closed, and newly persisted group/private terminals retain one fresh import window while private provider authority remains bound to the original request deadline.
- [x] Round 5 remediation proof covers late answered/cannot-answer group terminals, delayed PostgreSQL import after the request deadline, and late private provider entry producing only a fresh non-disclosing fallback.
- [x] ReviewGPT round 6 finding remediated: recognized leading confidentiality clauses select the same private authority as trailing clauses, while leading/trailing conflicts reject before enqueue.
- [x] ReviewGPT round 7 finding remediated: one-to-one and singular/plural DM edge clauses select private authority, while unsupported bounded delivery directives reject instead of defaulting to the group.
- [x] Hard-cap retrospective recorded in the owning execution plan; deletion, revert, split, and redesign were evaluated, with one full-snapshot continuation round recommended because the corrected sender/audience/terminal invariant is indivisible.
- [x] User explicitly authorized the correction, round 8, and shipping on 2026-08-12.
- [x] Exact-message focused proof passes: Assistant Engine 91 tests, Web 19 tests,
  and affected Assistant Engine/prepared Web typechecks.
- [x] Complete first-provider requests measured through the real pinned Codex
  App Server. The changed deferred group tool metadata is absent from the first
  direct/group request, so base/head remain identical at 111,567 bytes / 24,330
  tokens direct and 95,823 / 20,745 group with `gpt-tokenizer` 3.4.0
  `o200k_harmony`; the temporary capture hook was removed.
- [x] ReviewGPT round 8 finding accepted and remediated: separated subject-led
  private clauses restore the bounded audience-signal fail-closed guard and
  cannot enqueue or resolve a private route; focused Web authority proof passes
  22 tests.
- [x] ReviewGPT round 9 finding accepted and remediated: a bounded no-separator
  guard rejects unconsumed delivery-to-audience or terminal confidentiality
  directives before route resolution or enqueue while preserving substantive
  `private insurance` wording; focused Web authority proof passes 27 tests.
- [ ] Corrected exact-head GitHub Actions and a follow-up ReviewGPT `PASS` remain required.

## Rollout And Removal

Deploy Web admission/completion support before recycling Cloudflare and detached runners. New callers use only the strict `currentSenderProtocol: "v2"` body marker. During the drain, Web parses deployed unmarked old `ask_current_sender` and `message_current_sender` calls and drains existing accepted `group_sender` or `group_sender_private` work. Exact-source rules remain authoritative. The undeployed dual URL marker, destination dialect, and intermediate request-id alias are rejected.

After all old runners are recycled, wait the ten-minute request TTL plus a one-minute queue margin. Then remove the legacy action alias and legacy request-id lookups.
