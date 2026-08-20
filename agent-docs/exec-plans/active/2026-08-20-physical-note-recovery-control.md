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
say that the outcome is still uncertain without sending anything new.

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
- Real pinned Codex app-server initial-provider-input measurement, using a
  captured complete request with volatile identifiers/paths canonicalized and
  the recovery registration removed to form the paired base: direct
  `125030 bytes / 27657 tokens` to `125891 bytes / 27854 tokens`; group
  `109536 bytes / 24157 tokens` to `110397 bytes / 24354 tokens`. The scoped
  recovery tool accounts for `+861 bytes / +197 o200k_harmony tokens` in both
  cases; turns without an accepted current recovery instruction do not receive
  it.
- Repository-wide typecheck reports two pre-existing Junction workspace-boundary
  violations outside this change; all workspace package/app typechecks pass.

Status: active
Updated: 2026-08-20
