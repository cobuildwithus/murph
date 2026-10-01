# Classify invalid hosted route-authority responses

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

- Distinguish invalid hosted route-authority response shapes through the existing
  structured log without changing authorization, delivery, or retry behavior.

## Success criteria

- Synthetic direct and proxy calls retain their existing results and exceptions.
- Only rejected decoded responses emit one bounded, content-free diagnostic.
- Focused proof, parent privacy review, final ReviewGPT, and exact-head CI pass.

## Scope

- In scope: existing external-route response validation boundary, focused tests,
  and its observability owner documentation.
- Out of scope: response acceptance, fallback audience, retries, provider calls,
  persisted state, deployment admission, and release-recovery work.

## Constraints

- Reuse the existing structured logger and already available attempt correlation.
- Never log response values, arbitrary keys, payloads, identities, or headers.
- Keep the original thrown exception and successful-path work unchanged.
- Use ReviewGPT to implement telemetry; keep production investigation read-only.

## Risks and mitigations

1. Diagnostics accidentally alter a sensitive authority boundary.
   Mitigation: preserve the parser and original throw; prove valid, denied,
   malformed, transport-failed, and legacy responses through the actual port.
2. New logs disclose private data or add success-path cost.
   Mitigation: closed field classifications, existing correlation only, and
   assertions against synthetic private decoys and success-path log volume.

## Tasks

1. Reproduce indistinguishable invalid response failures using synthetic inputs.
2. Obtain and inspect the smallest ReviewGPT implementation patch.
3. Run focused checks, review privacy and complexity, and prepare the draft PR.
4. Complete final ReviewGPT and required CI on the pushed candidate.
5. Respect canonical release compatibility and existing recovery ownership.

## Decisions

- The HTTP logger records transport status but cannot identify which decoded
  response field fails the subsequent authority parser. A narrow failure-only
  observation closes that question without a new telemetry pipeline.

## Verification

- Actual-port tests, Cloudflare typecheck, complexity and diff checks.
- Valid and legacy responses remain unchanged; malformed responses still reject
  with the original exception while adding only bounded diagnostic metadata.

## Implementation and evidence

- ReviewGPT supplied the implementation against the base snapshot; concrete
  model capture, exact response identity, and completion marker were verified.
- The existing parser remains the only acceptance owner. The effect port logs
  four fixed validation booleans only after rejection, then rethrows the exact
  exception even if the existing log sink throws.
- Reuses the already-resolved write fence and structured logger. No new calls,
  retries, response acceptance, persistent state, or deployment configuration.
- Parent review accepted the scoped source, proof, and observability docs.
  The index now locates the structured-log diagnostic in its existing owner.
- Existing base authority checks: six passed. New proof against unchanged
  production source: 24 expected missing-diagnostic failures and 19 passes.
- Patched focused direct/proxy proof: 43 passed, including actual parser error
  identity, legacy/direct/group results, private decoys, transport failures,
  request/fence read counts, and a throwing real log sink.
- Cloudflare package typecheck and whitespace checks passed.
- Complexity guard passed: no debt or hotspot above 20; maximum 12 to 15.
  Further extraction would add an owner for one small failure boundary.
- Final ReviewGPT round 1 passed on
  `8a3b36c4f97aa497501d88810121f43d8e12c967`, with no findings. The full sensitive
  snapshot, exact response/turn hash, concrete gpt-6-pro capture and completion
  marker were verified after more than five minutes. It reviewed the complete
  five-file candidate and composed authority, transport, parser and log owners.
- Parent final review accepted the result and confirmed no new production edit
  is needed. The plan closeout is explanatory documentation only and retains
  that substantive review under the review-loop exemption.
- Implementation and local verification are complete. Required exact-head CI
  remains the PR handoff gate and will be recorded in the PR evidence. Merge and
  deployment remain held pending canonical compatibility and recovery authority.
- No production mutation, replay, provider send, release-guard bypass, merge or
  deployment was performed. Retain the open PR worktree for the existing owner.
Completed: 2026-09-12
