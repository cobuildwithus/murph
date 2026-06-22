Goal (incl. success criteria):
- Stack a narrow follow-up on PR #246 that restores hosted v2 workspace snapshots from the presigned R2 response stream instead of first writing `workspace.snapshot.enc`.
- Keep PR #246's useful common-path behavior: decrypt/authenticate into one bounded plaintext archive buffer, validate the encrypted SHA, validate the plaintext archive SHA, and extract only after `decipher.final()` authenticates.
- Success means the normal hosted restore path overlaps object-body read with AES-GCM decrypt/hash work, uses no temporary ciphertext file, leaves durable-root replacement behind the existing auth/hash/tar-safety gates, and does not add a new scheduler, storage owner, snapshot schema, or compatibility layer.

Constraints/Assumptions:
- Clean, simple, long-term maintainable architecture is the priority. Performance work is only worth doing if it removes redundant I/O without widening ownership or control flow.
- PR #246 is the right base. It already removes the normal-path plaintext scratch archive; this follow-up should not duplicate or replace that work.
- `apps/cloudflare` remains a thin execution adapter around encrypted object plumbing. `apps/web`, Temporal, mailbox ordering, checkpoint refs, and R2 object metadata stay unchanged.
- Preserve fail-closed restore semantics: expected byte count, encrypted object SHA, AES-GCM auth, plaintext archive SHA, safe tar-entry validation, and durable-root replacement ordering.
- Preserve existing large-snapshot compatibility, but the hosted R2 restore path should not download ciphertext to disk first. If a large fallback is needed, stream decrypted archive bytes to the existing plaintext fallback path and still extract only after auth/digest validation.
- Do not add dependencies, snapshot ref fields, env flags, R2 bucket conventions, or generalized stream frameworks unless a failing test proves they are necessary.

Key decisions:
- Add one owning primitive in `apps/cloudflare/src/workspace-snapshot-local.ts`, `restoreEncryptedWorkspaceSnapshotFromEncryptedStream`.
- Keep the current file-path restore function as a small wrapper/compatibility entrypoint for tests and local callers that already have an encrypted file. The hosted R2 path should call the stream primitive directly.
- Use a straightforward async chunk loop instead of a Transform pipeline stack. The loop keeps the final 16 AES-GCM bytes as the auth-tag tail, hashes every encrypted chunk, decrypts only ciphertext bytes, writes decrypted output to the existing fixed-size collector, and calls `decipher.final()` before any archive listing or extraction.
- Reuse PR #246's fixed-size plaintext archive collector for the common path. Size it from `ref.archive.encryptedByteSize - HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES`; for current snapshot sizes this is the one preallocated compressed archive buffer.
- Keep timing/diagnostic churn minimal. `objectFetchMs` now measures response open/validation, while `archive_restore` owns body consumption, decrypt/hash, auth, tar safety, and extraction.

State:
- Implementation and verification complete on branch `codex/stream-r2-snapshot-restore`, stacked on PR #246.

Done:
- Rechecked PR #246 on 2026-06-21. It is still open and still writes the hosted R2 response body to `workspace.snapshot.enc` before calling `restoreEncryptedWorkspaceSnapshot`.
- Confirmed PR #246 partially overlaps the goal by decrypting normal-size archives into memory and extracting from the authenticated buffer, but it does not overlap R2 fetch with decrypt and does not remove the ciphertext temp file.
- Rechecked hosted runtime ownership docs: Cloudflare owns encrypted object plumbing and restore; web/Temporal/checkpoint ownership should not change for this optimization.

Now:
- Commit, push, and open a stacked PR against PR #246's branch.

Next:
- Monitor PR CI and review feedback.

Verification:
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir apps/cloudflare test:node -- apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/test/runner-platform.test.ts` passed after the audit fix: 91 files, 1520 tests.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-platform/workspace-snapshot-port.ts apps/cloudflare/src/runtime-platform/diagnostics.ts apps/cloudflare/src/workspace-snapshot-local.ts apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/test/runner-platform.test.ts` passed, including `apps/cloudflare verify`.
- `git diff --check` passed.

Audit outcomes:
- `security-privacy-review`: no critical/high/medium findings.
- `coverage-write`: added/confirmed test-only proof that `scratchPrepareMs` is absent after removing the hosted ciphertext scratch step.
- `deep-review`: accepted finding that an already-open R2 response body could be left open if data-key unwrap failed before `archive_restore`; fixed by returning a cancellable body handle and canceling it on unwrap failure and archive-restore exit, with a focused regression test.
- Run the Cloudflare-focused verification lane first, then the repo-required verification/audit lane for a high-risk hosted-runtime change.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- PR #246 `[codex] Restore workspace snapshots from memory buffer`
- `apps/cloudflare/src/runtime-platform/workspace-snapshot-port.ts`
- `apps/cloudflare/src/workspace-snapshot-local.ts`
- `apps/cloudflare/test/workspace-snapshot-local.test.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/cloudflare/README.md` only if the durable storage/restore wording would otherwise become stale
- `agent-docs/references/hosted-runtime-protocol.md` only if the restore contract wording would otherwise become stale
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
