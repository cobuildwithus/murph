---
title: 'Generated image live journey loses completion context on thread resume'
severity: 'minor'
---

## Expected Behavior

The generated-image continuation journey should deliver the trusted image using the same turn-context path as production.

## Current Behavior

The fixture puts completion metadata into developerInstructions on a resumed thread. The resume request intentionally omits thread instructions, so the model never receives the completion descriptor and cannot attach the expected image. The opening avatar wording also permits a separate group-avatar tool path despite the fixture requiring standalone generation.

## Possible Solution

Use buildTrustedHostedImageCompletionTurnContext and resolveAssistantProviderPrompt for the resumed completion, and request an illustration before the separate avatar update.

## Minimal Reproducible Example

Run the focused live generated-image-to-group-avatar journey with local subscription auth. Inspect buildCodexThreadResumeContextParams and the fixture's resumed input. The old fixture passes completion context only through an omitted field.

## Context

Found while validating an image-model upgrade. Deterministic image delivery, retention, and usage tests passed. The correction is confined to the live fixture and reuses the production prompt builders.

After correcting the context path, the journey passed once. A later run failed at initial generation-tool selection before image-provider execution; the opt-in journey still needs consistency and visible-reply review.

## Follow-up diagnosis

The local subscription binary also enables native image generation by default. Scope `features.image_generation=false` to this hosted image journey so its synthetic launcher and private-delivery owner are exercised. With that override, exact generation, attachment, and avatar-update effects passed. The provider stub returns `requested`, so the reply assertion must also accept a truthful requested-update acknowledgment rather than require completed-update wording. Compact launch diagnostics now appear before assertions.
