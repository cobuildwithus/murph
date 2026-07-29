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
- Implementation, preliminary remediation, parent review, latest-main reconciliation,
  and final verification are complete. The plan is ready to close before the final
  exact-head ReviewGPT/CI gate.

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
- Passed the feature-parity preliminary specialist pass and resolved both accepted
  findings: scheduled automation cannot invoke group-avatar mutation, and the
  browser native-share error path has direct download-fallback proof.
- Passed the full affected canonical diff lane after preliminary remediation,
  including all package/app typechecks, 2,723 assistant-engine tests, 1,897
  assistant-runtime tests, 1,082 CLI tests, 6,797 Web tests, 1,986 Cloudflare
  Node tests, both Worker tests, package boundaries, lint, dev smoke, and builds.
- Ran `pnpm verify:acceptance`. Every workspace typecheck, documentation guard,
  runtime/package-shape check, artifact guard, and affected suite passed except
  one setup-wizard interaction that timed out only under the heavily parallel
  lane. The complete setup CLI suite then passed serially with coverage (124/124),
  proving that failure is load-sensitive and unrelated to this diff.
- Merged current `main` normally and resolved three overlapping seams by keeping
  both testing-map owner descriptions, retaining the new managed-group activity
  port while continuing to delete the obsolete public generated-image uploader,
  and adopting the new terse group tool contract while retaining private-avatar
  policy in its owning skill and runtime.
- Post-merge canonical verification passed all repository guards, affected
  typechecks, 2,753 assistant-engine tests, 128 assistant CLI tests, 1,897
  assistant-runtime tests, 40 assistantd tests, 1,082 CLI tests, and 124 setup
  CLI tests. The final Cloudflare app step waited ten minutes for the non-FIFO
  shared-host slot and was cancelled before tests started; the full pre-merge
  Cloudflare suite and exact-head remote Cloudflare/hosted CI were already green.

Now:
- Close and archive this execution plan in the final scoped commit.

Next:
- Push the closed-plan head, update the PR contract, and complete the final
  ReviewGPT/CI correction loop. The frontend design-proof check remains blocked
  until the repository-prescribed Cloudflare Images upload credential is
  available for the already-rendered synthetic screenshots.

Open questions:
- None.

Working set:
- `packages/{contracts,query,vault-usecases,cli,operator-config,assistant-engine,assistant-runtime,hosted-execution}/**`
- `apps/cloudflare/**`
- `apps/web/src/lib/hosted-{groups,onboarding}/**`
- relevant architecture/security/reliability/verification docs and focused tests

Status: completed
Updated: 2026-07-27
Completed: 2026-07-27
