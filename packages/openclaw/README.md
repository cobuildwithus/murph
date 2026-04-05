# @murphai/openclaw

First-party OpenClaw bundle for Murph.

This package intentionally stays small. It ships a Murph skill bundle that teaches OpenClaw to use the existing `vault-cli` surface against the operator's vault instead of trying to spin up or manage a second Murph assistant runtime inside OpenClaw.

## What It Installs

- one OpenClaw-compatible bundle in the default Claude-layout shape under `skills/**`
- one Murph skill that teaches OpenClaw to use `vault-cli` through OpenClaw's built-in `exec` tool
- no separate daemon, no duplicate assistant state, and no OpenClaw-owned Murph runtime

## Install

Install Murph first so `vault-cli` is available on `PATH`:

```bash
npm install -g @murphai/murph@latest
murph onboard
```

Then install the OpenClaw bundle:

```bash
openclaw plugins install @murphai/openclaw
openclaw gateway restart
```

After that, new OpenClaw sessions can use Murph directly over the configured vault.

## Why This Package Is Skill-First

The integration is intentionally vault-first and simple:

- Murph continues to own the vault and its canonical write paths.
- OpenClaw learns how to call `vault-cli` well.
- Operators keep using the same Murph vault they already onboarded.
- There is no second Murph assistant runtime to configure, migrate, or reconcile.

## Requirements

- `vault-cli` must be installed and available on the host `PATH`.
- Murph should already know the default vault, usually because `murph onboard` was run.
- If you run sandboxed OpenClaw agents, `vault-cli` also needs to exist inside the sandbox image or setup command.

## Local Development

```bash
openclaw plugins install ./packages/openclaw
openclaw gateway restart
```
