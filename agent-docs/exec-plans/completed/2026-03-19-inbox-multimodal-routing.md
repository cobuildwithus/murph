# Inbox Multimodal Routing

## Goal

Implement the requested inbox-model routing change so `vault-cli inbox model bundle|route` can mark eligible routing images, attach supported stored images to model requests, and fall back cleanly to text-only routing when a provider rejects image input.

## Scope

- CLI inbox model bundle and route behavior under `packages/cli/src/**`
- Routing-image eligibility helper shared by inbox routing and assistant automation
- Focused test coverage for bundle preparation, route fallback, parser-wait bypass, and CLI help text
- Matching operator docs in `README.md`, `ARCHITECTURE.md`, and `docs/contracts/03-command-surface.md`

## Constraints

- Keep unsupported or missing image evidence on the text-only path.
- Preserve current audited bundle/plan/result artifacts and extend them with mode/fallback metadata.
- Do not broaden parser-wait bypass beyond supported stored routing images.
- Preserve adjacent worktree edits and avoid unrelated CLI/runtime changes.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- If those are blocked locally, run the strongest targeted CLI verification available and record the blocker.

## Notes

- Source material is the requested multimodal inbox routing patch.
