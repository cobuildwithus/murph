# Retire Promoted Inbox Document Duplicates

Status: completed
Created: 2026-08-30
Updated: 2026-08-31

## Goal

- Bound duplicate document bytes under `raw/inbox/**` by extending the existing inbox attachment-retention owner after a durable canonical promotion exists.

## Success criteria

- An aged inbox document is retained unless its exact bytes have a canonical promoted owner under `raw/documents/**` and no active durable reference still protects the inbox path.
- A proven promoted duplicate is removed through the existing atomic retention/tombstone path.
- Media retention, unpromoted documents, mismatched copies, referenced attachments, recent attachments, and SQLite snapshot policy remain unchanged.
- Focused tests, the owning package typecheck, required reviews, and exact-head CI pass.

## Scope

- In scope: inbox attachment-retention classification, proof of canonical document promotion, focused tests, and the durable vault-layout/file-count contracts.
- Out of scope: snapshot-time deduplication, content-addressed storage, hardlinks, shorter media retention, integration-ledger pruning, automation retention, and SQLite portability.

## Constraints

- Keep deletion inside the existing inbox-retention owner and its canonical lock/tombstone transaction.
- Fail closed when stable promotion correlation, canonical evidence, bytes, path ownership, or references are ambiguous.
- Preserve the current grace period and all existing protection rules.
- Add no dependency, service, index, queue, or second retention format.

## Risks and mitigations

1. Risk: deleting an unpromoted or divergent document.
   Mitigation: require an exact canonical document owner plus byte-size and SHA-256 agreement before eligibility.
2. Risk: deleting bytes still named by durable state.
   Mitigation: reuse the existing protected-reference inventory and atomic retention revalidation.
3. Risk: partial promotion or cleanup interruption.
   Mitigation: retain the inbox source until canonical promotion is already durable; use the existing append-tombstone-and-delete batch.

## Tasks

1. [x] Trace document promotion, exact-source proof, lazy restore, and retention ownership.
2. [x] Implement the narrow eligibility extension and focused regression coverage.
3. [x] Update durable contracts and run focused verification/typecheck.
4. [x] Connect the registered explicit document-save path to exact inbox preservation after the final review found the correlation writer was otherwise unreachable.
5. [x] Complete required specialist and final review gates, commit, push, and close this plan.

## Decisions

- Preserve the existing 14-day grace period instead of accelerating cleanup for recent promoted media.
- Reuse the existing monthly attachment-retention ledger with a document-specific tombstone variant instead of adding a second owner or file family.
- Record one idempotent, content-free capture/attachment/document/event correlation in the existing audit stream at the successful default-promotion boundary, then reuse Core's full live exact-source audit/event/manifest/artifact proof under the existing canonical lock.
- Accept any matching live exact owner while preserving Core's deleted-source fence; same bytes alone never prove promotion.
- Keep historical promotions without the stable correlation fail-closed instead of inferring ownership from content that capture retention can truncate or delete.
- Keep the historical `inbox_media_retention` orchestration mode so this storage cleanup adds no scheduler or runtime state.
- Admit promoted documents through the existing retention batch limits and verify all admitted byte receipts from one transient audit/event ledger snapshot. This removes repeated vault-wide reads without adding a cache, cursor, index, or persisted state.
- Route only option-free explicit saves of an exact current `raw/inbox/**` document path through Inbox Services. Resolve capture and attachment identity internally, preserve exactly one attachment under the existing canonical lock, and read back the canonical manifest for the unchanged CLI receipt. Explicit overrides, `--reuse-exact`, and non-inbox sources retain generic import behavior; invalid inbox identity fails closed.
- Resolve an existing IDs-only correlation and its live exact Core evidence before metadata-derived discovery or import. This keeps retries idempotent after capture-text retention and rejects a deleted or damaged prior owner before a replacement can be written.
- Carry each admitted byte receipt into the existing write-batch delete precondition so the final filesystem mutation rechecks the same bytes proved under the retention lock.

## Review round 3 retrospective

- Trigger: round 3 verified both prior corrections but required the mandatory later-round retrospective. The immutable first-reviewed head changed 13 files and 1,133 lines, including 442 authored-source churn lines; the current reviewed head changes 20 files and 2,498 lines, including 1,074 authored-source churn lines.
- Growth attribution: round 1 deleted document budget bypasses and per-candidate ledger scans in favor of the existing admission budget and one grouped Core proof. Round 2 deleted identity reconstructed from expiring capture text and added one stable IDs-only correlation at the existing default-promotion boundary. Remaining growth is conflict handling, package integration, and focused or production-path proof for those independent root causes.
- Product decision: cleanup is prospective for correlation-bearing default promotions. Historical promotions without the stable correlation remain fail-closed because deleted or truncated capture text cannot support a safe backfill. No metadata inference, hash-wide authorization, migration, repair pass, or reconciler is approved.
- Architecture decision: continue with one indivisible existing-owner design. Inbox Services owns the promotion-boundary write, Core's audit ledger owns the durable correlation and grouped exact proof, and Inboxd's existing retention owner alone admits and deletes. Splitting changes rollout timing without removing a concept; redesigning away from the promotion boundary recreates the expiring-metadata defect.
- Owner budget: the two narrow Core correlation functions remain public only because sibling packages must use public entrypoints. Further work may delete, reorder, or tighten these owners but may not add another owner, file family, state machine, queue, cache, cursor, index, migration, backfill, repair pass, or reconciliation loop without new production evidence.

