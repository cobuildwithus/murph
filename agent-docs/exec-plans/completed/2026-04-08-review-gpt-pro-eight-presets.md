# Review-Gpt Pro Eight Presets

Status: active
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Run the repo-local `review:gpt` autosend flow for all eight configured audit presets one by one, capture the resulting ChatGPT thread URLs, then arm `work-with-pro`-style `thread wake` watchers so any returned `.patch` or `.diff` attachments are downloaded and resumed back into Codex automatically.

## Success criteria

- All eight configured presets are attempted individually through `pnpm review:gpt --send`.
- The resulting ChatGPT thread URL for each successful autosend is recorded or the exact failure is captured.
- A `cobuild-review-gpt thread wake` watcher is armed for each successful thread URL against the current `CODEX_THREAD_ID`.
- Output directories exist for the send/watch artifacts so later resumed patch landings can be traced back to the originating preset.
- Any blocker that prevents send or watch setup is captured with the exact command and failure mode.

## Scope

- In scope:
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-08-review-gpt-pro-eight-presets.md`
- `output-packages/review-gpt-pro-eight-presets/**`
- Launching repo-local `review:gpt` autosends for the eight presets in `scripts/review-gpt.config.sh`
- Launching `cobuild-review-gpt thread wake` watchers for the successful returned thread URLs
- Out of scope:
- Manually nudging existing threads unless the user asks for that explicitly
- Applying returned patches in this setup phase before a watcher or resumed Codex child has produced a concrete attachment
- Unrelated repo implementation or cleanup work

## Constraints

- Technical constraints:
- The worktree is already heavily dirty, so any later returned patch must be treated as intent and merged narrowly.
- `CODEX_THREAD_ID` must stay available for watcher resume.
- The managed ChatGPT browser session must already be signed in for autosend to work.
- Product/process constraints:
- Follow the repo plan-bearing workflow for this multi-thread patch-landing lane.
- Preserve unrelated worktree edits and avoid leaking personal identifiers into repo artifacts.

## Risks and mitigations

1. Risk: `review:gpt` autosend does not emit usable thread URLs directly.
   Mitigation: capture structured command output and inspect the managed-browser/export artifacts immediately after each send.
2. Risk: browser autosend fails on some presets due to ChatGPT composer or session state.
   Mitigation: run presets one by one, record exact failures, and continue with the remaining presets.
3. Risk: multiple wake watchers create ambiguous output or collide with other repo work.
   Mitigation: use preset-specific output directories and preserve a per-preset command/status record.

## Tasks

1. Register this lane in the coordination ledger and verify the exact `review:gpt` send/output behavior needed to recover thread URLs.
2. Run the eight autosends one by one for `security`, `architecture`, `giant-file-composability`, `data-model-composability`, `simplify`, `bad-code`, `legacy-removal`, and `package-boundaries`.
3. Record the thread URL and local output location for each successful send, or capture the exact failure for unsuccessful sends.
4. Start a `cobuild-review-gpt thread wake --delay 0s --poll-interval 1m --poll-timeout 120m` watcher for each successful thread URL against the current `CODEX_THREAD_ID`.
5. Confirm each watcher is armed from its initial output or persisted status artifact.

## Decisions

- Use the repo-local `work-with-pro` send-and-wake pattern, but split it into a batch send phase followed by per-thread watcher setup so the per-preset thread URLs can be captured explicitly.
- Keep watcher output under `output-packages/review-gpt-pro-eight-presets/` for traceability.

## Verification

- Commands to run:
- `pnpm review:gpt --list-presets`
- `pnpm exec cobuild-review-gpt --help`
- `pnpm exec cobuild-review-gpt thread wake --help`
- Per-preset `pnpm review:gpt --send ...` commands
- Per-thread `pnpm exec cobuild-review-gpt thread wake --delay 0s --poll-interval 1m --poll-timeout 120m ...` commands
- Expected outcomes:
- The eight presets are attempted, successful sends produce recoverable thread URLs, and watchers are armed for each successful thread.
