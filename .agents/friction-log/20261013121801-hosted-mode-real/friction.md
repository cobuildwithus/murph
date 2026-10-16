---
title: 'Hosted-mode real-Codex journeys diverge from production Codex config and sandbox'
severity: 'minor'
issue: 'cobuildwithus/murph#4144'
---

## Expected Behavior

A local real-Codex journey that runs a hosted turn (executionContext.hosted set)
uses the same Codex config the hosted runner gets from buildHostedCodexConfigToml
(skills, memories, web search mode, features, shell environment policy) and can
execute the repository vault-cli and read skills under the member-workspace
permission profile, so turn shape and timing match production.

## Current Behavior

The canonical launcher only adds the hosted permission profiles. Everything
else comes from the developer's subscription Codex home: personal skill
instructions, a notify hook, live web search, apply_patch_freeform, and other
feature flags. In hosted mode the murph-member-workspace profile allows /app
reads only, so the repository CLI dist, skills root, and the macOS system
OpenSSL config are unreadable and every vault-cli call fails before the CLI runs.

## Possible Solution

Expose the hosted Codex config as -c overrides (or a shared builder) for live
journeys, plus a test-only read-root list that stands in for /app.

## Minimal Reproducible Example

Run any assistant-engine live journey through runAssistantAutomationPass with
executionContext.hosted and the canonical codex launcher; the first
`cat "$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md"` returns
"Operation not permitted" and `vault-cli` fails with an OpenSSL config error.

## Context

Found while building the meal intake speed benchmark; worked around with
explicit hosted-equivalent overrides and appReadRoots in its test support.
