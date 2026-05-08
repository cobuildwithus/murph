# DeepSec High Boundary Hardening

## Goal

Close the current DeepSec `HIGH` findings with the smallest durable boundary checks:

- Production Cloudflare deploy only runs from protected main before secrets are exposed.
- npm release publishing only runs for tags whose commit is in main history.
- Runner bundle dependency resolution cannot drift from the committed root lockfile.
- Telegram polling rejects messages outside the configured operator chat/account binding.
- Setup AgentMail discovery does not send real API keys to arbitrary env-provided hosts.
- Hosted canonical write restore replays only supervisor-checkpointed receipt artifacts, not
  assistant-local receipt files from hot runtime state.

## Constraints

- Keep the fixes local to the affected boundary. Do not add a new policy framework.
- Preserve existing dependency-injection seams for tests.
- Do not print secrets, raw env values, or personal identifiers in docs, tests, output, or commits.
- Preserve unrelated working-tree edits.

## Verification Plan

- Focused tests for AgentMail setup, Telegram poll filtering, runner bundle lock enforcement,
  and hosted canonical write receipt restore.
- Direct workflow syntax/readback for GitHub Actions changes.
- `pnpm typecheck`.
- Prefer `pnpm test:diff` over broader lanes if it truthfully covers the touched owners; otherwise use owner coverage.
- Required security/privacy and final review audit passes before handoff.

## State

- Patched the workflow, AgentMail, Telegram, runner bundle, and hosted canonical write
  receipt boundaries.
- Focused tests, package typechecks, workflow YAML parsing, DeepSec status, diff checks,
  and required audit passes are complete.
- Repo-level `pnpm typecheck` and `pnpm test:diff` remain blocked by unrelated dirty
  worktree failures outside this plan's working set.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
