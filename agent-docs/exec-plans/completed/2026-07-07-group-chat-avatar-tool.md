# Hosted Group Avatar Tool

Status: completed
Updated: 2026-07-07

## Why

PR #452 adds a Murph-owned hosted group display-name mutation. This follow-on
adds a narrow way for Murph to update the current iMessage group avatar from the
same `murph.group` authority surface, reusing existing hosted image generation,
image-reference, and image-upload primitives.

## Scope

- Build on PR #452's `update_display_name` group tool contract without changing
  its internal-display-name semantics.
- Add `set_chat_avatar` to `murph.group` for the current route-authorized
  iMessage group chat only.
- Support generated avatars and exact reuse of user-sent JPG/PNG/WebP image
  refs using existing resolver/upload primitives.
- Preflight web-owned route and owner-active authority before resolving,
  generating, or uploading avatar media.
- Keep Linq provider egress in the web-owned group tool boundary and report
  accepted avatar mutations as provider-requested rather than confirmed final
  application.
- Add focused parser, assistant, runtime-injection, web handler, and Linq client
  tests.

## Non-goals

- Do not rename upstream iMessage/SMS chat titles in this follow-on.
- Do not add crop/edit UI, HEIC/GIF/video support, arbitrary external URL
  passthrough, member management, or new persisted avatar state.
- Do not create a second group appearance tool or new authority model.

## Verification plan

- Focused vitest coverage for touched package/app owners.
- Package/app typechecks for hosted-execution, assistant-engine,
  assistant-runtime, and apps/web.
- `pnpm test:diff` for touched paths if it truthfully covers the slice.
- `git diff --check`.

## Deployment notes

This spans assistant-engine, hosted runtime contract/parsing, web callback code,
and the runner bundle. Keep deploy skew compatible: old runners continue
without the new action; new runners should get structured unavailability until
the web callback exists.
Completed: 2026-07-07
