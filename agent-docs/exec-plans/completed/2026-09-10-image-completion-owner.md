# Colocate trusted image completion decoding

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Colocate the strict hosted image completion decoder with its existing protocol owner while preserving all accepted and rejected events and reply behavior.

## Success criteria

- Reply orchestration imports the decoder and prompt building imports its result type from `assistant/hosted-image-completion.ts`.
- Focused trust-boundary and existing reply/authority tests, package typecheck, complexity review, and source-equivalence review pass. Optional live proof is reported separately without claiming an unavailable run passed.
- The original session owns candidate review, final ReviewGPT, and Ready admission after this lane opens its draft PR.

## Scope

- In scope: strict event decoder, its result type and private checks, focused tests, production-derived live proof, and task evidence.
- Out of scope: reply lifecycle extraction, parser acceptance changes, image generation, delivery, scheduling, or effect policy changes.

## Constraints

- Technical constraints: reuse the existing schema constant and owner; no new state, dependencies, protocol shapes, or reverse dependency on reply orchestration.
- Product/process constraints: preserve legacy envelopes, exact provenance, invalid-versus-unrelated distinction, bounded untrusted diagnostic handling, and current provider-facing instructions.

## Risks and mitigations

1. The existing looser parser differs from strict reply decoding. Move the strict decoder without substituting the other parser or changing legacy acceptance.
2. A malformed trusted event must remain `invalid`, while unrelated events remain `null`. Direct tests cover both and existing integration tests verify restricted effects.
3. Renderer truncation and incoming diagnostic rejection have different bounds semantics. Preserve both independently.
4. No persisted shape or deploy protocol changes; old and new bundles consume the same events and ordinary rollback remains compatible.

## Tasks

1. Confirm the reviewed source cluster is unchanged at the current branch base.
2. Move the decoder/type into the existing owner, remove obsolete copies, and update two reply consumers.
3. Add focused event-level provenance/envelope regressions and route the existing live journey through production decoding.
4. Run focused tests, typecheck, complexity review, and the relevant live journey with bounded worker counts.
5. Inspect the complete diff, record evidence, archive this plan, and commit/push/open a draft PR for parent review.

## Decisions

- Compared reviewed `34022b5e` with branch base `b2a55981`: the three affected source files are unchanged.
- Decoder inputs remain source provenance plus transcript/text; all authority decisions, group cardinality, receipt/cursor state, and prompt construction stay with their existing owners.
- Internal refactor: no changelog item or provider-input token measurement is needed because behavior and assembled content are preserved.
- The exact-key validator already proves origin fields are either absent or a complete validated pair. Removing two redundant projection checks lowers decoder complexity from 22 to 20 without a helper split; an eight-case origin matrix protects this proof.
- Source/test candidate review confirmed the narrow extraction and origin derivation. The parent then confirmed the live-skill trigger does not apply to this pure extraction: model-visible values, effect restrictions, and product behavior are unchanged. The useful production-derived live-fixture improvement remains; attempted live proof is supplemental and its outcome is reported separately.

## Verification

- Passed: `MURPH_VITEST_MAX_WORKERS=2 pnpm --filter @murphai/assistant-engine test test/assistant-hosted-image-completion.test.ts test/assistant-hosted-image-completion-authority.test.ts test/assistant-automation-reply-event-path.test.ts` — 165 tests across three files.
- Passed: `MURPH_TSC_PACKAGE_CHECKERS=2 pnpm --filter @murphai/assistant-engine typecheck`.
- Passed: `pnpm complexity:diff --base b2a559812972d70644cffb2bf43923fc9211047d` — total debt decreases by two; relocated decoder is 20. Eleven unchanged reply/prompt lifecycle hotspots remain with their current owners.
- Passed: `git diff --check` and full source/test diff review; no local identifiers or private data added.
- Optional live proof unavailable (Hold): `MURPH_VITEST_MAX_WORKERS=2 pnpm test:assistant:live -- --test "resumes a gpt-image-2.5-flare capture and uses its exact ref only after a later group-avatar request"` with local subscription auth and the default `gpt-5.6-terra` model. Five attempts stopped before any provider action: two authorization errors, one generic provider error, and two app-server startup timeouts. The final already-started attempt ended with `ASSISTANT_CODEX_APP_SERVER_TIMEOUT`, zero provider requests, and zero token usage. No live pass is claimed; retries stopped after the applicability review. Auth contents were not read or copied.
- Expected outcomes: exact event acceptance and diagnostics remain unchanged, trusted media remains exact, unrelated mutations stay unavailable, and later explicit authorization still works.
Completed: 2026-09-10
