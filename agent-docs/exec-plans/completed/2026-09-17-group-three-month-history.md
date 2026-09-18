# Extend group sharing to a 90-day default

## Outcome and protected invariants

Group graphs can use 90 member-local civil dates of available canonical health data. Per-member metric consent, source provenance, revocation, current membership, bounded work and producer ordering remain authoritative. Candidate default preserves existing seven-day approvals until explicit expansion; existing approvals require explicit expansion.

## Owners and evidence

The current vault-share producer limits daily/night scopes to seven dates; shared delivery validators admit 56 source/date records and 320 KiB snapshots. Web owns encrypted replacement snapshots and immutable consent offers. `read_shared` freshness checks recover only recent sync work and cannot fetch arbitrary historical data. Graph rendering does not widen authority. Extend these owners rather than adding a historical archive or provider backfill.

## Implementation and proof

- [x] ReviewGPT authors substantive implementation against guarded source snapshot.
- [x] Parent inspects patch, consent transition and complete cross-owner bounds.
- [x] Focused producer, scope/parser, consent, read and maximum-payload tests; affected typechecks.
- [x] Product UX proof for new approvals, existing7 approvals, expanded approvals, sparse history, timezone edges, revoke/regrant and existing short-window consumers.
- [x] Changelog, candidate review, draft PR and final ReviewGPT.
- Final documentation-only closeout commit retains required exact-head CI as the PR handoff gate.

## State and failure boundaries

Use existing grant and snapshot owners. No historical store, broad provider import, or extra queue. Old offer replay cannot authorize a changed scope. Declare concrete consumer-first compatibility and rollback floor before publication. Retain missing-versus-zero and partial-coverage meaning; projection window is not deletion TTL.

## Execution log

- Isolated authorized worktree created through the primary checkout helper; the desktop-created research checkout lacked storage-guard registration. No guard state was changed.
- Source-only research completed without private record access. No inference about in-window data defects.
- ReviewGPT will author the patch; local owner retains review, verification and PR completion.

- Direct tooling correction necessity: ReviewGPT custom snapshot packaging failed twice before submission because expected exclusion warnings exceed its 1 MiB child buffer. Reused Frog entry `20260915214405-reviewgpt-packaging-exceeds`; extended the existing PR diagnostic-summary behavior to the custom authoring path without changing selected files or privacy guards. This is necessary to use the requested patch author, not a direct feature implementation.

- Baseline provider-input proof passed for direct and group fixtures (two checks): current direct request 158826 UTF-8 bytes, group 146400 bytes. Use current/head measurements from the graph-input fixture at both task base and candidate; its separate graph-guidance ablation is not this task baseline. Exact tokenizer unavailable.
- Custom packaging regression: both success and exit-17 paths passed with more than 1 MiB of expected stderr, bounded forwarded warnings and preserved complete diagnostics.
- Review checklist includes the Web delivery 60-day age filter, producer civil-date boundaries, all-source preservation, old/new scope registry and immutable offers, sparse data, weekly consumer date filtering and model result capacity disclosure.

- Baseline `vault-share-projection.test.ts`: 140 tests passed in the isolated worktree before feature application.

- ReviewGPT supplied the substantive 34-file feature patch. Local necessary corrections address reproduced legacy workout date regressions and preserve pre-upgrade snapshot availability instead of introducing a new rollout outage. The original authoring patch remains in ignored evidence. Six history contract tests passed; initial focused runtime checks found seven failures, and Web checks found eight, under triage.

- Patch attachment recovery reused Frog entry `20260829230530-reviewgpt-patch-attachment`; no duplicate created. The canonical capture was retained and exact generated patch recovered through its download control.
- Candidate verification: contracts 119, runtime projection 147, Web 362, assistant-tool 117, Cloudflare ports 21 focused tests passed. A 200-member/800-snapshot read proof passed with 201 sequential transactions and exact authority rechecks. Complexity guard passed after extracting the date-window and bounded snapshot owners and removing redundant guards.
- Real subscription journey passed using production prompts/tools: one roster read and two exact participant/date history pages, two sparse observations, correct comparison and no unsupported steady-trend claim. Reply review Ready. Provider input bytes: direct unchanged 158826; group 146400 to 151086 (+4686, +3.20%); exact tokenizer unavailable.

- All five affected package typechecks passed. Day-89 delivery is retained and day-90 is excluded. Consent browser journeys passed at 390 and 1280 pixels; inspected synthetic screenshots show new defaults and explicit existing-permission expansion without overflow. The test must remove every inert presentation ancestor and click the visible permission label.
- Draft PR #3565 opened. Preview packaging reused Frog entry `20260913213526-vercel-source-preview` (archive mode); build-root correction under way. Public proof uses only committed source and synthetic UI.

- CI surfaced stale seven-day scope/count/schema expectations and an unregistered tooling regression test. Focused corrections preserve the explicit new bounds. A repeat real assistant journey exposed an unnecessary expansion-permission question despite existing authority; deterministic guidance checks and the corrected real journey now pass. Final input bytes are direct 158826 (unchanged), group 151728 (+5328, +3.64%); tokenizer remains unavailable. Final external review is in progress on the first pushed candidate.

- Round 1 external review passed on `2e5e0ebb68fa3676587a54cc49e442122fa52a88`: full source snapshot, attached and accepted, exact response capture, gpt-6-pro selection and backend model attestation match. Review elapsed approximately 12 minutes, above the 180-second minimum. Inspection covered authority, date/source completeness, paging, bounds and legacy consumers with an explicit deployment limitation; accepted as substantive. No findings. Apollo staging failed before submission; Eragon override is retained for the next full sensitive review. The hosted consent preview is Ready and authenticated retrieval confirms both 90-day copy and existing-permission expansion state.

- Round 2 passed on `f9b542114d2677bba465b5c7c4b4fd72346af6ea`, with full sensitive snapshot and all 50 changed-file hashes verified by the reviewer. First/previous ancestry and current context anchor matched the packaged metadata. Exact-turn capture and requested/backend gpt-6-pro evidence matched; elapsed review exceeded ten minutes. No findings. Parent final review found no further changes needed; remaining deployment order is operational, not a local deployment claim. Closing the implementation plan changes only historical documentation and its index; the final authored head still requires CI before handoff.
Status: completed
Updated: 2026-09-18
Completed: 2026-09-18
