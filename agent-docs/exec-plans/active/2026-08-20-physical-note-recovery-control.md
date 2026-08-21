# Physical-note recovery control

## Goal

Let a member explicitly ask Murph to resolve an earlier ambiguous physical-note
submission without attempting another send, while preserving the existing
one-effect, privacy, billing, and provider-ambiguity guarantees.

## Proven symptom and root cause

- A legacy physical-note row can remain unresolved after an older Web version
  terminalized a provider-ambiguous outcome without a safe failure category.
- A later explicit send correctly records an unsent blocker and performs the
  existing bounded provider metadata lookup, but an indeterminate lookup leaves
  both rows blocked.
- The only current model-facing recovery path is coupled to another complete
  physical-note send request. Murph therefore cannot act on a direct request to
  clear or resolve the earlier attempt, even though Web already owns the safe
  reconciliation primitive.

## Product UX plan

Classification: Product change.

### Outcome

A member can ask Murph to resolve an old physical-note attempt, and Murph will
either confirm that it was accepted, safely clear a provider-proven absence, or
say that the outcome is still uncertain without sending anything new. When
multiple independent guards exist, Murph also distinguishes the checked
attempt's outcome from the fact that another unresolved blocker remains.

### Entry and promise

The entry is a current accepted direct or authenticated-group message asking to
cancel, clear, check, or resolve an earlier unresolved physical note. Murph
performs one foreground provider reconciliation and replies in the same turn.
There is no automatic retry, notification, or background follow-up.

### Affected people

- A direct member with an aged ambiguous legacy row wants to make a future note
  possible without authorizing one now.
- A current authenticated group participant wants to resolve the group's prior
  note while preserving participant and route authority.
- A member whose provider record proves acceptance needs a truthful explanation
  that the earlier note cannot be treated as canceled and that no new note was
  sent.
- A member whose provider read is recent or indeterminate needs the blocker to
  remain in place and a clear statement that nothing new was sent and no
  automatic follow-up is running.
- A member with multiple legacy unresolved rows needs to learn when the checked
  oldest row was accepted or cleared, that a different blocker remains, and
  that another current explicit request is required for one more check.

### Proof path

- Assistant tests start from an accepted message reference and exercise the new
  tool through the hosted physical-note port to each visible result.
- Web owner tests prove accepted, absent, recent, indeterminate, already-clear,
  and group-authority outcomes without a provider create call.
- Cloudflare tests prove only the exact additive route is allowed and that the
  recovery request is forwarded once without send-style transport replay.
- The Product UX walkthrough replays direct and group recovery, accepted,
  safely cleared, and still-pending results against the production-shaped
  contracts.

### Deliberate exclusions

- Recovery does not create, resend, or automatically continue a physical note.
- Recovery does not claim to recall or cancel a mailpiece already accepted by
  the print provider.
- Recovery does not clear a recent or provider-indeterminate outcome.
- Recovery adds no scheduler, queue, persisted recovery state, provider id, or
  user-visible history store.

## Implementation

1. Add a bounded recovery request/response and additive Web-control route to the
   hosted-execution contract.
2. Reuse the existing Web-owned oldest-guard lookup and reconciliation
   transitions behind current member or group-participant authority.
3. Add a `murph.resolve_physical_note` dynamic tool that requires the exact
   current accepted message and reports literal provider-backed outcomes.
4. Update the physical-note product/skill contracts and add the member-visible
   changelog entry.
5. Run focused package, Web, Cloudflare, Assistant, typecheck, Product UX, and
   docs-drift proof.
6. Push the candidate, run the preliminary Product UX, prompt, and coverage
   lenses plus the final cross-cutting ReviewGPT gate concurrently with CI,
   resolve accepted findings, and close this plan with the final scoped commit.

## Deployment

Deploy Web's additive route and response producer first. Then deploy the
Cloudflare allowlist/port and runner bundle with immediate container convergence
and fingerprint proof. An older runner never calls the new route; a new runner
against old Web would receive a route failure and cannot provide recovery.

## Product UX walkthrough

Result: Ready.

- Direct accepted evidence: the exact current accepted message authorizes one
  lookup; the reply says the earlier note was accepted for printing, cannot be
  treated as canceled, and no new note was sent.
- Direct safely-clearable evidence: an aged proven absence settles the old
  guard and any unsent `prior_note_unresolved` blocker; the reply says the
  blocker is clear and requires a separate future send request.
