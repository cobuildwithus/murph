Goal (incl. success criteria):
- Restore hosted experiment progress-card generation when the runner uses its packaged Health Commons assets.
- Success means the hosted runner package carries the smallest generated biomarker desired-direction projection needed by progress cards, an unavailable auxiliary projection degrades to an explicit warning plus neutral sentiment instead of suppressing the card, and focused tests prove both the packaged success path and missing-asset recovery.

Constraints/Assumptions:
- Preserve progress-card generation as a product-critical user flow; biomarker sentiment metadata is auxiliary and must not block the card.
- Keep the full generated Health Commons web tree out of the hosted runner bundle.
- Reuse the existing Health Commons generator/runtime boundary and the query builder's empty-direction behavior; add no state owner, queue, dependency, or compatibility service.
- Keep malformed packaged data fail-closed. Limit recovery to the expected missing-file condition and surface a warning.
- The older active runner-bundle dependency-prune plan has no open PR and describes work already present on current main; there is no active coordination ledger, so current main is the ownership source for this fix.

Key decisions:
- Generate a compact biomarker desired-direction artifact owned by `packages/health-commons`.
- Add that compact artifact to the runner-specific Health Commons package allowlist and deploy validation instead of restoring `generated/web/**`.
- Make progress-card composition recover only from a missing compact artifact by passing an empty direction snapshot and appending a warning.
- Make the exact missing-direction caveat part of the deterministic private card artifact and its accessible description. Do not rely on prompt freshness to relay it, and keep unrelated renderer diagnostics private.
- Preserve image accessibility at the existing channel boundary: providers with no native alt field append each media description once to the same outgoing message or photo caption.
- Add direct packed-package coverage that resolves a known desired direction from the extracted runner artifact and direct use-case coverage for missing-asset neutral recovery.

State:
- ReviewGPT round 3 found that SVG accessibility metadata and private-image alt text were discarded by PNG rasterization and the Linq/Telegram provider mappings. The accepted correction keeps the card as disclosure owner and makes the existing media description effective at those delivery boundaries.

