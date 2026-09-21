# Preserve recoverable checkpoints and reject incomplete vault snapshots

Status: active
Created: 2026-09-20
Updated: 2026-09-21

## Goal

- Reject incomplete vault checkpoints and preserve a bounded, decryptable recovery history.
- Assess surviving encrypted recovery sources and restore only validated canonical state through an authorized protected path.
- When complete restoration is impossible, preserve authenticated recoverable information and restore runtime progress and connected-provider backfill without claiming missing files were recovered.

## Success criteria

- A replacement checkpoint without required canonical vault metadata fails before publication.
- Healthy checkpoints, legitimate canonical deletions, and first-time bootstrap remain supported.
- Superseded accepted snapshots retain their encrypted object and complete recovery reference for a documented window; ordinary orphan cleanup and account deletion remain bounded.
- Synthetic tests prove rejection, retention, cleanup, and ownership boundaries; relevant typechecks pass.
- Recovery reports distinguish restored canonical data, reconstructed data, unavailable data, and unverified evidence. Runtime progress must be read back after any restore.
- Partial recovery preserves completed onboarding, existing account/device authority, and mailbox delivery boundaries. Connected-provider imports must make observable canonical progress after publication.

## Scope

- In scope: snapshot creation/publication integrity, existing snapshot cleanup ownership, recovery assessment and controlled restoration.
- Out of scope: unrelated runtime behavior, bulk member mutations, automatic restoration from unvalidated projections.

## Constraints

- Keep production credentials and plaintext data inside the existing trusted hosted environment. Logs and repository artifacts contain synthetic data or metadata only.
- Use existing checkpoint locks, version comparisons, runtime ownership, and cleanup owners. No new scheduler.
- Obtain explicit approval before implementing a new secret-dependent hosted recovery path, as required by the security owner. Independent protections may proceed.

## Risks and mitigations

1. A projection may omit canonical fields or truncate bodies. Validate coverage and never represent reconstructed projections as a complete backup.
2. Retaining encrypted bytes without encryption metadata is insufficient. Preserve the complete authenticated snapshot reference.
3. Cleanup or a live writer could race recovery. Preserve originals and fence publication through the canonical owner before replacing state.
4. Retention may increase storage or preserve deleted data. Bound the window and retain existing account-erasure authority.

## Tasks

1. Trace snapshot publication, cleanup, canonical validation, and surviving artifact formats.
2. Implement narrowly scoped integrity and retention protections with synthetic regression tests.
3. Prepare and validate the separately authorized protected recovery path, then assess coverage before any restore.
4. Run focused verification, typechecks, parent review, and required external review/CI for a scoped candidate.
5. Deploy authorized fixes and verify the serving release and recovered runtime progress.

## Decisions

- The operator has authorized a partial rebuild and runtime reactivation if the original starting files cannot be recovered. Use the current accepted Browser Vault copy as a lossy recovery source, never an exact file backup. Validate its authenticated member, source, time, and version binding; preserve recoverable source information with explicit provenance. Reuse canonical initialization and onboarding's existing manual-completion reason instead of inventing prior answers. Staging only records the candidate's existing orphan-cleanup obligation. Publication revalidates the exact workspace and full replica references under existing owner locks, atomically retires any old attempt and replaces the checkpoint. Native stop and subsequent admission remain owned by the existing adapter. External reads, encryption and upload stay outside the transaction. No account, provider identity, billing, or mailbox cursor reset or acknowledgment is authorized or required.

- A complete artifact census can still fail canonical replay because its starting state or write history is incomplete. Extend the existing protected validation result with bounded aggregate history and failed-action diagnostics. Reuse fixed vault-family identities and the metadata contract; never emit paths, content hashes, operation identifiers, or raw errors, and never bypass a conflict or adopt an unproven base.

- Add an optional protected candidate-validation mode before considering restoration. Reuse canonical replay and the Browser Vault source fingerprint in private ephemeral scratch, retain bounded authenticated bytes, and report only aggregate validation. Neither timestamp ordering nor a matching projection source hash certifies accepted history or all files. The assessment and runtime remain read-only.

- Measured protected S3 census throughput showed the twenty-minute deadline could expire before the admitted namespace was exhausted, with authenticated reads still succeeding. Raise only the scan deadline to forty-five minutes and the enclosing protected job to fifty-five minutes; preserve object, byte, concurrency, request-expiry, and per-request limits. A deadline still produces incomplete evidence and never authorizes restoration.

