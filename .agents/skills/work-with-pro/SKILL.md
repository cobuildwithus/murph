---
name: work-with-pro
description: >-
  Use when working with ChatGPT Pro review threads in this Murph repo: sending
  repo work through review:gpt, watching existing ChatGPT conversation URLs,
  downloading returned patch/diff artifacts, or landing Pro findings. Use this
  for requests like "work with pro", "wait on this ChatGPT thread", "land what
  Pro says to fix", or browser-profile recovery for review:gpt
  thread wake/export/download flows.
---

# Work With Pro

Use this skill when the user wants Codex to coordinate with a ChatGPT Pro thread and land the returned repo fixes locally.

## Murph Browser Profile Rule

In this repo, `pnpm review:gpt` is wrapped through `scripts/review-gpt-browser-profile.sh` and defaults to the `phlebas` managed browser profile.

Do not run raw `pnpm exec cobuild-review-gpt thread wake ...` for Murph watch flows unless you also pass the explicit browser endpoint from the repo wrapper. The raw tool default can attach to a different browser profile.

Prefer:

```bash
bash scripts/review-gpt-browser-profile.sh thread phlebas wake \
  --delay 0s \
  --poll-interval 1m \
  --poll-timeout 120m \
  --chat-url <chatgpt-url> \
  --session-id "$CODEX_THREAD_ID"
```

If a raw `cobuild-review-gpt` command is unavoidable, include:

```bash
--browser-endpoint "$(bash scripts/review-gpt-browser-profile.sh browser-endpoint phlebas)"
```

If a thread export says "Unable to load conversation" or times out while the user says the thread was created by `review:gpt`, first suspect the wrong browser endpoint. Re-run through the Phlebas wrapper before nudging the thread, asking the user to resend, or abandoning the Pro path.

## Modes

Use one of three modes:

- `watch-only`: the user supplied an existing ChatGPT conversation URL and wants Codex to wait, download artifacts, and land them. Do not post anything new.
- `nudge-existing-thread`: the user explicitly asks Codex to send a follow-up into an existing thread. Send the smallest unblocker, then watch the thread.
- `send-and-wake`: the user wants Codex to delegate new work or review to Pro. Send through repo `review:gpt`, then arm a wake.

Default to `watch-only` when the user provides only a ChatGPT URL plus instructions like "work with pro on this", "wait on this thread", "land what it says", or "implement the patch when it returns".

## Watch-Only

1. Confirm the URL is present.
2. Do not send a prompt, nudge, or request for a patch.
3. Start the wake with the Phlebas wrapper command above.
4. Keep the wake attached in a persistent tool session when possible, and confirm it is armed from initial logs or a still-running process.
5. Let the wake run until it completes, times out, fails concretely, or the user redirects.
6. When it resumes Codex, inspect the exported thread, retained assistant response, downloaded artifacts, and status file.
7. If a `.patch`, `.diff`, or equivalent artifact exists, apply the returned intent carefully, preserving unrelated dirty-tree work.
8. If no artifact exists and the retained response is only prose, partial progress, or an offer to proceed, report that state and ask before nudging.

In `watch-only`, phrases like "land the things it says to fix" mean "land the returned findings or attachment if they already exist." They do not authorize posting a new follow-up.

## Nudge Existing Thread

Use this only when the user explicitly asks to message an existing thread.

1. Send the smallest follow-up needed to unblock the thread.
2. Prefer attached-file `pnpm review:gpt --send --chat-url <url> ...` flows for review of local changes.
3. Treat browser send timeouts or disabled send buttons as unconfirmed delivery until a refreshed thread export shows the new user turn.
4. After sending, arm the Phlebas wake and wait for the returned response or artifact.

## Send And Wake

Use this when delegating new work to Pro.

1. Build a prompt asking for scoped, compilable changes and a `.patch` or `.diff` attachment when implementation is expected.
2. Send through the repo script:

```bash
pnpm review:gpt --send --prompt "<prompt>"
```

3. If sending into an existing thread, include `--chat-url <chatgpt-url>`.
4. Arm the Phlebas wake with `--delay 0s`, `--poll-interval 1m`, `--poll-timeout 120m`, and `--session-id "$CODEX_THREAD_ID"`.

Use wording close to:

```text
Implement this task and return the result as a .patch or .diff attachment that can be applied locally.
Keep the patch scoped to the requested work, include any needed tests, and note assumptions briefly.
```

## Landing Returned Work

Treat Pro output as implementation intent, not overwrite authority.

- Read the repo routing docs before changing files.
- Check the coordination ledger before editing.
- Preserve unrelated dirty-tree edits.
- Apply patches with care when local files have moved.
- Run the repo-required verification for the touched surface.
- If repo policy requires completion audits or a scoped commit, follow the repo workflow.

When no actionable findings or artifacts are present, do not invent fixes just to make the wake productive. Report the no-op state and the exact checks performed.
