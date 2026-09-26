---
title: 'ReviewGPT rejects regular Chat after the home mode toggle changed to buttons'
severity: 'minor'
---

## Expected Behavior

The repository's configured ReviewGPT version recognizes regular Chat before staging a review and rejects an active Work surface.

## Current Behavior

The new-chat surface uses Chat and Work buttons with aria-pressed state. The installed review tool searches only radio controls, then treats the unselected Work button label as an active Work breadcrumb. A page with Chat pressed and Work unpressed is rejected before submission. Multiple configured browser lanes reproduce the failure.

## Possible Solution

Update the upstream ReviewGPT surface probe to recognize the actual button controls and exclude their labels from breadcrumb detection. Preserve the active Work rejection and all review identity/model checks; do not duplicate browser policy in the repository wrapper.

## Minimal Reproducible Example

Run the standard first-round review command on a new-chat page whose Chat/Work selector uses buttons. Confirm that Chat has aria-pressed=true and Work has aria-pressed=false. The pinned tool rejects this regular Chat page before attaching or sending the review.

## Context

This blocks the final review gate even after implementation checks pass. An existing regular Chat conversation passes the surface check, but staging then fails because the model button now has aria-label="Select ChatGPT model". An isolated copy of the installed package is being checked with only the radio/button and model-button selector updates; the installed dependency and verification rules remain unchanged.
