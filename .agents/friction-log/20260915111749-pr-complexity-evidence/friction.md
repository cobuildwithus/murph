---
title: 'PR complexity evidence rejects pnpm global flags'
severity: 'minor'
---

## Expected Behavior

A Guard field documenting a successful `pnpm --silent complexity:diff` run should satisfy the authored TypeScript complexity evidence requirement.

## Current Behavior

The PR evidence validator requires the literal contiguous `pnpm complexity:diff` spelling. A valid pnpm global flag makes the check reject otherwise complete evidence, forcing the description to omit that flag.

## Possible Solution

Recognize supported pnpm global flags before the script name, or document that the field requires a canonical command label separate from the executed command.

## Minimal Reproducible Example

Give `scripts/check-pr-complexity-summary.mjs` a TypeScript change and a complete complexity section whose Guard field is `pass — pnpm --silent complexity:diff`. It rejects the command name; removing `--silent` satisfies the same check.

## Context

The check interrupts a verified PR for a presentation difference that does not alter the executed complexity guard.