- The previously merged enumeration race fix remains in place; this task adds independent integrity and recoverability boundaries.
- Do not copy private production evidence into this plan or tests.
- Accepted snapshot references use the existing orphan row's JSON field. Recovery lasts at most seven days from archive creation, capped by that archive's explicit content-expiry wake; unknown retention evidence earns no extension. Repeated refs and key-only cleanup cannot refresh this deadline. Account deletion keeps its existing full-namespace cleanup.
- A nullable deadline on the existing orphan row separates archive expiry from cleanup retries. Reusing `cleanup_at` alone failed the current-snapshot deferral case: the sweep moves it while the archive remains canonical. Apply the additive migration before the new Web publisher; old rows receive no retroactive extended retention.

## Product UX

- Outcome: preserve restorable canonical state without claiming that projections are full backups.
- Reaches: established workspaces with corrupt replacement plans; healthy replacements with legitimate deletions; first bootstrap; recovery operators; members deleting accounts.
- Proof: composed runtime rejection before upload, encrypted archive round-trip, real PostgreSQL retention/retirement, and unchanged account-deletion namespace ownership. Recovery remains Hold until the protected assessment and canonical readback succeed.

## Verification

- Focused runtime-state, assistant-runtime, Cloudflare, and Web tests selected from the final changed owners.
- Relevant package/app typechecks and complexity review.
- Real encrypted snapshot round-trip and loss/recovery tests using synthetic files.
- Bounded metadata-only production readback after authorized recovery.
- Passed: assistant-runtime checkpoint bridge, 79 tests; Cloudflare outbound and encrypted workspace bridge, 358 tests; real PostgreSQL runtime ownership, 41 tests; changelog/migration/schema-policy checks, 78 tests; assistant-runtime, hosted-execution, Web, and Cloudflare typechecks. PostgreSQL and Web rechecks passed after separating expiry from retry timing. Complexity guard passed with unchanged hotspot debt.
- Final ReviewGPT round 1 passed on `8c25f10c31962ce9576758b2b103dd9f5abc3bc8`: exact-turn and attachment capture verified, requested and returned model `gpt-6-pro`, observed response wait at least 424 seconds. The response inspected all 15 changed files and the interacting publication, retirement, encryption-reference, and erasure boundaries. No accepted findings remain.
- CI exposed the explicit migration inventory missing the new migration name. Added that test-only expectation; all 10 migration-baseline tests and Web typecheck passed. This isolated proof correction changes no production behavior, schema, or runtime contract beyond the already-reviewed candidate; no new substantive review is required.
- The operator explicitly approved a separately reviewed protected hosted recovery path. The first candidate is a read-only artifact assessment: encrypted expiring member selector, current workspace version checks, signed historical-root lookup, authenticated artifact census, metadata-only output, and bounded network/memory work. No restoration or claim of complete file recovery has been made.
- The assessment derives missing artifact content hashes from provisional GCM bytes solely to reconstruct the original AAD, discards those bytes, then requires canonical authenticated decryption and the exact member-scoped content-addressed object name. Corrupted tags, wrong AAD, wrong members, paths, and roots fail synthetic tests. Uploaded receipts remain candidates, not proof of accepted canonical history.
- Assessment review found a mismatched nested receipt size field. The candidate now reads the canonical `contentRef.byteSize` contract; a typed real-contract fixture covers text, raw, and append references plus missing and wrong-sized payloads. All eight focused tests, Cloudflare typecheck, and complexity checks pass. Recovery is still unperformed.
- Cross-repository integration review identified three assessment caller mismatches: the private job must forward the canonical deployed bucket variable, R2 object paths require literal separators, and signed workspace reads must advertise the existing custom-inference consumer version. The corrected caller is covered by literal-path inventory, query-bound signature verification, the shared capability validator, and the Web owner's selected-custom-route success/rejection tests. No restoration has been performed.
- The assessment implementation and protected workflow are merged. A public-checkout Node version filename mismatch was corrected through the private workflow's reviewed setup contract. The first bounded artifact census reached its execution deadline without a complete result. A follow-up uses the existing S3 signing owner for object reads, leaving REST for bounded metadata listing. It admits at most 50,000 objects over twenty minutes, retains the 512 MiB shared streamed byte budget, reads at most eight artifacts concurrently, drains and clears every wave, and emits incomplete aggregate progress and closed failure diagnostics. Recovery remains Hold pending a complete assessment and validated reconstruction.

- Partial recovery implementation proof: authenticated replica reads and full-reference normalization, canonical initialization with manual onboarding completion, preservation of surviving files through encrypted archive round-trip, immutable upload/readback ordering, signed operator routing, and real PostgreSQL publication/retirement/retry tests pass. Recovery does not acknowledge pending mailbox work. Relevant Web, Cloudflare and hosted-execution typechecks and the complexity guard pass. The protected production dry run and actual runtime/provider progress remain outstanding; the plan stays active.
