---
title: 'Real-model recap journeys read the public fallback comedy skill instead of the managed one'
severity: 'minor'
---

## Expected Behavior

A live recap-show journey (`pair recap show ...` in `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`) measures the writer the way production runs it. The recap craft guide tells the writer to read `$MURPH_ASSISTANT_SKILLS_ROOT/groupchat-comedy/SKILL.md`, so the journey should either use the managed skill text or say plainly that it did not.

## Current Behavior

`resolveRealCodexE2eConfig` points `MURPH_ASSISTANT_SKILLS_ROOT` at the public `packages/assistant-engine/skills` tree, where `groupchat-comedy`, `group-chat`, `group-challenge` and `music-generation` are short fail-closed fallbacks. The writer reads the fallback, which has no comedy guidance and tells unattended turns to skip output that needs the managed feature. Nothing in the run says this happened, so a humour comparison silently measures a different prompt than production.

## Possible Solution

Let the live runner take an explicit skills root (or a flag that overlays a local private checkout's skills onto a scratch copy of the public tree) and print which root a journey used.

## Minimal Reproducible Example

1. Run any `pair recap show` journey with the documented live recipe.
2. Inspect the printed shell commands: the writer `cat`s `$MURPH_ASSISTANT_SKILLS_ROOT/groupchat-comedy/SKILL.md` and gets the 1.2 KB public fallback.
3. Workaround used here: copy the public skills tree to a scratch directory, overlay the private repository's `packages/hosted-assistant-skills/skills`, and export `MURPH_ASSISTANT_SKILLS_ROOT` to that directory before running vitest.

## Context

Found while measuring a recap-show prompt change. Without the workaround, every base and head run would have compared shows written without the comedy skill production uses.
