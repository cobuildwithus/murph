# Vault display name runtime

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and protected boundary

Give the Web half of first-name sync something to read and something to write.
Replicas and their core shard carry an optional `displayName`, and a
`display-name.set` member action saves a name through core memory. Core memory
remains the name owner. Demographics already works in both directions, so this
reuses its replica field and member-action seams, with no new state.

## Scope and sequence

1. Add the replica field, sourced from `readProjectableProfileName`. A failed name
   read omits the field and never fails the replica.
2. Add the name to the hosted source digest. The new segment changes every older
   source hash, so each replica rebuilds on its next refresh; generation stays 18.
3. Add `display-name.set`, handled by `setMemoryDisplayName`, whose additive
   `changed` result selects `applied` or `unchanged`.
4. Merge and deploy the runtime before the Web half, which owns the producer.

## Decisions

- No replay receipt. A new key in the strict memory frontmatter would stop older
  runtimes reading memory after a rollback, which is worse than the rare replay it
  would prevent.
- Dormant vaults are not refreshed on purpose. A replica without the field is a
  miss, and a miss is today's name screen.
Completed: 2026-11-06
