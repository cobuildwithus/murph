# @murphai/assistant-core

Dedicated headless assistant boundary package for non-CLI consumers.

It owns the local-only assistant, inbox, vault, operator-config, shared usecase, and setup/runtime-helper surface used by hosted runtimes, local daemons, and the CLI while intentionally excluding CLI command routing, Ink/UI entrypoints, daemon-aware wrappers, and host/onboarding flows, which now live in `@murphai/assistant-cli` and `@murphai/setup-cli`.

Its package exports are now a curated set of explicit entrypoints: the root surface for high-level headless services, narrow top-level assistant seams such as `assistant-automation`, `assistant-cron`, `assistant-service`, `assistant-status`, and `assistant-store`, broader grouped seams such as `assistant-runtime`, `assistant-provider`, and `assistant-state`, plus the remaining non-assistant helper subpaths still consumed in the current workspace. That keeps CLI, hosted-runtime, and daemon code on deliberate owner-package seams instead of deep `assistant/*` internals or the old catch-all wildcard.
