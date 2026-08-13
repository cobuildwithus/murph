---
title: 'ReviewGPT wrapper rejects documented prompt-only flags'
severity: 'minor'
---

## Expected Behavior

The repository `pnpm review:gpt` preflight should accept and forward the installed ReviewGPT CLI's `--no-artifacts` option and the work-with-pro workflow's `--prompt-only` option for a follow-up that already has exact repository context.

## Current Behavior

The preflight exits before ReviewGPT starts and reports each option as an unknown flag. A minimal follow-up must therefore rebuild and upload the full repository archive.

## Possible Solution

Teach the preflight parser to forward these non-mutating context-selection flags, and add a wrapper test that keeps its accepted option set aligned with the installed CLI and workflow documentation.

## Minimal Reproducible Example

From an authorized task worktree with an existing ReviewGPT thread, run either synthetic command:

```sh
pnpm review:gpt --chat-url https://chatgpt.com/c/example --no-artifacts --prompt "Repeat the prior checksum."
pnpm review:gpt --chat-url https://chatgpt.com/c/example --prompt-only --prompt "Repeat the prior checksum."
```

Both commands stop in the preflight with an unknown-flag error.

## Context

A patch follow-up already had the exact reviewed archive in its thread. The mismatch forced another full repository packaging/upload cycle and obscured the smaller attachment-download recovery path.
