Goal (incl. success criteria):
- Simplify v2 hosted workspace snapshot restore by deleting restore-side tar listing and post-extract tree recounting.
- Keep integrity checks that are still part of the storage contract: encrypted object size/hash, AES-GCM authentication, plaintext compressed archive hash, temp-root extraction, and atomic root replacement.
- Success means restore performs one decompression/extraction pass, creation validates only the planned durable-root entries before calling tar, and the changed Cloudflare path passes scoped verification.

Constraints/Assumptions:
- V2 workspace snapshots are first-party authenticated artifacts produced by the hosted snapshot writer.
- A validly encrypted malicious tar archive implies a larger control-plane or key compromise, so restore does not need a second archive-safety policy layer.
- Preserve legacy restore compatibility outside this local v2 archive helper; do not add a custom tar extractor, tar-header parser, env flag, sampling mode, or optional postflight path.
- Avoid unrelated dirty work in the main checkout; this task lives on a separate worktree branch.

Key decisions:
- Delete restore-side `tar -tvf` validation and restored-tree file/byte recounting.
- Keep snapshot creation validation limited to the planned durable-root entries: unsafe paths, symlinks, hardlinks, special files, environment files, and selected archive-entry aliases are rejected before tar runs.
- Compute encrypted object SHA during the decrypt read instead of reading the encrypted file once before decrypt.
- Do not add a writer-side tar parser or stream validator; trust the platform snapshot writer plus encrypted digests instead of preserving duplicate archive machinery.
- Require planned archive entries for local v2 snapshot creation instead of keeping an unused whole-root tar fallback.

State:
- Completed.

Done:
- Confirmed the current implementation decrypts to a compressed archive, lists/decompresses it for restore-side validation, extracts it, then walks the restored tree.
- Removed restore-side tar listing and restored-tree recounting.
- Removed the restore-side malicious tar tests that only exercised the deleted safety parser.
- Kept focused coverage for ordinary planned paths, creation-side symlink/path rejection, and digest mismatch failures before durable-root replacement.
- Documented the accepted trust model: restore trusts valid encrypted first-party v2 snapshots after size, digest, AES-GCM, and plaintext archive hash checks.
- Earlier security, coverage, and deep-review audit rounds found no remaining production-risk findings after the scoped cleanup.
- ReviewGPT round 3 found one accepted simplification: delete the unused whole-root archive mode. It also flagged the known tar TOCTOU risk; rejected because fixing it requires reintroducing restore/archive parser machinery or staging copies, and this PR intentionally trusts valid encrypted first-party snapshot writer output.

Now:
- Rebased draft PR is ready for final verification and push.

Next:
- Push the rebased head and check PR CI/review state.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/cloudflare/src/workspace-snapshot-local.ts
- apps/cloudflare/test/workspace-snapshot-local.test.ts
- apps/cloudflare/test/runner-platform.test.ts
- apps/cloudflare/README.md
- pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/workspace-snapshot-local.test.ts
- pnpm test:diff apps/cloudflare/src/workspace-snapshot-local.ts apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/README.md
- pnpm typecheck
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
