# PR #1705 Current-Sender Replacement

Status: Replacement implemented and focused proof complete; exact-head ReviewGPT and CI gates remain active.
Baseline: supplied snapshot at `fb965713898e0fb00afc215a69e93d16c8c6fb78`.
Owner: Assistant Ask current-sender admission and completion owners.
Risk: High — privacy-sensitive cross-runtime disclosure.

## Outcome

Replace the failed model-selected origin and audience remediation with one trusted, auditable flow:

- the model can only call argument-free `ask_current_sender`;
- trusted current-turn state binds the newest accepted input;
- Web reloads that exact source and alone decides admission, sender, and fixed audience;
- a private request requires a same-channel direct route before personal work;
- the existing consented read and outgoing reviewer can only allow or deny the answer for that fixed audience;
- every admitted request converges on one authorized terminal experience.

No service, dependency, schema, queue, classifier turn, reconciliation path, or broad abstraction is added. The replacement deletes the second audience-selection model path and legacy completion authority.

## Invariants

- One origin creates at most one canonical accepted request across replay and bounded legacy aliases.
- Linq native-reply and Telegram reply-context evidence remain admission authority.
- Neither group nor personal model selects another member or an audience.
- Completion cannot change the persisted target kind.
- Private reviewed text is delivered only by the exact current same-channel direct route.
- Private delivery has a separate deterministic identity and cannot occupy the canonical group completion/fallback identity.
- Route loss at completion or provider entry, and request expiry before prepare, persist only a fresh non-disclosing `cannot_answer` result to the authorized originating group.
- Terminal or unavailable control responses without a persisted completion are retryable, not successful consumption.

## Implementation

- [x] Collapse the model action to argument-free `ask_current_sender` and bind the newest accepted input in trusted runtime scope.
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
- [ ] Exact pushed-head GitHub Actions and final ReviewGPT gate.

## Rollout And Removal

Deploy Web admission/completion support before recycling Cloudflare and detached runners. New callers use only the strict `currentSenderProtocol: "v2"` body marker. During the drain, Web parses deployed unmarked old `ask_current_sender` and `message_current_sender` calls and drains existing accepted `group_sender` or `group_sender_private` work. Exact-source rules remain authoritative. The undeployed dual URL marker, destination dialect, and intermediate request-id alias are rejected.

After all old runners are recycled, wait the ten-minute request TTL plus a one-minute queue margin. Then remove the legacy action alias and legacy request-id lookups.
