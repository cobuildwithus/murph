# Custom connections runtime and Worker relay

Status: active
Created: 2026-11-15
Updated: 2026-11-15

## Outcome and protected invariants

Part B only: approved remote tools appear in personal ordinary hosted turns,
including private email and ordinary scheduled work. Web owns credentials,
approval, membership and version admission. Runtime receives only id, slug,
generation and catalog. Restricted turns retain no mounts or shell network.

## Owners and implementation

Extend the existing internal host map and signed callback transport. Derive
mount eligibility with existing attempt capabilities; use one lazy manifest
read per invocation. Include the effective manifest in the immutable assistant
contract and reuse fresh-thread selection, with legacy compatibility only for
empty manifests. Reject internal hosts at every public-fetch redirect hop.
No Web implementation, new persistent registry, dependency or production action.

## Proof and completion

- Fake Web routes: relay authority, fencing, method/body/header boundaries,
  manifest shape, old-Web 404 and per-wake lazy memoization.
- Planning and permissions: eligible/restricted table, empty and changed
  manifests, legacy fingerprints, explicit native mount settings.
- Pinned native app-server: cold/warm declarations, add/remove/schema and
  generation changes, stale URL rejection, first-token timing.
- Relevant focused tests and typechecks, complexity review, scoped commits.
- Local-only report; no push, PR or deployment. Web-first deployment remains
  an integration requirement owned by the combined feature.

## Progress

- Read approved design, review outcomes and owner guidance. Confirmed public
  fetch has no internal-host redirect guard and warm resume uses fingerprints.

- Implemented the native-authority relay, strict manifest port, shared eligibility,
  explicit mounts, fingerprint rotation and public-fetch redirect guard.
- Focused proof: 602 Cloudflare tests and 250 engine tests passed. All four
  affected package typechecks, complexity, docs drift and gardening passed.
- Native Codex 0.167.1 proof covers discovery/call, cold/warm, add/remove,
  schema/generation changes, stale URLs, detached raw-POST denial and output
  truncation. Three interleaved samples per condition: cold medians 90 ms
  empty / 106 ms one mount; warm medians 18 / 18 ms. Local scripted-provider
  timing excludes Web/Cloudflare and remote-provider latency.
- Native config uses the supported thread-wide `tool_output_token_limit: 4096`
  as the per-tool default while mounts exist. Per-name overrides cannot be
  generated from the agreed name-free manifest; no invented wildcard is used.
  This also bounds other native tool output in those turns.
- The live synthetic Notes journey is added and compiles, but its invocation
  fails before a provider request: authenticated Codex homes are not writable
  in this sandbox (all eight presence-only candidates fail access preflight).
  Product UX verdict: Hold for live reply-quality evidence, not a model failure.
- Synthetic groups retain their existing networking; Web's personal-member
  admission is their definitive boundary. Runtime advertises no group mounts.
  Actual Web authorization and hosted egress remain Part A/integration proof.
- No standalone changelog: this is dark runtime infrastructure; the combined
  Settings feature owns the eventual member-visible release note.
- No push, PR, ReviewGPT submission, deployment or production access, per the
  task boundary. The combined PR will require external review and CI.

- Delivery blocker: `scripts/committer` exits 73 because the shared Git storage
  guard lock is outside this sandbox's writable roots. No commit was created;
  the plan remains active for commit/handoff. Changes and proof are preserved.
- The requested sibling report location is also outside writable roots; its
  write failed with `Operation not permitted`. The full report is preserved at
  `/tmp/report-runtime.md` for handoff.
