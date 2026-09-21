---
title: 'Hosted-local AMD64 emulation cannot enforce the Codex Linux sandbox'
severity: 'minor'
---

## Expected Behavior

The disposable hosted-local runner should support Codex's existing filesystem permission profiles so a real backing turn can run through the complete hosted stack.

## Current Behavior

The AMD64 deployment image runs under emulation on an ARM64 Docker engine. A real hosted voice call connects and durably admits input, but the backing thread fails during instruction discovery. Docker's default security profile first prevents nested namespace creation. Enabling the same disposable-container namespace settings used by the existing runner smoke gets past that boundary, but the emulated Codex sandbox cannot install seccomp filters. The normal turn failure then closes the shared process and voice call.

## Possible Solution

Run this composed proof on a native AMD64 Linux development runner with the existing nested-namespace settings. Preserve Codex permission enforcement and production configuration. Do not treat emulated local failure as native Linux failure or turn off the inner sandbox to obtain a passing result.

## Minimal Reproducible Example

Run the opt-in hosted-local native voice E2E against the patched AMD64 Linux runner image on an ARM64 Docker engine. Use a synthetic input asking to read a fixture file. Native Linux compatibility and final-image permission-confinement CI pass; the emulated full-stack backing thread cannot initialize its seccomp sandbox.

## Context

This blocks the full hosted spoken-answer proof locally. A temporary test-scoped Docker API adapter enabled only this run's disposable runner namespaces to isolate the second failure; it is not deployment code. No production permission profile or native patch was changed for this diagnosis.


The native AMD64 Blacksmith Testbox passed the complete hosted speech/tool/answer
journey with the same inner sandbox enabled. This confirms the local emulation
limitation. The Testbox and namespace adapter are proof infrastructure only;
shipping still uses the existing image and deployment workflow.
