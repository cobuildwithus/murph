# Remove the serial mailbox crypto-context request

Status: active
Created: 2026-09-14
Updated: 2026-09-14

## Goal and success criteria

Deliver the signed ingress envelope with an authorized mailbox fetch on a Worker envelope-cache miss. Decode the current message without a second Web request; preserve existing signature, user, domain, workspace, consent, and allowance checks.

## Scope and constraints

Reuse the existing bounded encrypted-envelope cache and cryptographic verification. Request one ingress envelope per eligible batch, only on cache misses. Never persist plaintext roots or wakes. Preserve lazy decode for old Web versions, sidecars, corrupt items, and historical roots. Keep typing placement and model inputs unchanged. No deployment or database migration.

## Product UX

Patch: reduce startup latency in private and group conversations. Empty, system-only, consumed, and denied batches perform no additional crypto reads. Synthetic tests cover the real Worker/container path and signed-envelope verification; no prompt or reply behavior changes.

## Decisions and risks

- Carry an optional Worker/Web response extension outside the canonical mailbox parser; strip it before returning to the container.
- Reuse the current workspace-provisioning check before reading an envelope. No new authority or cache owner.
- Old Web omits the extension and uses existing lazy context resolution. Old Workers never request it. Invalid envelopes remain subject to existing verification and item-level failure handling.
- The optimization removes a serial network/authentication boundary; it does not claim to explain every production scheduling delay.

## Tasks and verification

1. Add cache-presence and supplied-response entrypoints to the existing crypto owner.
2. Opt into and attach one signed ingress context for eligible mailbox fetches.
3. Prove call counts, cache hits, rollout skew, denied/consumed paths, corrupt envelopes, and identity boundaries.
4. Run focused Worker and Web tests, both typechecks, complexity guard, candidate review, ReviewGPT, and required PR checks. Add the changelog and update the protocol owner.
