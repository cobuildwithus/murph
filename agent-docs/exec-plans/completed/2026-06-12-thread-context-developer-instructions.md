# Thread-level context developer instructions

Status: completed
Owner: Claude
Worktree: `murph-thread-context-instructions`

## Goal

Stop re-sending thread-stable prompt context inside every per-turn user message.
Today `dynamicTurnContextPrompt` (~2.3–5.5KB: evidence/reply style, link
self-check, date-format prose, onboarding guidance, and sometimes the cached
context snapshot) is
injected into the composed user prompt on every turn. Codex remote compaction
retains user messages (newest-first, 64k-token budget) and drops
developer-role items, then re-injects the session's developer instructions
once after each compaction — so per-turn user-message context is exactly the
content compaction must preserve (the measured ~40k-token post-compaction
floor), while developer-instruction content costs one resident copy total.

Re-partition the system prompt into four volatility tiers:

- `staticCacheableCorePrompt` (deploy-stable) — unchanged.
- `stableRouteCapabilityPrompt` (route-stable) — unchanged.
- `threadContextPrompt` (new, thread-birth-stable): timezone + date-format
  prose + product base URL, evidence/reply style, onboarding guidance (while
  open), link self-check.
- `dynamicTurnContextPrompt` (genuinely per-turn): the "Today's date is X"
  line, cached assistant context snapshot when present, and the
  automation-cron execution-context note.

`developerInstructions` (thread/start) becomes static + stable +
threadContext. The existing contract fingerprint hashes developer
instructions, so thread-context changes (onboarding completion, timezone
change, product URL change) rotate to a fresh thread — the semantics the
fingerprint design already implements and the onboarding skill guard
(1833f04be) already handles. Cached assistant context snapshots stay per-turn
because hosted runtime snapshots can change during retries and must not rotate
the native Codex thread contract.

## Success criteria

- Per-turn composed user prompt carries only the date line, cron note (when
  applicable), cached assistant context snapshot, conversation context lines
  (fresh threads), and the member's message.
- Thread-start developer instructions carry the moved sections verbatim (no
  prose rewrites in this change).
- Notification-decision profile output text is byte-identical (isolated
  one-shot threads; no benefit to moving content there).
- Contract fingerprint changes when thread-context content changes, but not
  when only the cached assistant context snapshot changes; resume binding
  behavior otherwise unchanged.
- assistant-engine typecheck + owner coverage green.

## Non-goals

- No prompt prose rewrites; sections move verbatim.
- No resume-time instruction refresh mechanism (deliberately removed before;
  fingerprint rotation is the refresh path).
- No changes to `compactWarmCodexThread` (separate active lane).

## Steps

1. `system-prompt.ts`: add `threadContextPrompt` layer; split
   `buildAssistantCurrentDateContextText` into thread-stable prose vs
   per-turn date line; move section builders between layer composers;
   keep notification-decision composition byte-identical.
2. `planning.ts`: include `threadContextPrompt` in
   `buildDeveloperInstructions`; per-turn `turnContextPrompt` keeps using
   `dynamicTurnContextPrompt`.
3. Update affected tests (layer expectations, developer-instruction
   contents, onboarding injection placement, prompt-composition snapshots).
4. Verification: `pnpm typecheck` + `pnpm test:diff` over touched files
   (assistant-engine owner coverage).
5. Completion audits per workflow (coverage-write, task-finish-review;
   prompt-review not required — prose unchanged), then `scripts/finish-task`.
Updated: 2026-06-12
Completed: 2026-06-12
