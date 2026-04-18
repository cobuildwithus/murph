## Goal (incl. success criteria):

Release the new `@cobuild/review-gpt` patch that includes the top-level `delay` command, update Murph to consume that published version, then arm the requested review-gpt / thread-wake flows for the `bad-code`, `bug-hunt`, and `security` presets both generally and with an extra Cloudflare-to-`apps/web` wake-seam focus prompt.

## Constraints/Assumptions:

- Preserve unrelated dirty Murph worktree edits.
- Treat `../review-gpt` as the source-of-truth package repo and Murph as the downstream consumer.
- Use the published package version in Murph after release rather than a file/url dependency.
- Keep the scheduled wake child instructions explicit about using GPT-5.4/high subagents because the user asked for that.
- Do not expose secrets or raw auth material while releasing or scheduling.

## Key decisions:

- Release `review-gpt` first, then bump Murph's dependency metadata and lockfile to the published version.
- Use immediate `review:gpt --send` runs to create the six threads now, then arm delayed `thread wake` polling for four hours from now against the returned thread URLs.
- Apply the implementation instructions through `--resume-prompt`; only use `--recursive-prompt` if the chosen wake mode actually uses recursive same-thread follow-up.

## State:

done

## Done:

- Confirmed npm registry latest is still `@cobuild/review-gpt@0.5.68`.
- Confirmed local `../review-gpt` is clean on the commit that adds the delay command.
- Confirmed Murph still depends on `@cobuild/review-gpt@^0.5.68`.
- Confirmed the Murph preset registry contains `bad-code`, `bug-hunt`, and `security`.
- Confirmed `CODEX_THREAD_ID` is available for wake scheduling.
- Released `@cobuild/review-gpt@0.5.69` with the top-level `delay` command and confirmed npm visibility.
- Updated Murph to `@cobuild/review-gpt@^0.5.69`, refreshed the release-age allowlist, and kept the lockfile diff scoped to the review-gpt package only.
- Verified the dependency/tooling lane with `pnpm deps:guard`, `pnpm deps:ignored-builds`, `pnpm review:gpt:delay --help`, `pnpm chatgpt:thread:wake --help`, and `pnpm test:repo-tools`.
- Sent six review threads:
  - general `bad-code`
  - general `security`
  - seam-focused `bad-code`
  - general bug-hunt-equivalent prompt
  - seam-focused bug-hunt-equivalent prompt
  - seam-focused security-equivalent prompt
- Armed six detached `thread wake` jobs with `--delay 4h`, `--poll-interval 1m`, `--poll-timeout 120m`, `--recursive-depth 1`, and a resume prompt instructing the resumed Codex child to use GPT-5.4/high subagents for bounded parallel work.

## Now:

- No further implementation work in this lane.

## Next:

- Hand off the armed thread URLs, wake PIDs, and the narrow verification results.

## Open questions (UNCONFIRMED if needed):

- The literal `bug-hunt` preset draft repeatedly hit a managed-browser `send-button-disabled` state in ChatGPT even after long timeout retries, so the launched bug-hunt threads use shorter bug-hunt-equivalent prompts to get the same review intent through the composer.
- Murph root `pnpm typecheck` remains red in the existing dirty tree; this turn reproduced pre-existing workspace-boundary failures and also hit transient module-resolution fallout while the workspace install state and lockfile were temporarily out of sync during the dependency bump.

## Working set (files/ids/commands):

- `../review-gpt/package.json`
- `../review-gpt/scripts/release.sh`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `scripts/review-gpt.sh`
- `scripts/review-gpt-cli.sh`
- `pnpm release:check`
- `pnpm release:patch`
- `pnpm review:gpt --send ...`
- `pnpm exec cobuild-review-gpt thread wake ...`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
