---
title: 'OpenAI-only cutover instructions require an unavailable fleet admission pause'
severity: 'minor'
issue: 'cobuildwithus/murph#4090'
---

## Expected Behavior

The deployment owner provides an executable ordering that preserves existing replies and configuration updates during native runner replacement.

## Current Behavior

The OpenAI-only cutover instructions require a global admission pause, but the runtime exposes no supported pause/resume operation. The protected native release overlaps old and new runners. Removing the mailbox provider discriminator makes old runners reject the new Worker response, and rejecting retired configuration response fields prevents new runtimes from reading old Web responses. The post-Web contract migration workflow checks Web aliases and a timed function drain without proving native convergence.

## Possible Solution

Preserve the fixed OpenAI mailbox discriminator for existing runners and accept/discard the two retired configuration response keys. Document runtime-first deployment, explicit Web and migration holds, native convergence proof, and bridge removal conditions.

## Minimal Reproducible Example

Use synthetic OpenAI-only payloads with the shipped mailbox and assistant-configuration response readers. Read an outbound mailbox response without assistantProvider using the older runner parser. Read an older configuration response with provider and availableProviders using the new strict parser. Both fail even though no alternative inference is selected.

## Context

Found while preparing the authorized OpenAI-only production rollout, before promoting the incompatible candidate. This is a runbook and mixed-version proof gap, not a request for a new fleet control plane.
