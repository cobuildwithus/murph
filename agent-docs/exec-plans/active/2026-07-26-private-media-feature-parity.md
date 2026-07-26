Goal (incl. success criteria):
- Restore group-avatar generation/reuse and automated experiment progress-card images on PR 966 without restoring public generated-image objects or health-data-bearing URLs.
- Success means `set_chat_avatar` remains model-visible and sends Linq a short-lived signed Cloudflare Images URL, while progress-card commands create verified `vault_image` media that the existing Linq/Telegram private attachment paths can deliver.
- No user-facing feature may be disabled or silently replaced by text as a privacy workaround.

Constraints/Assumptions:
- Keep signed URLs ephemeral and provider-facing; never persist them in assistant media, outbox state, vault records, logs, diagnostics, docs, or fixtures.
- Preserve the private-by-default `vault_image` representation for ordinary generated and health-derived images.
- Preserve the retired public generated-image upload and URL-encoded experiment-card routes as tombstones.
- Prefer one narrow Cloudflare Images publisher port over a generic media service or new persisted lifecycle owner.
- Preserve unrelated current-main and working-tree changes.

Key decisions:
- Publish private image bytes through a write-fenced Cloudflare adapter that uploads with `requireSignedURLs=true` and signs the selected delivery variant with a bounded expiry.
- Use Cloudflare's account-scoped `IMAGES` binding for hosted uploads so the Worker needs only the signing key and optional variant, not a second API token or account-id variable.
- Use that adapter only for Linq's URL-only group-avatar ingestion boundary.
- Render progress cards deterministically in the CLI with the existing `sharp` dependency, save the PNG as an idempotent vault capture, and return a hash-bound `vault_image` descriptor.
- Extend `murph.attach_response_media` to accept verified vault-image descriptors as well as intentionally public catalog images.
- Keep the browser share-card POST/no-store flow and the public URL tombstones unchanged.

State:
- Implementation, focused verification, and pre-commit owner verification are complete; exact-head PR review gates remain.

Done:
- Read the applicable repository, security, reliability, Cloudflare, and completion guidance.
- Confirmed Cloudflare Images supports `requireSignedURLs=true` uploads and backend HMAC-SHA256 delivery tokens over `pathname?exp=...`.
- Mapped the exact feature regressions and existing private provider attachment path.
- Restored `set_chat_avatar` for generated and reused vault images with provider preflight, hash-bound byte loading, signed private delivery, and stable retry capture identity.
- Restored private automated progress-card PNG generation, vault persistence, exact media attachment, and text/voice fallback behavior.
- Replaced direct Cloudflare Images REST credentials with the native Worker Images binding.
- Added focused contracts, CLI, assistant, runtime, Web adapter, Cloudflare signing/upload, retry, and deploy-config coverage.
- Regenerated the checked CLI skill hash after restoring the progress-card command and proved the generated package surface.
- Added the required Images binding and signing-key fixtures to hosted-local and deploy-preflight parity checks.
- Passed all affected package typechecks and focused tests. The canonical diff lane exercised the full affected workspace; its only remaining failure was an unrelated load-sensitive setup-wizard input race that passed immediately in isolation. The affected owners that followed it were then run serially and passed, including Cloudflare (1,928 tests) and Web (6,579 tests).

Now:
- Create the candidate commit, reconcile with current `main`, and complete the exact-head preliminary specialist pass.

Next:
- Run final canonical verification, close the plan, push the final head, and complete the final ReviewGPT/CI correction loop.

Open questions:
- None.

Working set:
- `packages/{contracts,query,vault-usecases,cli,operator-config,assistant-engine,assistant-runtime,hosted-execution}/**`
- `apps/cloudflare/**`
- `apps/web/src/lib/hosted-{groups,onboarding}/**`
- relevant architecture/security/reliability/verification docs and focused tests

Status: active
Updated: 2026-07-26
