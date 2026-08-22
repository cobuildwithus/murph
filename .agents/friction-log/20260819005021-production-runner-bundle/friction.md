---
title: 'Production runner bundle budget is absent from pre-merge checks'
severity: 'major'
---

## Expected Behavior

Any PR that changes code included in the production runner bundle, especially
one declaring an immediate-rollout hard floor, should run the exact production
bundle byte-budget checks before merge.

## Current Behavior

A reviewed runtime PR added intended code inside the existing Assistant Engine
and hosted pending-input graphs and passed its required checks, but the next
production deployment failed before Cloudflare because both the vault CLI
total-byte ratchet and runner-entrypoint static-closure ratchet were stale. The
deploy job was the first exact Linux assembly of the merged graph.

## Possible Solution

Convention-discover runner-bundle-affecting paths in pull-request CI and run the
production assembly or an equivalent exact metafile budget check on the
immutable candidate. Keep the deploy job authoritative, but make the same
budget failure visible before merge.

## Minimal Reproducible Example

1. Change production code already included in the runner bundle enough to
   exceed a narrow byte ratchet.
2. Run the required pull-request checks and merge after they pass.
3. Dispatch the protected production deploy.
4. Observe the first runner bundle assembly fail before the Cloudflare deploy
   step.

## Context

This delayed an urgent production runtime correction and created a merged
hard-rollout floor that could not be published until a separate measured
ratchet update. No bypass was used; the deployment guards remained fail-closed.
