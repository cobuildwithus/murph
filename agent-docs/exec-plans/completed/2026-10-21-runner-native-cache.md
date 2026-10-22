# Reuse unchanged native Codex compilation across runtime updates

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Outcome and protected invariant

Reuse unchanged native Codex compilation when Node changes and across ephemeral
CI runners. Preserve the exact native source, helper bytes, sandbox checksum,
full final-image fingerprint, supply-chain pins, and release proof.

## Evidence and owner

The base-image publisher did not export or import intermediate Docker cache.
Native compilation copied helpers from a Node-derived npm install stage, coupling
its input to runtime updates. The existing runner-base-image helper and Dockerfile
own preparation; the protected-main publisher remains the only cache writer.

## Scope and decisions

- Download the same npm platform archive directly with a verified SHA-256 pin.
- Import a protected-main registry cache on builds; export all intermediate layers
  only from publication, retaining bounded two-job Cargo concurrency.
- Remove compiler scratch from the completed compile layer and serialize publisher
  runs without cancelling an in-flight publication.
- Keep deployment sequencing and the currently active security rollout with the
  original completion owner. No production mutations from this checkout.
- Cache is rebuildable execution scratch, never authoritative release provenance.
  Missing cache falls back to exact source compilation; image admission stays strict.

## Verification

- Verify downloaded archive against npm registry SHA-512 integrity; inspect helper
  extraction and checksum parity.
- Focused image preparation and container contracts, Cloudflare typecheck,
  complexity review, and exact-head CI including native sandbox proof.
- Record actual build reuse only when observed; local Docker is unavailable.

## Progress

Implementation and focused local proof complete. Existing runner bundle latency
Frog entry updated. The original completion owner retains final review, exact-head
CI, merge timing, and production rollout.

- 26 focused image preparation/container contract tests passed on Node 24.22.1.
- Cloudflare typecheck passed after fresh-checkout Prisma client generation.
- Upstream verifier passed: exact Codex tag, commit, patch applicability, and all
  13 reviewed source paths unchanged.
- Registry archive SHA-512 matches published integrity; extracted bundled bwrap
  SHA-256 is 77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c.
- Complexity guard passed: zero debt delta, no functions above 20.
- Shell syntax passed. Synthetic command proof rejects an uncached Cargo vertex.
- Actual Docker cache-hit timing and native sandbox CI remain pending; Docker's
  local daemon is unavailable. No speedup measurement is claimed from unit proof.
- No member-visible behavior or provider-input change; no public changelog item.

Completed: 2026-10-21
