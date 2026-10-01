# Correct production canary replica freshness identity

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Allow the fixed-account canonical observer to read the current published Browser Vault replica with the live v2 checkpoint format, then complete the protected five-turn canary.

## Success criteria

- A real encrypted replica with a valid v2 checkpoint and an independent canonical source hash is readable.
- Missing, invalid, or wrong-member checkpoints, legacy generations, expired replicas, pending conversation work, authority loss, and read races remain rejected.
- The live journey retains its exact 0/1/1 goal assertions, five replies below 20 seconds, five-minute observation limits, and final same-deployment receipt.

## Scope

- In scope: fixed-account outcome reader, synthetic protocol regressions, and its live-provider owner documentation.
- Out of scope: runtime checkpoint cadence, replica generation/publication, ordinary Browser Vault authority, prompts, new endpoints, credentials, state, or dependencies.

## Constraints

Use existing public v2 parsing/fingerprint and Browser Vault freshness owners. Keep the observer input-free and read-only; retain final authority, member, workspace version, checkpoint identity, and replica identity checks. No production identifiers or logs enter source or fixtures.

## Evidence and decisions

The observer uses a legacy base/delta bundle helper. Current v2 refs have neither, so the helper returns null and every published live workspace stays not ready. Its old fixtures only cover retired bundle refs. Independently, the runtime publishes a canonical query-source hash; comparing that with an archive hash is invalid. Web already uses generation and age for published-replica freshness, while the runtime owns content hashing before publication. Reuse that policy and use the parsed v2 checkpoint fingerprint solely to detect a checkpoint changing during the read.

## Risks and mitigations

- False success from stale or racing state: retain pending-conversation checks, generation/age policy, exact decrypted member/ref validation, before/after checkpoint and workspace identity checks, and runner cardinality assertions.
- Runtime/Web skew: this change reads the existing v2 and replica protocols; no writer migration or deployment-order change is needed.

## Tasks

1. Replace retired fixtures with valid v2 refs and prove the regression fails before the implementation.
2. Correct snapshot identity and freshness ownership; extend negative/race proof.
3. Run focused tests, Web typecheck, complexity and docs checks; review and commit.
4. Complete ReviewGPT and exact-head CI, merge, wait for ordinary Web deployment, and execute one exact live canary.

## Verification

The new v2 checkpoint regression fails before implementation and passes after it. All 93 observer/runner tests pass, including malformed metadata, wrong-member/retired checkpoints, old generation/age rejection, and a same-version archive race. Web typecheck passes after normal generated-client preparation and mapping the existing public v2 module. Complexity passes (maximum 19, no debt or hotspots); docs drift/gardening and whitespace checks pass. Final review, exact-head CI, deployment, and live proof remain pending. Earlier canary failures are evidence of an unresolved issue, not a passing result.

## Completion evidence

- Final ReviewGPT: PASS on `4390eaf14f657094546a7498e439fb37e8d6066c`, full seven-file snapshot and verified `gpt-6-pro` response. It inspected v2 parsing/member binding, complete fingerprint identity, generation/age policy, encrypted decoding, authority/read races, and runner cardinality. Its direct parser/fingerprint checks passed; it did not independently rerun the reported Vitest/typecheck commands. No qualifying findings or remediation remain.
- Parent final review accepts the unchanged production source, public entrypoint mapping, and synthetic regressions. The 93 focused tests and Web typecheck were run locally; repository CI additionally passed Web test shards, database shards, build/typecheck, and Cloudflare verification.
- This closes the implementation record. Final exact-head CI, authorized merge, ordinary Web deployment, and the protected live journey remain post-commit gates owned by the current session. This pre-merge record does not claim a live pass.
Completed: 2026-09-14
