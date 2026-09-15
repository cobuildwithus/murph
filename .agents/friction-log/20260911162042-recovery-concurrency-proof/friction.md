---
title: 'Recovery concurrency proof assumes one scheduling-dependent rejection status'
severity: 'minor'
---

## Expected Behavior

The canonical recovery concurrency proof accepts exactly one winner and verifies that the saved key is consumed and only the winner's factor remains.

## Current Behavior

The test requires the loser to reach the transactional credential-generation conflict. A competing request can instead read after the winner commits and reject the already-consumed recovery key before entering that transaction. Both paths reject the loser, but the latter fails the test's status-only expectation.

## Minimal Reproducible Example

Run the canonical member PostgreSQL suite against an admitted isolated local test database with concurrency tests enabled. Concurrent recovery requests can interleave before or after the recovery-proof read.

## Possible Solution

Accept either existing rejection status while retaining exactly one success, the winner's factor identity, and explicit recovery-key consumption assertions.

## Context

The mismatch blocks release PostgreSQL verification without demonstrating an application authority failure.