Done:
- Reproduced the incompatible current contracts: hosted packaging omits and rejects `generated/web/**`, while progress-card composition reads `generated/web/browse/biomarkers.json` through the pinned package root.
- Confirmed the query builder already renders with neutral sentiment when no direction snapshot is provided.
- Confirmed the focused runtime and package contract tests pass while proving the incompatible behavior.
- Created an isolated task worktree from current `origin/main`.
- Added the compact generated biomarker desired-direction projection, package-root runtime loader, hosted-runner allowlist entry, and deploy-time schema/hash validation.
- Added missing-file recovery that preserves the progress card with neutral sentiment and an explicit warning while malformed artifacts still fail closed.
- Proved the packaged success path by extracting the runner tarball and resolving a known direction from the compact artifact.
- Passed the focused Health Commons runtime and verification suites, the full affected vault-usecase test file, the full affected Cloudflare packaging and deploy-validation test files, and all three touched-owner typechecks.
- Preliminary specialist ReviewGPT and final ReviewGPT round 1 independently found that the missing-direction warning stopped at command JSON instead of being guaranteed member-facing. The specialist pass also requested direct catalog-hash mismatch coverage.
- Added the exact branch-specific same-response disclosure to manual active-experiment context, day-four and final lifecycle moments, weekly health digest, and experiment-onboarding guidance. Added owner tests for every route and did not expose other renderer warnings.
- Applied and verified the specialist's narrow catalog-hash mismatch regression test.
- Passed four focused assistant owner suites (97 tests), assistant-engine typecheck, and the affected Cloudflare deploy-artifact suite (42 tests).
- Captured complete first provider-visible requests through the pinned real Codex App Server with a synthetic scheduled weekly direct/group turn and active experiment, `gpt-5.6-terra`, low reasoning, code mode, and `gpt-tokenizer` 3.4.0 `o200k_harmony`: individual 131,789 bytes / 28,470 tokens at base and 132,309 / 28,566 at head; group 118,331 / 25,541 at base and 118,591 / 25,589 at head.
- Final ReviewGPT round 2 returned `RETROSPECTIVE_REQUIRED`: an existing clean schema-v5 context snapshot can retain the pre-remediation manual prompt across deployment and restarts, reproducing the same member-facing disclosure gap.
- Retrospective: the original requirement is one available progress card with an understandable neutral fallback. First review had 232 source additions / 23 deletions; the prompt correction grew that to 237 / 23, so churn is not the concern. The repeated mechanism is conditional delivery ownership in persisted prompt copies. Continuing with cache invalidation would still leave the first post-deploy request on safety-stale context, while adding runtime reconciliation would violate the simplicity constraint. The chosen correction deletes the five prompt relay lines and makes one typed card state drive visible and accessible caveat rendering. The card artifact is then the single deterministic owner, including for pre-existing snapshots and automations.
- Added `moverSentimentContext: direction_unavailable` to the private card contract, set it only on the missing direction-asset branch, and render the caveat in the card footer, SVG accessibility label, and response-media alt text. The packaged healthy path keeps the field null and the existing branded footer.
- Passed the focused contracts, query, vault-usecases, and CLI typechecks; the contract guard (1 test), missing/packaged vault path (6 tests), and renderer/media proof (2 tests) all pass. A 1200×780 fallback PNG was rendered and visually inspected: the note is readable, non-overlapping, and the normal card hierarchy remains intact; the temporary proof artifact was removed.
- Exact-head CI exposed a stale generated CLI skill fingerprint after the response-contract change. Regenerated only `vault-cli-skill-hash.generated.ts`; the exact package-shape verifier and fresh CI then passed.
- Final ReviewGPT round 3 found one valid accessibility gap: neither production image adapter forwarded the media description after SVG-to-PNG conversion.
- Added one shared channel-runtime rule that appends nonempty image descriptions once to the existing Linq message or Telegram caption, while preserving the vault-file no-caption rule. Official provider contracts expose captions/messages but no native image-alt field.
- Passed the assistant channel and hosted callback suites (257 tests), the renderer suite (2 tests), assistant-engine/assistant-runtime/CLI typechecks, prepared-runtime build, regenerated-schema check, and exact CLI package-shape verifier.

Now:
- Commit and push the channel-boundary accessibility correction, update the PR evidence, then start the exact-head final remediation review with CI.

Next:
- Require clean exact-head ReviewGPT and CI, perform the parent final review, then archive this plan.

Open questions (UNCONFIRMED if needed):
- None blocking implementation.

Working set (files/ids/commands):
- `packages/health-commons/src/build.ts`
- `packages/health-commons/src/runtime.ts`
- `packages/health-commons/test/runtime.test.ts`
- `packages/contracts/src/experiment-progress-card.ts`
- `packages/query/src/experiment-progress-card.ts`
- `packages/vault-usecases/src/usecases/experiment-journal-vault.ts`
- `packages/vault-usecases/test/**`
- `packages/cli/src/commands/experiment-progress-card-image.ts`
- `packages/cli/src/vault-cli-skill-hash.generated.ts`
- `packages/cli/test/experiment-progress-card-renderer.test.ts`
- `packages/assistant-engine/src/assistant/channels/runtime.ts`
- `packages/assistant-engine/test/assistant-channels-runtime.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `apps/cloudflare/scripts/runner-bundle/workspace-artifacts.ts`
- `apps/cloudflare/scripts/deploy-artifacts.ts`
- `apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts`
- `apps/cloudflare/test/deploy-artifacts.test.ts`
- `agent-docs/product-specs/health-commons.md`
- Focused package and Cloudflare Vitest commands selected from `agent-docs/operations/verification-and-runtime.md`
