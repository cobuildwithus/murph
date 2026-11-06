# Game recap links

Status: completed
Created: 2026-10-31

## Outcome and ownership

A settled game's single group message adds an exact recap link after its sealed
chat line. Web composes the delivery text on both save and replay; the existing
runtime records, delivers and transcribes it verbatim. The sealed story, model
prompt, lore and originality inputs retain the bare line. No new state or reads.
The current response reader has a 160-character limit, so widen that reader first.

## Product UX

The group receives a clear recap announcement and public link. Installed-app
visitors can open the recap; other visitors have the invite page's App Store
fallback. The page and preview disclose no game facts, even for an unknown valid
ID. Malformed IDs return a plain 404. Reuse the invite layout and add one inert
real-component example at /screenshots/groups#game-recap.

## Scope and constraints

Backend and generic Web handoff only. No iOS implementation, production access,
messages, dispatches, pushes, PRs or commits. No tables, services or dependencies.
No public changelog yet: native destination is outside this backend-only task.

## Proof and deployment

Hydrate install/build/Prisma first. Test server save/replay equality, bare lore,
response parsing, exact delivery/transcript, page markup and malformed IDs.
Replay phone/desktop public routes with synthetic IDs. Run root typecheck,
Web lint and complexity:diff. Run one focused local assistant journey.
Deploy the widened runtime response reader before Web; old readers reject long
messages. Persisted recap and outbox formats are unchanged. A changed public
origin is a configuration migration; keep it stable across retries.

## Verification

All final checks exited 0:

| Check | Evidence |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | Dependencies hydrated |
| `pnpm build` | Workspace package build |
| `pnpm --dir apps/web prisma:generate` | Prisma client generated |
| Web Vitest: game-chat-tool, game-recap-link, game-invite-link, game-recap | 47 passed |
| Web Vitest: game-recap-link, share-preview-metadata | rerun after the route move (see PR) |
| Web Vitest: game-chat-delivery, game-chat-lifecycle | 60 passed |
| Root Vitest: assistant-game-tools, assistant-notification-turn-runtime, game-tools-compatibility | 153 passed; one unrelated opt-in skew test skipped |
| Focused notification exact-text regression | Passed, including whitespace and before-delivery callback |
| `pnpm typecheck` | Full workspace, final code |
| `pnpm --dir apps/web lint` | No errors; existing warnings |
| `pnpm complexity:diff` | Passed; existing notification hotspots unchanged (63, 29, 22) |
| Playwright `e2e/game-recap-link.spec.ts` | Phone 390px, desktop 1280px, HTTP 404, generic metadata, real inert study |
| `pnpm test:assistant:live -- --test 'game recap notification writes one sealed story and queues its saved chat line exactly; weekends off=false'` | gpt-6.1-sol, local subscription; one save, one queued exact message, bare lore; Ready |
| `git diff --check` | Passed |

Web Vitest commands use `pnpm exec vitest run --config apps/web/vitest.config.ts`
from the repository root and the listed files under `apps/web/test`. Root runtime
proof uses `pnpm exec vitest run` and the listed package test paths.
Browser proof uses the existing Playwright smoke configuration, port 3237 and
Next suffix game-recap-link. No database or production setup was needed.
Phone and desktop images were inspected and remain ignored under
`.artifacts/review-gpt/game-recap-link/`. The reviewable representation is
`/screenshots/groups#game-recap`.

## Resolved findings and final review

- Next refuses competing dynamic folders under `/r`, which already serves signup
  referrals. Parent review moved the handoff to its own `/recap/[gameId]` route so
  the referral landing and claim flow stay untouched; no dispatch by token shape.
- The first browser design locator used the wrong catalog location (exit 1).
  Corrected it to the existing groups screenshot category; final browser pass 0.
- Exact-text regression reproduced leading-whitespace trimming (exit 1).
  The runtime now validates presence while preserving the accepted bytes in
  delivery, delivery-time callback and transcript; final proof passes.
- No new queries, provider calls, state, dependencies, tables or services.
  The runtime callback and game/audience authority remain intact. Bare lore and
  original chat-line limits remain intact. The single helper composes both save
  and replay from the sealed recap and trusted game.
- Public page and metadata tests reject imports of Prisma, game reads and referral
  services on the recap page. Unknown valid IDs render identical generic copy.
- No new complexity hotspots. The three reported notification hotspots predate
  this change and retain their exact complexity; splitting them adds no value here.
- No production access, delivery, deployment, dispatch, push, PR, commit or external
  review was performed. Native-app handling remains outside this backend task.
  No public changelog claim is made before the native destination is shipped.

## Changed files

- `agent-docs/exec-plans/completed/2026-10-31-game-recap-link.md`
- `agent-docs/index.md`
- `agent-docs/product-specs/weekly-game.md`
- `apps/web/app/design/game-invite-study.tsx`
- `apps/web/app/g/[token]/game-invite-view.tsx`
- `apps/web/app/recap/[gameId]/game-recap-view.tsx`
- `apps/web/app/recap/[gameId]/page.tsx`
- `apps/web/e2e/game-recap-link.spec.ts`
- `apps/web/src/lib/game/access.ts`
- `apps/web/src/lib/game/app-links.ts`
- `apps/web/src/lib/game/chat-tool.ts`
- `apps/web/src/lib/game/recap-message.ts`
- `apps/web/src/lib/site-metadata.ts`
- `apps/web/test/game-chat-tool.test.ts`
- `apps/web/test/game-recap-link.test.tsx`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`
- `packages/assistant-engine/test/assistant-game-tools.test.ts`
- `packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts`
- `packages/hosted-execution/src/game-tools.ts`
- `packages/hosted-execution/test/game-tools-compatibility.test.ts`
Updated: 2026-10-31
Completed: 2026-10-31
