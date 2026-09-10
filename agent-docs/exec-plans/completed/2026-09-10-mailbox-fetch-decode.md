# Decode inline conversation payloads during mailbox fetch

## Outcome and protected boundary

Remove the second container-to-Worker request for fresh inline conversation
messages. Web retains encrypted mailbox ordering and access/usage gates; Worker
retains ingress keys and write-fence validation; runtime retains payload identity,
routing, skipped-item and import semantics. No plaintext is persisted or logged.

## Evidence and smallest design

The existing authenticated Worker proxy already receives ciphertext while
forwarding mailbox fetch. It can decode eligible inline conversation items there
using the existing decoder owner. Add an explicit request opt-in and an optional
parsed wake on the response item; carry it to the existing importer. No cache,
side map, second scheduler, new endpoint or key distribution is necessary.

Only fresh inline conversation items are enriched. Large sidecar payloads keep
the existing fetch/decode path: fetching all sidecars eagerly would add network
work for items that runtime later skips and delay the first conversation item.
Retired, consumed and system items retain their current lazy behavior. Decode
failures retain the ordinary decoder path and its existing error semantics.

## Rollout and proof

Old containers omit the opt-in. Old Workers ignore it and return ciphertext;
new containers retain the existing decoder for that case and for sidecars. No
persisted shape changes or hard-cut deployment are required. Current/current
inline imports should make one fewer HTTP request and write-fence RPC.

Prove real Worker decryption and import composition, caller skew, user/fence
mismatch, skipped/consumed/sidecar cases, crypto failure and cancellation. Run
focused Cloudflare/shared-contract/assistant-runtime tests, affected typechecks,
complexity review, then PR review and exact-head CI. Product UX Patch: shorter
message setup with identical accepted assistant input; live latency awaits deploy.

## Candidate evidence

- Composed Worker/port tests prove real secure-box decryption with one container
  fetch, one Web forwarding call and one write-fence check, and one crypto context
  per batch. Old containers omit the opt-in; old Worker responses are accepted
  by the existing port and decoder. Canonical Web parsing discards decodedWake.
- Runtime bridge tests import the same conversation with and without enrichment;
  enriched imports never call the decoder and preserve staged-input evidence.
- 67 Cloudflare decode/encryption/bridge cases, 272 routing cases, 80 assistant
  payload/import cases and 10 changelog SSR cases pass. The composed check
  also covers the maximum 100-row conversation batch and resolves crypto context
  once. Cloudflare and assistant-runtime typechecks pass, including final stable
  formatting and no-store response policy. The final 15-case composed batch
  proof and final Cloudflare typecheck also pass.
- Complexity guard passes. The web-control handler drops from 47 to 46 by deriving
  five POST-only classifications from the already-validated route policy. Its
  broader dispatch ownership and two unrelated runtime hotspots remain unchanged.
- Public payload, assistant instruction/tool assembly, model choice and import
  identity checks remain unchanged. Success is deterministic transport equality,
  so no live-Codex behavioral journey or provider token measurement is applicable.
- Parent candidate review found no new durable state, key disclosure, additional
  success-path network call or changed usage/access authority. No merge or
  deployment is included. Final-head CI remains the PR completion gate.

## Final review and handoff

ReviewGPT round 1 passed on `526ddd0bfa678e34842f50a7b2a86149d9bd237d`
with no qualifying bugs or material Complexity Collapse findings. The reviewer
checked the full patch and snapshot through crypto, authority, import, batching
and both rollout directions; tests were inspected rather than executed there.
The parent ran the focused checks above. Persisted gpt-6-pro model metadata,
response hash and captured response/user-turn identity agree. Managed browser
response waiting exceeded the required 270 seconds. The final follow-up only
closes this plan and records existing evidence; production source is unchanged.

The two mailbox PRs merge cleanly with each other and with the earlier-wake PR.
Current-base mergeability and all applicable final-head CI checks remain required
at PR handoff. Production timing improvement remains unmeasured until deployment.
Status: completed
Updated: 2026-09-10
Completed: 2026-09-10
