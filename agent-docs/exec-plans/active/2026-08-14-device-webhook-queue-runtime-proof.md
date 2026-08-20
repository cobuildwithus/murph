# device-webhook-queue-runtime-proof

Status: active
Created: 2026-08-14
Updated: 2026-08-20

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
- An authenticated source-attributed Junction webhook can recover an
  established legacy connection whose canonical source row is absent, without
  weakening source-disconnect fences or admitting provider data before live
  provider proof.

## Scope

- In scope: Worker queue-ingress observability, the narrow Web error projection,
  tests, durable operations documentation, and the protected rollout proof.
- Out of scope: a new queue owner, provider parser changes, database schema
  changes, or bypassing provider signature verification and required checks.

## Product UX

- Effort: Patch.
- Outcome: Existing members with a live Junction source resume webhook imports
  automatically when an older connection is missing its canonical source row.
- Reaches: The existing provider webhook recovery journey only; connected
  sources, explicit disconnects, unsupported providers, and member controls do
  not change.
- Candidate proof: Production-faithful unit and PostgreSQL scenarios show live
  provider proof advances the reconstructed candidate, while inactive provider
  state remains disconnected and the same prepared event stays retryable.
- Deployment proof: Retained encrypted traffic must drain and the five-hour
  Junction-only canary must stay healthy before rollout completion.
- Walkthrough: Ready for candidate review based on the production-faithful
  active-provider and inactive-then-replay paths. Rollout completion remains
  pending the retained-traffic drain and monitored production canary.

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
4. Risk: reconstructing a missing Google Health source admits the source but
   leaves Fitbit migration permanently pending because its initial history
   work is not bound to the new Google Health source epoch.
   Mitigation: use one source-establishment work shaper for callbacks and
   webhook recovery, bind both exact-source backfills to the admitted Google
   Health `firstSeenAt`, exclude legacy Fitbit reconcile work, and prove the
   mailbox through hosted parsing and the Junction job executor.

## Tasks

1. Add a closed Worker persistence-stage error and value-free control response.
2. Preserve that bounded response code through the Web device-sync error path.
3. Add focused coverage and update the device-sync control-plane operations doc.
4. Run focused tests/typechecks, commit, push, and complete ReviewGPT/CI.
5. Merge, deploy the Worker through the protected workflow, and re-run the
   one-provider production canary with Queue/DLQ/admission proof.
6. Add the smallest existing-owner recovery for a missing Junction source row,
   including focused unit and real-PostgreSQL race/authority proof.
7. Deploy Web before redriving retained encrypted traffic, prove both Queues
   drain cleanly, then re-enable Junction alone and repeat the monitored canary.

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
- Final ReviewGPT round 1 passed with no qualifying finding and noted one PR-body
  discrepancy: stage-specific codes would have reached the public provider JSON.
  Preserved the existing generic provider code and moved the closed stage into
  an allowlisted log-only detail, with composed response/log coverage.
- Accepted final round 2's review-induced complexity finding: deleted the
  duplicate uppercase Web diagnostic vocabulary and mapper. The Worker-owned
  raw code now crosses the existing HTTP error object unchanged and is checked
  once at the structured-log boundary; absent or unknown values collapse to
  `enqueue_failed`.
- Final ReviewGPT round 3 opened no tactical finding and required the mandatory
  round-3 retrospective. The original requirement remains a closed, value-free
  diagnosis of the encrypted Web-to-Worker handoff while provider responses
  stay generic and retryable and `Queue.send` remains the only success boundary.
  From the immutable first-reviewed head to the round-3 head, authored source
  moved from +173/-60 to +180/-60; the seven added lines are the remaining
  typed owner-boundary propagation needed for the log-only stage, while round
  2 deleted 32 net source lines of duplicate Web vocabulary and mapping.
- Retrospective decision: explicitly continue the current reduced direction.
  The fine-grained closed stages are required to distinguish the observed
  production canary's crypto/configuration failure classes without values. The
  hosted-control package owns persistence classification, the Worker owns the
  wire vocabulary, the existing HTTP error transports it unchanged, and Web
  has one allowlist solely at the structured-log boundary. The provider-facing
  response remains generic. No mapper, second taxonomy, state owner, service,
  queue, compatibility path, or diagnostic persistence remains or may be added
  within this direction.
- Retrospective invariant and stopping rule: signature/body parsing, provider
  retry, Queue acceptance authority, key rotation, consumer retry, and DLQ
  behavior remain unchanged and directly covered. Any further proposed change
  to this diagnostic projection, vocabulary ownership, or stage cardinality
  requires requirement-level reconsideration instead of another tactical
  branch. The immutable first-reviewed baseline remains unchanged.
