---
title: 'Open gallery dialogs obscure unrelated screenshot studies'
severity: 'minor'
---

## Expected Behavior

A screenshot study should render without overlays from unrelated examples in its category.

## Current Behavior

The account screenshot gallery mounts an open Family upgrade dialog above an unrelated inert settings study. Locator visibility and text assertions can pass while element screenshots capture the overlapping dialog and blurred target.

## Possible Solution

Render modal studies in contained presentation frames, or provide focused routes that mount only the selected study.

## Minimal Reproducible Example

Open /screenshots/account, locate a settings study outside the Family section, and capture its element at mobile width. Inspect the image for the Family upgrade dialog overlay.

## Context

This blocks trustworthy visual proof of account recovery states. A focused noindex route is the current workaround; screenshots still require visual inspection.
