---
title: 'Notification history fixture loses configured receipts after an earlier reader import'
severity: 'minor'
issue: 'cobuildwithus/murph#4858'
---

## Expected Behavior

Notification-turn tests should supply the same synthetic accepted-delivery receipts whether their history reader is imported before or after harness setup.

## Current Behavior

The test setup registers an empty outbox reader and the harness later replaces that module mock. An already-imported history reader keeps the first function and receives no receipts. Two allowed-skip variants then fail their accepted-message assertions while the required-send case remains valid.

## Minimal Reproducible Example

In the notification accepted-delivery-context cases, import the actual notification-history module after the default setup and before loading the notification-turn harness. Both allowed-skip cases fail with the original double registration. Keep one typed mock function, reset it between cases, and configure its return data before the harness runs to preserve imported references.

## Context

This test-only import-order defect blocked unrelated repository-tool CI. Preserve all accepted-delivery, audience and required-send assertions; no production changes are needed.
