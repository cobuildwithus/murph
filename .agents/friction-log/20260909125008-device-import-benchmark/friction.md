---
title: 'Device import benchmark exceeds its admitted batch size'
severity: 'minor'
---

## Expected Behavior

The documented synthetic benchmark accepts history sizes up to 50,000 events and completes its replay, correction, and canonical readback checks.

## Current Behavior

The benchmark submits the entire history in one import. Above 10,000 events, the canonical integration-ingest receipt rejects the event array before the measurement reaches the incremental scenarios.

## Possible Solution

Construct the synthetic history through sequential batches of at most 8,000 events and report the number of seed batches. Preserve the existing 8,000-event comparison as a single import, and keep the runtime receipt limit unchanged.

## Minimal Reproducible Example

Bundle packages/core/bench/device-import.ts using its README instructions, then run the disposable benchmark container with MURPH_BENCH_EVENTS=50000. The import rejects the oversized receipt array with INTEGRATION_INGEST_INVALID.

## Context

This blocks the existing large-history resource stress test and can make a documented sizing scenario appear supported when it never reaches the workload under measurement. Only synthetic fixtures are involved.
