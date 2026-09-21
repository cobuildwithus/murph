---
title: 'Hosted-local startup requires a removed Codex smoke-model template'
severity: 'minor'
---

## Expected Behavior

A live hosted-local scenario using GPT-5.6 Terra should start when the host CLI supplies all three required product models, or preflight should identify the compatible host CLI version before stack preparation.

## Current Behavior

`prepareHostedLocalCodexModelCatalog` also requires GPT-5.4 Mini to synthesize the unrelated GPT-5.4 Nano deploy-smoke entry. Codex CLI 0.155.1 includes the product models but no longer includes that template, so startup fails before the scenario runs. The pinned runner version, 0.153.4, still supplies it.

## Minimal Reproducible Example

1. Use an unmodified Codex CLI 0.155.1 on PATH.
2. Confirm `codex debug models --bundled` includes GPT-5.6 Sol, Terra, and Luna but omits GPT-5.4 Mini.
3. Start a live hosted-local scenario with OpenAI and GPT-5.6 Terra selected.
4. Observe the missing-template error from the catalog preparation owner before any member turn.

## Context

This blocked the synthetic native-voice proof after the actual Linux runner image passed compilation and compatibility checks. Selecting the already-built matching 0.153.4 host CLI through the test process PATH avoids changing the production model or runner. The harness should make this version dependency explicit or remove its dependency on an unrelated retired model template.
