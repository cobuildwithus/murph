# Hosted Parser Toolchain Config

## Goal

Make hosted Cloudflare attachment parsing use an explicit native parser toolchain contract instead of rediscovering Whisper, ffmpeg, and Poppler through forwarded env or PATH.

## Scope

- Add an explicit parser-toolchain input to `createConfiguredParserRegistry`.
- Wire hosted conversation parser drain to pass hosted platform tool paths directly.
- Have the Cloudflare runner build the hosted runtime config with the image-owned native parser paths.
- Add focused regression tests proving hosted parser setup ignores drifted `WHISPER_*` env values when explicit platform paths are present.

## Constraints

- Preserve local parser behavior: vault parser config, env overrides, and system lookup continue to work by default.
- Do not allow per-user hosted env overrides to set executable selectors.
- Keep the current env-preservation fix as compatibility while the hosted parser path moves to explicit config.
- Do not disturb unrelated active hosted Linq, Python runner, device-sync, or web work in this dirty checkout.

## Verification Plan

- Focused parser package test for explicit platform toolchain discovery.
- Focused assistant-runtime tests for hosted runtime parser-toolchain parsing/normalization.
- Focused Cloudflare runner env test for native parser toolchain injection.
- Scoped typecheck/test commands for touched owners where the dirty checkout allows.

## Outcome

- Implemented explicit hosted parser toolchain config from Cloudflare into assistant-runtime and parser discovery.
- Hosted parser discovery now defaults explicit toolchains to no env or system lookup.
- Parser selector env is no longer a hosted forwarded-env profile, child-launcher ambient env, Codex shell allowlist entry, deploy optional var, or Docker image `ENV`.
- Hosted-local parser stubs still flow through typed `parserToolchain` from platform config source.
- Focused parser, assistant-runtime, and Cloudflare tests passed; parser coverage passed.
- Broader assistant-runtime typecheck/coverage is blocked by unrelated active device-sync credential-union test drift.
- Cloudflare verify is blocked by unrelated active runner nudge/backpressure test drift.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
