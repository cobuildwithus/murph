# ReviewGPT Lane Availability

## Goal

Make default ReviewGPT lane selection avoid managed browser profiles that are
already locked without an active remote-debugging endpoint, then prove the
default path with a real browser send/capture smoke test.

## Constraints

- Keep lane routing stateless and simple.
- Preserve explicit lane pinning for recovery/debugging.
- Do not upload unrelated dirty working-tree changes during smoke tests.

## Plan

1. Add availability filtering to default random lane selection.
2. Document that the random default chooses among usable lanes.
3. Run shell, dry-run, and real prompt-only ReviewGPT E2E proof.

## Verification

- Passed: `bash -n scripts/review-gpt.config.sh`
- Passed: `pnpm review:gpt pr-review --dry-run --no-zip`
  - Confirmed the default selector picked a usable lane while Mountain was
    locked without CDP.
- Passed: `REVIEW_GPT_BROWSER_LANE=phlebas pnpm review:gpt --no-zip --send --wait ...`
  - Confirmed the committed config selected the Pro review model on Phlebas,
    submitted the prompt, waited, and captured the marker response.
- Passed: `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts`
- Passed: `pnpm deps:guard`
- Passed: `pnpm deps:ignored-builds`
- Passed: `pnpm install --lockfile-only`
- Passed: `pnpm install`
- Passed: `git diff --check -- <touched files>`
- Failed, unrelated: `pnpm typecheck`
  - Existing `packages/assistant-cli` errors: `src/assistant/store.ts` and
    `src/commands/assistant.ts` call a function with two arguments where the
    current type expects one.
- Failed, unrelated remaining advisories: `pnpm deps:audit`
  - The ReviewGPT `repomix` advisory was removed by the narrow override to
    `repomix@1.14.1`; remaining high advisories are through existing `ws`,
    `form-data`, `vite`, and `undici` paths outside this task.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
