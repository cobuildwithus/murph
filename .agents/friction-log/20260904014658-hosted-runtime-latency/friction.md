---
title: 'Hosted runtime latency PostgreSQL correctness proof is coupled to a large stress fixture'
severity: 'minor'
issue: 'cobuildwithus/murph#2804'
---

## Expected Behavior

Focused latency-query correctness changes should have a fast PostgreSQL proof that is independent of the large candidate-cap stress fixture.

## Current Behavior

The existing proof combines 50,000-row stale-history setup, query-plan assertions, and a 20,001-row candidate-cap check in one transaction. On slower local runs it exceeded both the default 60-second test timeout and a temporary 120-second test timeout.

## Possible Solution

Keep the large plan and cap test for stress coverage, but add or split out small correctness cases so query semantics can be verified quickly. If the stress case has a canonical local runner, give that runner a budget appropriate for the fixture.

## Minimal Reproducible Example

Run the full hosted runtime latency candidate-query PostgreSQL test file against an isolated local database on a slower machine. The combined stress case does not finish within 120 seconds.

## Context

This makes narrow query changes expensive to validate locally and obscures whether a timeout reflects query correctness or only fixture scale.
