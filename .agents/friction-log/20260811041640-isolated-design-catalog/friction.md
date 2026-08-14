---
title: 'Isolated design catalog still polls the control database'
severity: 'minor'
issue: 'cobuildwithus/murph#1713'
---

## Expected Behavior

Synthetic component studies on the design catalog should render in the documented frontend-only worktree lane without requiring control-plane database state.

## Current Behavior

Opening the Components tab starts the global message-volume request. When the frontend-only lane has only a valid isolated database URL and no provisioned database, the card studies render but the dev server repeatedly reports database errors from the unrelated volume aggregate.

## Possible Solution

Keep public volume data out of synthetic design-catalog rendering, or give the design surface an existing synthetic owner for that value so component proof does not depend on control-plane persistence.

## Minimal Reproducible Example

1. Start the documented app-local frontend-only dev lane in a fresh task worktree with an isolated database URL.
2. Open the Components tab on the design catalog.
3. Capture a synthetic component study.
4. Observe repeated database aggregate errors from the unrelated message-volume request.

## Context

The component studies themselves use synthetic props and render correctly. The friction is the unrelated global request during repository-required visual proof, not a production-card failure.
