# Port public Live integration to Codex 0.158.0

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Outcome

Port the public Live patch to the checksum-pinned Codex 0.158.0 source and align npm, runner-image, route-inventory, and documentation pins. Preserve saved voice preferences and the preceding Eleven v4 migration. No production deployment or paid provider calls.

The patch reuses upstream's policy-aware websocket connector and realtime state owner. It preserves public Live session creation/attachment, client-managed input acknowledgement and notifications, and owned-session closure with final usage collection. The experimental protocol schema is regenerated from the patched Rust definitions.

Codex 0.158 classifies unexpected HTTP statuses as `httpConnectionFailed`. Murph now distinguishes permanent HTTP rejections from transient connection failures, preventing a new retry loop on 400/401/403/404/422. Flex-capacity and invalid-prompt failures remain terminal; no higher-priced service-tier fallback is introduced.

## Removal review

- Removed duplicate public Live route selection and obsolete deployment claims about a separate launch model catalog.
- Upstream still uses the private frameless `/live` contract; the public `/live/sessions` codec remains necessary.
- Upstream `clientManagedHandoffs` suppresses output forwarding, not input admission. It cannot replace the opt-in `clientManagedInputs` request/acknowledgement and normalized notifications.
- Native websocket close does not drain the public provider's terminal usage record. Keep single-owner finalization and no-replay/no-creation-retry protections.
- No additional transport stack, model catalog, runtime state owner, or dependency was added.

## Verification

- Built the complete patched native Codex 0.158.0 CLI with Rust 1.95.0.
- `cargo test --locked -p codex-api realtime -- --test-threads=2`: 87 passed (80 unit, 6 websocket integration, 1 TLS).
- `cargo test --locked -p codex-app-server --test all realtime -- --test-threads=2`: 69 passed, including public Live input ownership and session finalization.
- `cargo test --locked -p codex-core --lib realtime -- --test-threads=2`: 74 passed.
- `cargo test --locked -p codex-app-server-protocol --lib schema_fixtures_tests::experimental_precomputed_exports_match_generated -- --exact`: 1 passed.
- Murph `assistant-codex-native-voice.test.ts` against the rebuilt CLI: all 5 passed, including all public Live cases.
- Murph `codex-openai-egress-conformance.test.ts` against the rebuilt CLI: all 11 passed. Two new binary-string candidates were traced to adjacent linked string literals; no provider route was admitted.
- Installed-package egress and image contracts: 22 passed. Published-binary native voice/input checks: 35 passed, 3 patch-only cases skipped and subsequently covered by the rebuilt CLI above.
- HTTP-failure regression: 5 permanent-status cases failed before the fix; all 19 failure-helper tests passed afterward.
- Cloudflare, assistant-engine, and tools typechecks passed; assistant-engine dependency build passed. Cloudflare typecheck rerun after final inventory changes.
- Exact runner bundled-model filter/capability assertions passed against Codex 0.158.0.
- `pnpm --dir apps/cloudflare verify:codex-upstream-source`: passed final tag, revision, tree, reviewed paths, and patch applicability.
- Patched Rust formatting, candidate privacy scan, and `git diff --check` passed. Docs drift/gardening and complexity checks passed. Existing complexity hotspots are unchanged; no new abstraction or owner is justified.

## Completion and deployment limits

Parent review passed for the final patch, pins, source inventory, permanent-error recovery behavior, saved voice compatibility, and removal opportunities. No additional member changelog is needed for this behavior-preserving CLI port; the preceding Eleven v4 change already has its changelog entry.

The local Docker build exceeded the VM's memory ceiling in an upstream dependency. Native host compilation and the rebuilt-CLI tests provide local compatibility evidence. The Linux final-image sandbox lane, protected build-cache readiness, credentialed public Live/ElevenLabs account readiness, exact-head CI, and final PR review remain rollout gates. No PR push or deployment is part of this local implementation task.
Completed: 2026-09-28
