# Persist group names and cut pre-provider mailbox latency

Status: completed
Created: 2026-09-02
Updated: 2026-09-03

## Goal

- Make cold/restored Linq group replies reuse safe participant labels and avoid
  the ordinary empty second mailbox round trip, without regressing first-turn
  activation, durable mailbox recovery, or effect-time authorization.

## Success criteria

- The bounded participant-label cache survives encrypted hosted workspace
  checkpoint/restore with its existing scope hash, TTL, size, permission, and
  fail-soft rules.
- Established foreground turns reuse the already-started conversation+system
  mailbox snapshot for their first pre-assistant system page instead of forcing
  a second Web request.
- True no-vault bootstrap still fetches and applies activation before provider
  planning, and a late system item remains durable for the next owned pass.
- System-only mailbox fetches skip group-running presentation work that their
  response cannot consume.
- Focused tests, package typechecks/builds where required, a production-derived
  synthetic group journey, exact-head CI, and the required final review gate
  pass.

## Scope

- In scope:
  - Move the existing participant display-name cache from machine-local cache
    state into portable assistant operational state.
  - Restore the single-prefetch established-turn behavior made safe by the
    later bootstrap ownership change.
  - Remove the semantically unused group-running read from system-only mailbox
    requests.
  - Update current architecture, reliability, security, runtime protocol, and
    package-owner docs plus focused coverage.
- Out of scope:
  - Making participant labels canonical identity or action authority.
  - Persisting lookup failures, adding a new cache service, or migrating the old
    rebuildable cache file.
  - Removing the pre-assistant system import, bootstrap activation ordering,
    system-mailbox mode, paging, or durable retry ownership.

## Constraints

- Technical constraints:
  - Web remains the current membership/profile/contact authority; cached labels
    remain presentation-only and effect-time authorization still revalidates.
  - Preserve the original PR #1870 failure boundary for no-vault activation,
    while relying on the current durable system frontier for later established
    system work.
  - Keep snapshots encrypted and the persisted cache bounded to 2,048 entries /
    2 MiB with the existing 14-day positive and six-hour proven-negative TTLs.
  - Keep database transactions bounded and database-only.
- Product/process constraints:
  - Product UX classification: Patch.
  - Outcome: established group replies start sooner and restored workspaces keep
    already-resolved participant labels.
  - Reaches: cold/restored Linq groups, ordinary established foreground turns,
    and first-message activation bootstrap.
  - Proof: exact mailbox request ordering/recovery tests, encrypted snapshot
    round-trip, cached-label prompt journey, and manual review of the synthetic
    reply.

## Risks and mitigations

1. Risk: A system item appended after the shared fetch is not applied to the
   current established reply.
   Mitigation: This is the explicit latency tradeoff requested; keep the item
   durable, preserve later system ownership, and prove next-pass import. Do not
   apply it to no-vault activation bootstrap.
2. Risk: A renamed or revoked presentation label remains cached across a cold
   restore for the existing TTL.
   Mitigation: Keep current route/member/handle-scoped opaque keys, bounded TTL,
   fail-soft parsing, and effect-time authorization; document that the cache is
   never identity or effect authority.
3. Risk: Web/runner deploy skew changes mailbox response semantics.
   Mitigation: The Web optimization only omits a field on a request where the
   current runtime discards it, while the runtime change consumes the existing
   response shape. Either side can deploy first; verify both after convergence.

## Tasks

1. Record the original PR lineage and prove the later bootstrap architecture
   makes established prefetch reuse safe.
2. Move the cache into runtime-state-owned portable assistant state and update
   snapshot/privacy documentation.
3. Reuse the shared system prefetch on established foreground turns and skip
   group-running work for system-only Web fetches.
4. Add focused deterministic boundary, snapshot, recovery, and endpoint tests.
5. Add and run one focused real-Codex group journey, inspect the actual reply,
   then run scoped typechecks/builds and completion gates.

## Decisions

- Keep the pre-assistant system import. PR #1870 fixed a real activation race,
  while PR #1864 later made workspace-runner system import the sole activation
  owner. Reuse the shared prefetch only after the imported system watermark has
  crossed zero; retain one fresh read at zero for the exact activation race.
- Persist the cache under
  `.runtime/operations/assistant/state/group-participant-display-names.json`.
  Do not create an exception for all `.runtime/cache/**` and do not migrate the
  old rebuildable file.
- Treat cache persistence as a latency optimization, not a new product-state
  owner. Plain display labels remain inside the encrypted workspace snapshot;
  opaque cache keys continue to hide member, route, and sender handles.

## Verification

- Commands to run:
  - Focused assistant-runtime group-cache and workspace-runner tests.
  - Focused runtime-state snapshot/classification tests.
  - Focused Web mailbox-fetch route tests.
  - Assistant-runtime, runtime-state, Web, and Cloudflare typechecks/builds as
    required by public-entrypoint and package-boundary changes.
  - `pnpm test:assistant:live -- --test "<focused cached group label journey>"`.
  - `git diff --check`, privacy scan, scoped diff inspection, exact-head CI, and
    final ReviewGPT.
- Expected outcomes:
  - Restored cached labels require no Web name lookup, ordinary established
    turns issue no second mailbox fetch, bootstrap still imports activation,
    late system work remains recoverable, and system-only fetches do not query
    group-running presentation state.

## Progress

- Original lineage: PR #1870 replaced the shared prefetch with a fresh system
  read after an activation append raced the prefetched conversation import and
  left the system watermark at zero. PR #1864 later consolidated activation
  ownership in the workspace runner, so watermark zero is the narrow remaining
  exception rather than a reason to refresh every established turn.
- Deterministic proof: the original zero-watermark regression still performs a
  fresh system fetch and imports activation before the assistant. The new
  established-watermark regression performs one mixed fetch, defers a later
  preference row, and imports it on the next pass. System-only Web coverage
  proves the unrelated group-running read is skipped.
- Persistence proof: the exact cache path is classified portable/rebuildable,
  round-trips through the encrypted workspace snapshot, retains opaque keys and
  file modes, and rejects a symlinked state ancestor.
- Live journey: `gpt-5.6-terra` through local subscription auth attributed the
  synthetic sunscreen promise to the labeled speaker with zero tool calls.
  Reply review verdict: Ready.
- Focused suites: 141 assistant-runtime tests, 80 runtime-state tests, 69 hosted
  Web internal-route tests, the encrypted snapshot round-trip, and nine public
  changelog tests passed. Runtime-state, assistant-runtime, Assistant Engine,
  and Cloudflare typechecks passed.
- Local environment limitation: the Web typecheck reached the shared checker
  but used stale Prisma output from the reused dependency install and reported
  unrelated current-schema fields as missing. The same incomplete install did
  not expose an ESLint binary. Exact-head CI owns the clean dependency install,
  Web typecheck, lint, and broad suite.
- Changelog: `2026-09-02 · group-replies-start-sooner` records the member-visible
  latency outcome without publishing private timing or transcript evidence.
Completed: 2026-09-03
