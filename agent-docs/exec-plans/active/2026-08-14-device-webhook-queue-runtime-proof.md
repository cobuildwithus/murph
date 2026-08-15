# device-webhook-queue-runtime-proof

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Make the encrypted device-webhook Queue path safe to enable in production by
  exposing a value-free failure stage for the Web-to-Worker transport contract,
  proving the exact deployed crypto/binding path, and restoring
  one-provider-at-a-time rollout only after the proof passes.

## Success criteria

- A failed Web-to-Worker enqueue identifies the bounded Worker stage without
  logging envelope contents, provider payload, raw key material, or identifiers.
- Focused tests and typechecks pass for the changed Web/Worker path.
- ReviewGPT and exact-head required CI pass before merge.
- The protected Cloudflare deployment succeeds before any Web provider gate is
  enabled.
- Junction is enabled alone and live proof shows accepted queue traffic, clean
  Queue/DLQ health, and successful Web batch admission before later providers.

## Scope

- In scope: Worker queue-ingress observability, the narrow Web error projection,
  tests, durable operations documentation, and the protected rollout proof.
- Out of scope: a new queue owner, provider parser changes, database schema
  changes, or bypassing provider signature verification and required checks.

## Constraints

- Technical constraints: keep transport payloads encrypted, preserve fail-closed
  provider retry behavior, and keep transactions database-only and bounded.
- Product/process constraints: deploy Queue infrastructure and Worker first;
  enable providers individually; retain the DLQ, old decrypt keys, and decoders
  until all queued/redrive traffic drains.

## Risks and mitigations

1. Risk: diagnostics disclose private webhook or cryptographic material.
   Mitigation: emit only a closed, value-free stage code derived at the owner
   boundary; never serialize the caught exception or envelope.
2. Risk: a stale Vercel build re-enables the failed gate.
   Mitigation: keep the gate removed and production pinned to the known direct
   deployment until the correction is deployed and proved.
3. Risk: a provider receives a false success or duplicate processing.
   Mitigation: keep `Queue.send` acknowledgement as the only success boundary
   and retain provider redelivery plus existing trace idempotency.

## Tasks

1. Add a closed Worker persistence-stage error and value-free control response.
2. Preserve that bounded response code through the Web device-sync error path.
3. Add focused coverage and update the device-sync control-plane operations doc.
4. Run focused tests/typechecks, commit, push, and complete ReviewGPT/CI.
5. Merge, deploy the Worker through the protected workflow, and re-run the
   one-provider production canary with Queue/DLQ/admission proof.

## Decisions

- Rejected a speculative key rotation or environment rewrite: existing encrypted
  runtime flows make either unsafe without proving the exact failed stage.
- Rejected raw exception logging: the static failure stage is sufficient and
  does not expose provider, key, or envelope values.
- Accepted the preliminary specialist finding that keyring construction sat
  outside the typed stage owner; the existing persistence-key stage now owns
  malformed active and retained key material too.
- Accepted the preliminary coverage finding: rotation proof now re-encrypts to
  and reopens with the active key, unusable reseal is classified, Worker tests
  require an exact value-free body, and Web projection uses the real control
  HTTP parser instead of a mocked reader.

## Verification

- Commands to run: focused Cloudflare route tests, hosted-control client tests,
  Web webhook queue tests, both app typechecks, required exact-head GitHub CI,
  protected deploy, Queue metrics, and aggregate Web/Worker runtime logs.
- Expected outcomes: local/remote checks green; one provider produces HTTP 2xx
  acceptance, nonzero main-Queue ingestion followed by successful batch
  admission, and no unexplained DLQ growth or rejected-query alert.
- Current focused proof: hosted-control 75 tests, Worker Queue 8 tests, and Web
  Queue/route 32 tests pass; hosted-control, Cloudflare, and prepared Web
  typechecks pass. Exact-head CI and corrected production canary remain pending.
