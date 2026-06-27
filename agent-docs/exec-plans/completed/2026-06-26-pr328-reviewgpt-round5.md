# PR 328 ReviewGPT Round 5

## Goal

Resolve the accepted ReviewGPT round-5 invariant-violation finding: the round-3 fix typed the Linq chat/message/webhook/phone-number response shapes via the canonical SDK, but three additional Linq endpoints still entered the runtime as `requestLinqJson<unknown>` with hand-walked field reads (`createLinqAttachmentUpload`, `sendLinqVoiceMemo`, `setLinqMessageReaction`). That leaves the same provider-drift hole the PR's round-2 invariant is meant to close on production-critical delivery paths (presigned attachment uploads, voice-memo delivery, and message reactions).

Round-4's finding was rejected: it claimed the OpenAI custom-boundary tests named in source comments did not exist. The tests do exist and exercise the exact JSON shapes called out (`packages/assistant-engine/test/assistant-codex-generate-image-tool.test.ts` covers `data[0].b64_json`, usage breakdown, base64 validation, and provider errors; `apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts` covers `output_text`, `output[].content[].text`, refusal, `content_filter` incomplete, and invalid JSON paths). The visibility gap was a snapshot-config issue (`include_tests=0`); round 5 ran with `--with-tests` so the reviewer could verify, and the OpenAI custom-boundary finding did not reappear.

Success criteria:

- The three additional Linq endpoints route their JSON response through canonical `@linqapp/sdk` response types (`AttachmentCreateResponse`, `ChatSendVoicememoResponse`, `MessageAddReactionResponse`) instead of `unknown`.
- The matching parser inputs (`parseLinqAttachmentUploadResponse`, `parseLinqVoiceMemoResponse`) take the SDK response types instead of `unknown`.
- Existing CLI release validation still passes (SDK pins stay in `devDependencies`, no SDK runtime imports in emitted JS).
- Focused typechecks/tests rerun for the touched owners (and a full `pnpm --filter @murphai/operator-config exec vitest run` to catch any defensive-walk regression).
- Commit, push, and fire ReviewGPT round 6.

## Constraints/Assumptions

- Keep all runtime transport, credential, retry, and presigned-upload boundaries unchanged.
- Keep defensive runtime parsing (`readRecord`, `readStringField`, presigned-URL host/protocol validation, required-headers normalization); type-tightening only.
- Do not add the Linq SDK to runtime `dependencies`; type-only imports continue to satisfy the contract.

## Work Plan

1. Import `AttachmentCreateResponse`, `ChatSendVoicememoResponse`, and `MessageAddReactionResponse` from `@linqapp/sdk`.
2. Change `requestLinqJson<unknown>` to the matching SDK response type at each of the three call sites in `packages/operator-config/src/linq-runtime.ts`.
3. Tighten `parseLinqAttachmentUploadResponse` and `parseLinqVoiceMemoResponse` to take the SDK response types as input instead of `unknown`.
4. Rerun focused typechecks, tests, build, dist scan, release-target, and dependency gates.
5. Commit, push, and fire ReviewGPT round 6 on the pushed PR head.

## Verification

- PASS `pnpm --filter @murphai/operator-config typecheck`
- PASS `pnpm --filter @murphai/operator-config build`
- PASS `pnpm --filter @murphai/messaging-ingress build`
- PASS `pnpm --filter @murphai/assistant-engine build`
- PASS emitted JS scan: no `openai` or `@linqapp/sdk` runtime imports in `packages/assistant-engine/dist`, `packages/operator-config/dist`, or `packages/messaging-ingress/dist`
- PASS `node scripts/verify-release-target.mjs --json`
- PASS `pnpm --filter @murphai/operator-config exec vitest run --config vitest.config.ts --no-coverage` (full 26-file/186-test suite, includes attachment-upload, voice-memo, and reaction paths)
- PASS `pnpm deps:guard`

Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
