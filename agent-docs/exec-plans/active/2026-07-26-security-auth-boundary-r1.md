# Protect hosted provider credentials from assistant shell reads

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Prevent prompt-controlled hosted assistant shell commands from reading the
  persisted Codex subscription credential while preserving ordinary hosted
  vault access, web access, provider refresh, and warm-session continuity.

## Success criteria

- Ordinary hosted root turns select one native Codex permission profile whose
  effective access matches the existing privileged adapter except for an exact
  deny on the managed credential file.
- Local assistant behavior, group-read consultation, group email, output-only,
  and room-model maintenance policies remain unchanged.
- Static tests prove the generated profile and root-turn selection, and a
  production-equivalent hosted runner smoke proves the credential cannot be
  read while representative allowed filesystem and network operations still
  work.
- Required focused tests, typecheck, acceptance verification, preliminary
  specialist review, final exact-head ReviewGPT, and PR CI pass.

## Scope

- In scope:
  - Hosted Codex permission-profile generation and ordinary hosted root
    selection.
  - Secret-safe tests and production-equivalent hosted runner proof.
  - Durable architecture/security documentation for the new boundary.
- Out of scope:
  - Local operator turns, provider-auth storage redesign, egress redesign, and
    unrelated prompt-hardening.
  - The documented group-join replay debt returned by the same discovery
    round; no occurrence evidence justifies adding a new consumed-event state
    owner in this batch.

## Constraints

- Technical constraints:
  - Keep Codex App Server provider access outside the child-tool sandbox so
    token refresh and continuity continue.
  - Use the existing named-permission mechanism; do not add a broker, service,
    process, dependency, or compatibility shim.
  - Deny only the managed credential surface needed to close the proved path.
- Product/process constraints:
  - Preserve product-critical inbound replies and the current CLI-first vault
    experience.
  - Keep each ReviewGPT security batch in its own PR and do not merge it.

## Risks and mitigations

1. Risk: A broad sandbox profile silently removes vault writes or web access.
   Mitigation: Start from root write plus enabled network access and prove
   representative allowed operations in the hosted smoke.
2. Risk: Sandboxing the App Server itself breaks provider auth refresh.
   Mitigation: Select the named profile only on thread/turn execution; retain
   App Server process credentials and verify the RPC request shape.
3. Risk: A path mismatch leaves the credential readable.
   Mitigation: Generate the deny from the same resolved hosted Codex home that
   owns `auth.json`, avoid glob inference, and exercise the exact file path.

## Tasks

1. Continue the security discovery thread with an architecture-constrained
   patch request and inspect the returned patch before applying it.
2. Implement the smallest native permission profile and hosted-only root-turn
   selection, including focused tests and hosted sandbox proof.
3. Update the live architecture/security documentation for the narrowed
   credential boundary.
4. Run focused verification, typecheck, canonical acceptance checks, and the
   required preliminary/final ReviewGPT and CI gates.
5. Commit, push, and open one unmerged PR for this accepted batch.

## Decisions

- Rejected the replayed group-join affirmation candidate from this batch
  because the live reliability contract already records it as deliberately
  deferred debt and this discovery supplied no occurrence evidence. Adding a
  consumed-event table from a review-only hypothesis would violate the repo's
  simplicity and persisted-state gates.
- Prefer a hosted-only named permission profile over moving credentials,
  changing egress, or splitting processes. Codex applies the profile to tool
  execution while its App Server retains provider credentials outside that
  child sandbox.

## Verification

- Commands to run:
  - Focused hosted-execution, assistant-runtime, assistant-engine, and
    Cloudflare tests selected after reading the testing map.
  - `pnpm typecheck`
  - Canonical `pnpm test:diff ...` commands selected by the repo dispatcher.
  - `pnpm verify:acceptance`
  - Preliminary `completion-specialists` ReviewGPT and final exact-head
    ReviewGPT/CI loop.
- Expected outcomes:
  - Managed credential read is denied; representative vault write and network
    access remain allowed.
  - All required checks and review gates pass with no unresolved findings.
