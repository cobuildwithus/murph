# delayed ChatGPT thread check helper

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

- Add repo-local helpers that can either delay-run `review:gpt` or directly export an authenticated ChatGPT thread from the managed local Chrome session, so a target thread can be re-checked later without depending on the logged-out web fallback.

## Success criteria

- Root `package.json` exposes an ergonomic delayed `review:gpt` command and a direct thread-export command.
- The delayed path defaults to a safe prompt-only check with no ZIP upload, auto-send, wait, and a deterministic response-file location unless the caller overrides them.
- The direct export path can read a target ChatGPT thread from the managed authenticated browser and save thread text plus attachment/button labels as JSON.
- Root docs explain the intended use and the known limitation that this still depends on the local browser profile already being able to access the target chat.

## Scope

- In scope:
  - a small root shell wrapper for delayed `review:gpt` checks
  - a direct authenticated thread-export helper for managed Chrome
  - root `package.json` wiring
  - concise README usage notes
- Out of scope:
  - automatic patch-file application
  - background self-resume of this Codex session

## Risks and mitigations

1. Risk: the delayed helper could accidentally upload a fresh source bundle when the user only wants to re-check an existing chat.
   Mitigation: default to `--no-zip` and only pass through extra flags explicitly provided by the caller.
2. Risk: the direct-export helper could capture only thread text and attachment names without proving that attachment bytes are downloadable.
   Mitigation: record the exact attachment/button labels so later manual follow-up can target the right patch files, and treat automatic attachment download as a separate follow-up if needed.
3. Risk: the helpers could imply that ChatGPT thread access works without an authenticated local browser session.
   Mitigation: document that the URL still depends on the local browser profile already being able to open the chat.
4. Risk: root script/docs edits could conflict with other in-flight root tooling work.
   Mitigation: keep the change narrow, preserve adjacent edits, and limit touched files to the new helper plus direct wiring/docs.

## Tasks

1. Register the narrow tooling lane in the coordination ledger.
2. Add the delayed wrapper script, the direct thread-export script, and root package wiring.
3. Update root docs with concise usage notes and limitations.
4. Prove the direct thread-export path against an authenticated example thread.
5. Run required verification commands and close the plan if the task completes.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
Completed: 2026-03-29
