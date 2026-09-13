# Simplify Telegram attachment specification builders

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal and scope

Reduce duplicated attachment specification construction in `packages/inboxd/src/connectors/telegram/normalize.ts` while preserving native and hosted Telegram capture behavior. Measured base complexity: file debt 51, maximum 47. The verified candidate reduces debt to 0 and maximum to 16.

The user requires GPT-6 Pro through ReviewGPT to author the primary source and focused test changes. Local preparation authored this plan and an ignored implementation brief only. The parent sent and recovered the patch, verified captured GPT-6 Pro provenance and authorized this checkout owner to apply the exact patch and complete focused verification and a draft PR. The parent retains candidate review, Ready, final ReviewGPT and completion gates.

## Existing owners and intended shape

Messaging Ingress owns upstream Telegram types, parsing and minimized metadata. Inboxd owns attachment specifications, sequential hydration and the normalized capture. Keep those boundaries intact. Share the repeated fixed attachment defaults and filename/MIME construction through small private same-file code; retain explicit native/hosted photo and document differences. Do not introduce a configurable registry, new public API, dependency or state owner.

## Invariants and risks

- Native attachment order remains photo, document, audio, voice, video, video note, animation, sticker; hosted input order and duplicates remain unchanged.
- Native photos retain forced JPEG/generated-name behavior; hosted photos honor normalized supplied metadata. Largest-photo selection and stable ties remain unchanged.
- Native document inference uses raw MIME/name; hosted inference uses normalized values. Preserve inference precedence and all fallback MIME, prefix and suffix values.
- Filename fallback uses nullish original unique-id selection. Hosted external identity uses the separately normalized file-base identity; do not accidentally combine these facts.
- Preserve sequential driver calls, exact file/path/signal forwarding, the existing safe-integer 20 MiB guards, metadata-only failures, abort propagation and byte-size precedence.
- Never persist a credential-bearing URL, widen raw metadata, add provider calls, or change capture/thread/actor authority.

## Steps

1. Inspect attachment builders, types, composed tests and relevant owner docs; write the implementation brief.
2. Parent sends the exact source/context to GPT-6 Pro and receives `complexity3-telegram-attachments.patch` after explicit model confirmation and completion marker.
3. Parent audits patch paths, privacy, behavior, maintainability and evidence before applying it; no local replacement primary implementation.
4. Run the focused Telegram and connector suites, Inboxd typecheck and complexity guard with bounded workers. Review every remaining hotspot.
5. Close the plan with the verified implementation, scoped commit and complete draft PR; parent owns Ready, final ReviewGPT and exact-head required/routed CI.

## Verification plan

- `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/inboxd test test/telegram-attachment-normalization.test.ts test/telegram-connector.test.ts test/telegram-connector-edge.test.ts test/inboxd-connectors-coverage.test.ts`
- `MURPH_TSC_PACKAGE_CHECKERS=1 pnpm --dir packages/inboxd typecheck`
- `pnpm complexity:diff --base 486a6595e51bff2a6cfa64beb4ee1a953854a8b6`
- `git diff --check`, complete source/test review and privacy inspection.

Existing tests cover ordinary native/hosted attachment kinds, downloaded photo selection, minimal raw metadata, abort propagation and oversized fallback. Pro should add focused public-boundary proof for defaults, explicit overrides, ordering and the distinct normalization/identity traps.

## Preparation evidence and handoff

Read workflow routing, architecture/invariant guidance, Inboxd README, security/reliability boundaries, verification/completion owners, work-with-pro and Frog skills. Initial Frog inventory required dependencies; the parent-authorized default-store `pnpm install --frozen-lockfile` then passed and `scripts/frog list` returned 161 entries. No workaround or new Frog artifact was needed. Local preparation made no source/test implementation changes.

No changelog is intended: this is internal behavior-preserving normalization maintenance. No provider-input, UI, schema or deployment contract changes are in scope.


## Implementation provenance and results

- Applied the exact Pro attachment `complexity3-telegram-attachments.patch`, SHA-256 `17d017c1b9a15e411f2897c26592b4337a799dd9b88cd1dce05488304d86a293`, unchanged. The parent verified captured model `gpt-6-pro`, response identity and exact-turn hashes before handing off the patch.
- A fixed private defaults map and one private builder replace repeated native/hosted construction. Native photo handling, raw document inference, hosted normalized inference, original filename IDs, hydration, metadata and call ordering remain unchanged. Source change is +55/-120 lines.
- Inspected the full source patch and all 30 new public-boundary cases. Focused tests passed: 74 tests across four files, including all 30 new cases. Tests prove default/override fields, native and hosted attachment order, duplicates, inference priority, raw-versus-normalized values, ID quirks, size behavior and serial hydration with exact signal forwarding.
- Inboxd typecheck passed with one checker. Complexity guard passed against base `486a6595e51bff2a6cfa64beb4ee1a953854a8b6`: debt 51 to 0, maximum 47 to 16; no remaining hotspot above 20.
- `git diff --check` and source/test/plan privacy inspection passed. No local primary redesign or post-Pro source/test edit was needed.
- Implementation and focused proof are complete. Parent candidate review, final ReviewGPT and exact-head required/routed CI remain the PR completion gates.
Completed: 2026-09-12
