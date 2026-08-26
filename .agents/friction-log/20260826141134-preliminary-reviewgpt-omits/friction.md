---
title: 'Preliminary ReviewGPT omits required assistant verification skill'
severity: 'minor'
---

## Expected

A completion-specialists packet for an assistant-behavior PR includes the tracked verification skill required by the repository instructions.

## Current behavior

The canonical packet omits `.agents/skills/verify-murph-assistant/SKILL.md`, so the preliminary review is invalid because the reviewer cannot apply the required assistant verification contract.

## Why this matters

Assistant-behavior changes lose their required review lens unless every caller knows to add the skill through an environment override.

## Minimal reproduction

Package a synthetic assistant-behavior PR with the canonical completion-specialists command and inspect the ZIP manifest; the required skill is absent.

## Suggested direction

Include the existing tracked assistant verification skill automatically when the assistant specialist lens applies.
