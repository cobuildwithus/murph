# Automatic meal daily closeout and source-photo cleanup

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- After the first successful iPhone automatic meal-photo import, install one
  private managed automation that runs at 9:00pm in the vault timezone.
- On each run, enrich the day's automatic photo meals in place, send one
  concise calorie/macro closeout when applicable, and remove retained meal
  image bytes after the photo has been inspected and any supported structure
  has been saved.

## Success criteria

- The first canonical automatic meal import installs the closeout automation;
  retries and later captures do not create duplicates or reactivate a member-
  paused/archived record.
- The automation uses the canonical managed-automation scheduler and the vault
  timezone's 9:00pm civil time, and is not seeded into vaults that have never
  used automatic meal capture.
- The scheduled instructions inspect real automatic-capture attachments,
  update the existing meal records with honest nutrition provenance, avoid
  duplicate counting, summarize only supported totals, and sweep unresolved
  recent captures so after-9pm photos are not retained indefinitely.
- A canonical, idempotent meal command removes automatic-capture photo
  attachments from the current meal revision and replaces the raw image bytes
  with a small privacy tombstone plus matching manifest proof in one audited
  write. It must fail closed for non-automatic meals or changed bytes.
- Staged Cloudflare meal-photo objects retain the existing post-checkpoint
  deletion behavior and 31-day lifecycle fallback.
- Focused owner tests, package typechecks, diff-aware verification, and the full
  acceptance suite pass; the exact pushed PR head completes ReviewGPT and CI.

## Scope

- In scope: assistant-engine managed automation seed/reconciliation, hosted
  automatic-meal import installation, canonical automatic-meal photo retention
  mutation and CLI surface, scheduled skill instructions, focused tests, and
  current architecture/security/reliability/verification documentation.
- Out of scope: iOS capture/classification changes, upload API or R2 lifecycle
  changes, a second scheduler, an independent daily-summary data store, generic
  attachment retention, historical photo scanning, or production deployment.

## Constraints

- Technical constraints: keep canonical meal truth in the encrypted vault;
  reuse the ordinary automation owner, route validation, scheduler, prompt
  stack, and outbox; preserve mailbox replay safety and post-checkpoint staging
  cleanup; make photo-byte removal auditable and crash-safe under the canonical
  write batch.
- Product/process constraints: the user explicitly approved the recurring 9pm
  message. Keep health estimates uncertainty-aware, avoid unsolicited numbers
  outside this opt-in automatic closeout, respect user-paused automation state,
  preserve unrelated work, and complete the high-risk PR/ReviewGPT route.

## Risks and mitigations

1. Risk: A mailbox retry creates duplicate automations or meals.
   Mitigation: use stable canonical ids/external refs and reconcile one managed
   automation idempotently on both new-import and existing-meal replay paths.
2. Risk: Photo deletion happens before useful meal structure is saved or leaves
   the vault invalid.
   Mitigation: expose an automatic-meal-only finalization command, call it only
   after the scheduled inspection/update/readback, and atomically append the
   attachment-free meal revision while replacing the verified image bytes and
   manifest with tombstone proof.
3. Risk: A 9pm-only current-day scan misses photos captured after the closeout.
   Mitigation: summarize the current local day but also sweep a bounded recent
   window for older unresolved automatic-capture photos.
4. Risk: No deliverable private route exists when the first import lands.
   Mitigation: fail the mailbox item retryably until the existing managed-
   automation route owner can persist the closeout through the restored hosted
   operator home and hosted route-validation profile; leave the staged object
   and canonical meal replay-safe in the meantime.
5. Risk: Deploy skew leaves an importer calling an unavailable managed helper.
   Mitigation: the runtime and assistant-engine packages ship in the same hosted
   runner bundle; preserve the already-compatible web/Cloudflare producer and
   staged-object contracts.

## Tasks

1. Add the opt-in-only managed 9pm closeout seed and idempotent install helper.
2. Install it from both successful and replayed automatic meal imports, with a
   retryable failure if it cannot be durably found.
3. Add the audited canonical photo-retention mutation and CLI command.
4. Update the automatic-meal skill and managed instructions for enrichment,
   bounded cleanup, dedupe, supported totals, and user-facing closeout copy.
5. Add focused regression/contract tests and update durable docs.
6. Run required coverage-write, focused checks, package typechecks,
   `pnpm test:diff`, and `pnpm verify:acceptance`.
7. Finish the task commit, push a PR, start ReviewGPT with CI on the exact head,
   remediate any findings, and land the approved change.

## Decisions

- Use `dailyLocal` at `21:00` so DST and the vault timezone remain owned by the
  canonical scheduler.
- Keep the meal closeout seed in default managed reconciliation with
  create-when-missing disabled; the first capture temporarily opts that one seed
  into creation, while later global passes can reconcile an existing record.
- Replace retained image content with a small non-image privacy tombstone rather
  than hard-delete the historical path, because append-only prior meal revisions
  and raw-manifest validation retain immutable provenance references. The latest
  meal revision drops the attachment, so assistant reads cannot treat the
  tombstone as meal evidence.

## Verification

- Commands to run: focused core/vault-usecases/CLI/assistant-engine/runtime
  Vitest files; relevant package typechecks; `pnpm test:diff <changed paths>`;
  `pnpm verify:acceptance`; required CI and ReviewGPT on the pushed PR head.
- Expected outcomes: one automation, one canonical meal per capture, cleanup
  only after checkpoint for staged bytes, automatic-only retained-photo
  tombstoning, valid vault after cleanup, correct local-time schedule, supported
  macro summary instructions, and no regressions in package boundaries or docs.
Completed: 2026-07-22
