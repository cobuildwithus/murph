---
title: 'Food search timing fixture cannot reproduce live labels-database timeouts'
severity: 'minor'
issue: 'cobuildwithus/murph#4774'
---

## Expected Behavior

The large-catalog food search test fails when a query shape cannot finish
inside the eight-second labels database statement timeout on the live catalog.

## Current Behavior

The fixture holds 250,000 short synthetic names in a warm local PostgreSQL. A
whole-catalog trigram distance scan finishes there in well under a second, so
the test passed while the same query shape took 20 to 30 seconds on the live
two-million-row catalog and every such search returned HTTP 500.

## Possible Solution

Assert plan shape rather than wall time: no name-index scan without a
similarity index condition, and bounded rows fetched per scan. Keep a
documented read-only timing recipe for the configured labels database.

## Minimal Reproducible Example

Run the large-catalog food search test against the pre-fix query: it passes.
Run one no-full-text-match search against a production-sized catalog with cold
storage: it exceeds the statement timeout.

## Context

Diagnosing repeated food label lookup HTTP 500 responses during meal logging.
