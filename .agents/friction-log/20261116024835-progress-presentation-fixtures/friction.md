---
title: 'Progress presentation fixtures cannot serve as scoring goldens'
severity: 'minor'
---

## Expected Behavior

A fixture used as an engine golden should be reproducible from synthetic entries under the documented contribution and streak rules.

## Current Behavior

The Progress board fixtures are documented as presentation examples. Several include fractional cumulative habit days, completed calendar days before joining, and projections that disagree with the documented fourteen-day rate. Comparing engine output directly would require changing the product rules or the fixtures.

## Minimal Reproducible Example

Compare progress-row08-day-one.json and progress-row15-days-only.json against the Progress contribution and obligation rules. The first contains completed calendar dates before joinedOn; the second contains fractional day totals.

## Context

The games backend needs independently reproducible scoring fixtures while preserving the board presentation examples consumed by clients.
