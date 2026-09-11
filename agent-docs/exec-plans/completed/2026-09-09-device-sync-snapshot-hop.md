# Characterize device-sync snapshot transport framing

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Goal

- Characterize the framing and encoding of incomplete device-sync snapshot responses using existing metadata logs, without consuming or replacing the native response stream.

## Success criteria

- Synthetic responses retain identity, headers, body state, bytes and cancellation behavior; existing log events gain only bounded framing classifications.
- ReviewGPT authors and reviews the production patch; focused tests, typecheck, complexity, documentation checks and exact-head CI pass.

## Scope

- In scope: existing Worker response-arrival and consumer snapshot-failure diagnostics, their tests, and their observability contract.
- Out of scope: provider behavior, retry changes, payload retention, new state, recovery, and unrelated source-authorization work.

## Constraints

- Technical constraints: preserve streamed bytes, response status/headers, cancellation, foreground priority, and live write-fence checks. No buffers proportional to response size, new network calls, identifiers, raw headers or parser text in telemetry.
- Product/process constraints: local agent owns evidence and validation; ReviewGPT owns all production implementation and substantive revisions. Telemetry-only merge/deployment requires all normal gates and exact reviewed scope.

## Risks and mitigations

1. Replacing a native response stream can alter transport framing or compression.
   Mitigation: do not read, clone or replace the stream. Classify only existing headers and prove response identity and unchanged body state.

## Tasks

1. Verify producer and consumer byte-count evidence and existing owner contracts.
2. Run the existing composed snapshot diagnostics reproduction.
3. Ask ReviewGPT for finite framing metadata at existing log sites after rejecting an unproved stream wrapper.
4. Apply the accepted patch exactly, validate, review and open a PR.
5. Complete final review and CI; evaluate exact telemetry deployment authority and record the observation query.

## Decisions

- Existing producer marker and consumer mismatch establish incomplete delivery, but do not identify the losing transport hop. Preserve this uncertainty rather than introducing speculative retries.
- ReviewGPT declined the initial stream observer because byte-for-byte JavaScript forwarding does not prove native HTTP framing and compression equivalence. The narrower probe answers whether framing or encoding metadata differs at arrival and failure; it does not prove EOF, identify the losing hop, or authorize a later stream wrapper.
- No production data, messages, provider payloads or secrets enter source or review context. Use synthetic fixtures only.
- Existing source-authorization optimization is independently owned and does not instrument this response boundary.

## Verification

- Commands: focused Cloudflare snapshot/forwarding tests, Cloudflare typecheck, complexity diff, documentation drift and gardening, final ReviewGPT and exact-head CI.
- Baseline proof: six new decoder cases fail specifically because the framing fields are absent. An independent outbound-handler test reproduces the same missing fields while preserving the synthetic response bytes.
- Final local candidate: all 361 focused tests, Cloudflare typecheck, complexity, documentation drift and gardening pass. Forwarding complexity remains 47, decoder maximum remains 40, and the shared classifier is 16. Parent review confirms exact author-owned source, unchanged delivery, finite metadata and no extra events.
- Delivery gates: final external ReviewGPT, exact-head CI, merge and deployment verification remain pending at this implementation snapshot. Live PR evidence and the private automation record own those subsequent receipts; this historical plan is not a deployment or health certification.
- Observation: after verified telemetry rollout, inspect finite framing and encoding classifications on natural Worker snapshot arrivals and consumer failures for 24 hours, extending to 72 hours only if no natural occurrence. Remove the fields and classifier once the prerequisite is characterized or the bounded window yields no useful evidence; retained records expire under existing policy.
Completed: 2026-09-09