- Recent or indeterminate evidence: the guard remains unchanged. Recent absence
  returns the existing safety-window end, while aged indeterminate evidence
  returns no false retry time; both say there is no automatic follow-up.
- Multiple legacy guards: one provider read resolves only the checked oldest
  guard. The result preserves its `accepted` or `clear` outcome and separately
  reports that another unresolved submission remains; Murph asks for another
  explicit recovery request instead of calling twice or describing the
  successful check as indeterminate.
- Authenticated group: participant and exact route authority are checked at
  entry and again immediately before the provider read.
- Already clear or unavailable: no provider read occurs for an already-clear
  member, and missing provider configuration leaves an existing guard intact.

The walkthrough uses the production-shaped Web owner, Cloudflare control port,
and Assistant Engine tool-result tests. A rendered image adds no material proof
because the changed surface is conversational semantics and durable recovery,
not Web presentation.

## Verification progress

- Focused Web physical-note service tests: pass.
- Focused Cloudflare physical-note port/policy tests: pass.
- Focused Assistant Engine physical-note tool tests: pass.
- Canonical affected verification (`pnpm test:diff`): pass, including all
  affected package tests, hosted-local package-boundary proof, the full hosted
  Web verify/build, and full Cloudflare Node and Workers verification.
- Affected Web, Cloudflare, Assistant Engine, Assistant Runtime, and hosted
  execution typechecks: pass.
- Web lint, documentation drift, and documentation gardening: pass.
- Real pinned Codex app-server initial-provider-input measurement, using the
  same captured complete requests with volatile identifiers/paths canonicalized
  and `gpt-tokenizer@3.4.0` `o200k_harmony`: direct
  `125030 bytes / 27657 tokens` to `125124 bytes / 27675 tokens`
  (`+94 bytes / +18 tokens`, `+0.08% bytes / +0.07% tokens`); group
  `109536 bytes / 24157 tokens` to `109630 bytes / 24175 tokens`
  (`+94 bytes / +18 tokens`, `+0.09% bytes / +0.07% tokens`). The initial
  delta is only the existing code-mode deferred-discovery record; the full
  recovery schema is absent from both ordinary and explicit recovery initial
  requests and is loaded only after explicit discovery. A pinned app-server
  provider-boundary regression proves ordinary non-use, explicit discovery,
  one authorized call, and a sub-200-byte discovery-record ceiling.
- Repository-wide typecheck reports two pre-existing Junction workspace-boundary
  violations outside this change; all workspace package/app typechecks pass.
- Preliminary Product UX/prompt/coverage review at the immutable first-reviewed
  head returned two accepted findings: transport-loss copy was overconfident,
  and the low-frequency recovery schema was eagerly exposed. Recovery now keeps
  a lost response explicitly unconfirmed and uses the existing deferred
  code-mode discovery path with ordinary-turn and explicit-call proof.
- Final ReviewGPT round 1 at the same immutable head independently returned the
  accepted transport-loss finding and no other cross-cutting finding. The
  correction preserves definite no-change copy for a returned Web
  `unavailable` result while keeping thrown/lost responses uncertainty-safe.
- Final ReviewGPT round 2 verified those corrections and required a
  retrospective for the repeated coarse-status mechanism: after Web cleared a
  checked oldest guard, a different remaining guard could make the aggregate
  response `pending` and cause false row-specific copy. The PR retrospective
  chose one Web-owned response correction: `status` now describes the checked
  guard and `remainingUnresolved` derives from the remaining-guard read already
  on the path. No state owner, query, provider call, retry, or lifecycle was
  added.
- Corrected-head focused proof passes: 32 Web service tests, 16 Cloudflare port
  tests, 32 Assistant physical-note tests, the pinned deferred provider-boundary
  scenario, and all affected Web, Cloudflare, hosted-execution, Assistant
  Engine, and Assistant Runtime typechecks. The production runner bundle is
  9,390,194 bytes against a 9,397,704-byte ceiling, leaving 7,510 bytes of
  headroom.
- Post-finding canonical affected verification (`pnpm test:diff`): pass. This
  includes 4,006 Assistant Engine tests, 2,430 Assistant Runtime tests, 1,182
  CLI tests, 10,788 hosted Web tests plus lint/dev-smoke/production build, and
  2,612 Cloudflare Node plus 15 Workers tests.
- Candidate is published as PR #2099; the next final ReviewGPT round, canonical
  corrected-head verification, and exact-head CI remain open before plan
  closure.

Status: active
Updated: 2026-08-20