- The post-deploy Junction canary reached `persistence_reseal_failed`
  consistently. A focused workerd reproduction proved the root cause: workerd
  exports an ECDH public JWK with an own `d` property whose value is
  `undefined`, while the shared public-JWK normalizer rejected the property by
  presence alone. Node omits the property, so the previous Node-only proof did
  not exercise the deployed shape.
- Requirement-level reconsideration is satisfied by the smallest correction:
  continue rejecting every defined private scalar, accept only the
  platform-equivalent `d: undefined` public shape, and add a workerd
  open/reseal/reopen regression. This changes no diagnostic vocabulary, owner,
  state, compatibility path, or Queue behavior.
- The 2026-08-20 production canary accepted ordinary Junction traffic but
  retained source-attributed events for established connections whose exact
  source row was absent. The direct path had already returned the same
  retryable failure before rollout, but Queue acknowledgement makes that
  longstanding owner gap a bounded encrypted Queue/DLQ obligation instead of
  provider-owned redelivery. Web's provider gate was rolled back before the
  Queue-health threshold, while the compatible consumer and retained encrypted
  messages remained deployed.
- Recover at the existing source-row owner: an authenticated canonical
  Junction source attribution may create only a disconnected candidate row
  under the existing health-data admission lock. Live provider proof and the
  existing final locked connection/source revalidation remain required before
  that row becomes connected or webhook effects commit. Do not accept a
  missing row as connected, mutate provider payload semantics, add a second
  lifecycle owner, or bypass a disconnect fence.
- Accepted the missing-source preliminary specialist findings. Candidate
  review now relies on the production-faithful active-provider and
  inactive-then-replay paths; retained-message drainage and the five-hour live
  canary are deployment-completion proof rather than a pre-merge walkthrough
  prerequisite. The real-PostgreSQL scenario now proves the failed attempt
  leaves one frozen-time disconnected candidate, releases the trace, creates
  no webhook effects, and lets the same prepared event connect exactly once
  after provider authority becomes live.
- Accepted the first Apollo full-patch findings for missing-source recovery.
  A disconnected candidate observed by a newer queued event is pending
  authority, not terminal proof for an older retained event, so the older event
  now remains retryable without completing its trace. The real-PostgreSQL
  production-batch scenario proves that both same-account events remain
  retained until provider authority becomes live, then each commits its own
  durable payload exactly once.
- Missing-source reconstruction now also requires an existing Junction connect
  route. An authenticated but unsupported provider slug remains retryable and
  cannot create a candidate, trace, dirty work, signal, or mailbox item. This
  guard applies only when the canonical source row is absent, preserving the
  established-source behavior and explicit disconnect fences.
- Accepted Apollo round 2's Fitbit-migration finding. Missing-source recovery
  now gives its own backfill the same historical-proof authorization as an
  ordinary callback and routes both entry paths through one pure Google
  Health/Fitbit augmentation. The existing final admission's bounded legacy
  source result controls whether the exact Fitbit backfill is appended; no
  Fitbit reconcile, durable state, queue, or lifecycle owner was added. The
  hosted wake parser now admits the two manifest-owned proof fields so runtime
  can execute the durable mailbox instead of rejecting it.

## Verification

- Commands to run: focused Cloudflare route tests, hosted-control client tests,
  Web webhook queue tests, both app typechecks, required exact-head GitHub CI,
  protected deploy, Queue metrics, and aggregate Web/Worker runtime logs.
- Expected outcomes: local/remote checks green; one provider produces HTTP 2xx
  acceptance, nonzero main-Queue ingestion followed by successful batch
  admission, and no unexplained DLQ growth or rejected-query alert.
- Current focused proof: hosted-control 75 tests, Worker Queue 8 tests, and Web
  Queue/route/device-sync HTTP 46 tests pass; hosted-control, Cloudflare, and
  prepared Web typechecks pass. The first protected deploy and smoke passed;
  live main/DLQ metrics were both zero with 14-day retention and the alert
  bindings configured. The workerd reseal regression now passes; its follow-up
  PR and protected redeploy passed. The corrected transport canary accepted
  Queue traffic. The missing-source and queue/wake focused proof now passes all
  200 cases, and all 14 real-PostgreSQL authority cases pass. This includes
  inactive provider proof followed by successful replay of the same prepared
  event, same-account older/newer Queue ordering, and unsupported missing-source
  rejection without state. The added PostgreSQL case proves the admitted Google
  Health epoch is carried by both exact-source backfills with no legacy Fitbit
  reconcile. Hosted parsing and Junction executor tests prove those fields
  survive runtime handoff, stale same-day work keeps a distinct dedupe identity,
  and only the current dual-history proof can make migration ready. The existing
  PostgreSQL cutover journey now also replays the retained Google Health event
  after cutover and proves its trace plus durable payload commit. Prepared Web
  and `device-syncd` typechecking pass. Exact-head final
  review, Web redeploy, bounded encrypted redrive, and the repeated production
  canary remain pending.
