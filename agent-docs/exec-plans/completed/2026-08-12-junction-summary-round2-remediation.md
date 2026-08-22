# Junction summary ReviewGPT round-two remediation

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Resolve both accepted formal round-two findings on PR #1702: admit the importer’s exact 514-facet menstrual maximum through core, and preserve public member edits when later authoritative device snapshots retain or omit the provider facet.

## Invariants

- Junction menstrual admission remains capped at the newest 512 dated non-BBT facts; period and cycle length contribute at most two additional facets.
- Core accepts exactly the importer’s composed 514-facet maximum and rejects 515.
- Public edits of imported device events are member-owned while retaining `externalRef` and `dataOrigin` attribution.
- Provider refresh and retraction keep the existing typed, atomic conflict owner and never overwrite or tombstone a member revision.
- No full provider timeseries, new state registry, service, queue, or compatibility owner is added.
- PR #1702 keeps `a54a0a10d185c368ad4f04f0678fb84f0fe07f01` as its immutable first-reviewed head.

## Tasks

1. Raise the existing authoritative-set facet bound to 514 and prove importer/core commit, exact replay, and 515 rejection.
2. Classify public device-event edits as `manual` and reuse the existing device-event content comparison across every mutable field.
3. Prove retained and omitted authoritative updates conflict atomically through the real edit use case while replay and attribution remain correct.
4. Update durable documentation and PR disclosures, run focused checks, commit, push, and report the exact head without launching ReviewGPT.

## Verification

- Passed the complete core device-import suite (179 tests), importer suite (394 tests), real vault edit suite (5 tests), focused query suites (21 tests), and Junction contract suite (5 tests).
- Passed the foundation device-sync suites (499 tests), assistant-runtime suite (87 tests), changelog suites (52 tests), scenario integrity (204 tests), CLI package shape, and dependency guard.
- Passed relevant core, importer, vault-usecase, query, device-syncd, contracts, and hosted-web typechecks.
- Merged the exact foundation head `ec6fe97c35c23c20709b1cc0440d5a1fae0dd7ed` without conflicts and proved a clean current-foundation merge tree.
- `git diff --check`, the scoped privacy scan, and Frog inspection passed; no new repository friction qualified for a Frog entry.
Completed: 2026-08-12