## Review round 4 disposition

- Accepted: the registered production `document import` path called the generic importer directly, so ordinary explicit saves never reached either correlation writer and remained retention-ineligible.
- Root cause proof: the command descriptor and handler carried only file/metadata into `services.importers.importDocument`; both Inbox Services preservation methods had no production CLI caller.
- Correction: thread the existing Inbox Services instance into the document command, route only an option-free exact current inbox path to a stateless exact-one preservation seam, and reuse the existing canonical match/import/correlation owner. Multi-document captures select by the exact stored path, retries recognize both legacy and current versioned manifest names, and stale or ambiguous paths fail closed.
- Complexity boundary: no automatic ingestion, new persisted state, index, queue, migration, backfill, repair pass, or model-supplied identity was added.

## Post-round-4 independent audit disposition

- Accepted: final deletion verified bytes during admission but did not pass that receipt to the existing write-batch delete precondition. The final mutation now carries and rechecks the already-computed size and SHA-256 without adding a second mechanism.
- Accepted: the first production-path test registered the document command directly and would not catch descriptor-wiring regressions. The journey now constructs the CLI through `createVaultCliWithOptions`, which exercises the production command registry.
- Accepted: attachment path parsing used two inconsistent `attachments` segment rules. Identity now derives from the final attachment directory and the shared validator anchors directly to the capture's current `sourceDirectory`; a valid account segment named `attachments` is covered.
- Accepted: retry discovery depended on capture text that expires after 14 days, and retained manifests were not sufficient proof that their owners remained live. Preservation now resolves the stable correlation plus Core's live exact evidence before metadata or import; the production-registry journey proves an after-retention retry stays single-owner and a deleted owner fails without another manifest.
- Accepted: the route classifier resolved relative paths differently from the generic importer. Both now preserve the existing process-working-directory convention.
- Accepted: one preserve-all batch snapshotted live document IDs before processing, so later byte-identical attachments could not reuse a document created earlier in that batch. One per-receipt in-memory set is now updated after each successful reuse or create; the seam test proves one canonical document with distinct correlations for both attachments.
- Complexity boundary: all corrections reuse existing Core evidence, Inbox Services ownership, command registry, and write-batch preconditions; no new durable owner, file family, cache, index, queue, scheduler, migration, or repair loop was introduced.

## Review round 5 disposition

- Accepted: the CLI classified a process-working-directory-relative inbox source with an absolute path, then passed the original relative string into a vault-relative resolver. With a relative `--vault`, that second interpretation doubled the vault segment and rejected an otherwise valid save.
- Correction: one command-local resolver now returns either the normalized absolute inbox source or `null`. Inbox Services receives that resolved source, while the unchanged CLI receipt retains the caller's original `sourceFile` string.
- Proof: the production-registry journey now runs from the vault parent with relative `--vault` and source arguments, then proves the first save, immediate retry, and post-text-retention retry remain exact and idempotent.
- Review boundary: the user explicitly opted out of another ReviewGPT round after this narrow accepted correction. Parent review, focused local proof, exact-head CI, and merge-conflict proof remain required.
- Complexity boundary: the correction deletes a redundant path-resolution branch and adds no owner, helper layer, state, dependency, or compatibility path.

## Verification

- Passed: contracts full package tests and artifact verification (42 files, 347 tests).
- Passed: Core full package suite (49 files, 836 tests) and focused exact-source/correlation suite (10 tests).
- Passed: inboxd full package suite (21 files, 222 passed, 3 skipped) and focused attachment-retention suite (31 tests).
- Passed: inbox-services full package suite (13 files, 67 tests) and focused created/reused/override promotion seams (7 tests).
- Passed: hosted lazy snapshot -> materialize -> retain -> checkpoint -> restore -> rebuild -> validate journey; hosted retention file (17 tests) and Linq preservation E2E (1 test).
- Passed: contracts, Core, inbox-services, inboxd, and assistant-runtime typechecks and builds.
- Passed: completion correctness, security/privacy, simplicity, and coverage audits after accepted remediation.
- Passed: agent-doc drift and `git diff --check` before the review-candidate commit.
- Passed after round 4 remediation: Inbox Services full suite (13 files, 67 tests), focused CLI document/meal file (10 tests), hosted retention file (17 tests), and inbox-services/CLI/assistant-runtime typechecks and builds. The production CLI proof covers exact selection from a two-document capture, idempotent retry, override and explicit-reuse non-correlation, and stale-path rejection; the hosted journey uses the same Inbox Services seam before lazy snapshot retention and restore validation.
- Passed after independent audit remediation: inboxd attachment-retention suite (31 tests), Inbox Services full suite (13 files, 67 tests), focused production-registry CLI file (10 tests), and hosted retention file (17 tests). The CLI proof additionally covers a valid `attachments` account segment, retry after text retention without a second manifest, deleted-owner rejection before import, and unchanged relative-path semantics.
- Passed after round 5 remediation: the exact relative-vault production-registry journey, the full 10-test CLI document/meal file, CLI typecheck and build, agent-doc drift, privacy scan, and `git diff --check`.
Completed: 2026-08-31
