---
title: 'ReviewGPT rejects regular Chat after Chat/Work controls switch to buttons'
severity: 'minor'
---

## Expected Behavior

The pinned ReviewGPT dependency recognizes a selected Chat control before staging a review, while rejecting Work sessions.

## Current Behavior

The surface probe queries only radio roles. A Chat/Work toggle built from buttons with aria-pressed has no matching controls, and the unselected Work label is mistaken for a Work breadcrumb. The guarded review fails before submission.

## Minimal Reproducible Example

Render visible buttons containing Chat and Work spans. Give Chat aria-pressed=true and Work aria-pressed=false, without radio roles. The current probe reports work instead of chat-selected.

## Possible Solution

Extend the existing dependency patch to recognize pressed-state buttons in both control discovery and breadcrumb exclusion. Preserve Work selection, usage and breadcrumb rejection.

## Context

This blocks the required repository review gate before a hosted runtime correction can ship. Synthetic browser fixtures can prove both radio and button controls, unknown surfaces and active Work rejection.

The same UI removed model-picker test IDs. The accessible trigger is a button
labelled Select ChatGPT model, and its menu exposes a Select model item with an
explicit model summary. These selectors restore discovery without admitting
effort-only labels as model proof. An unsent synthetic draft verifies selection.
