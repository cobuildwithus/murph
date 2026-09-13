---
title: 'Hosted release proof deadline includes runner queue time'
severity: 'minor'
---

## Expected Behavior

A protected release proof should distinguish waiting for a GitHub runner from executing its bounded checks, while keeping credential expiry, cancellation settlement, and total resource use bounded.

## Current Behavior

The compatibility controller starts one forty-minute private-run deadline immediately after dispatch. The private production proof then queues setup jobs, two builds, reader checks, and scenario jobs. Queue time can consume the proof window and cause the controller to cancel correctly running scenarios before they produce a result. The caller reports a timeout without distinguishing time spent queued from a test failure. A token lifetime budget is separate but does not extend the private-run deadline.

## Possible Solution

Inspect the existing admission and execution budget owners together. Preserve exact candidate identity and fail-closed proof, report phase-specific delay, and ensure the admitted work has a bounded feasible execution window. Do not add an unbounded retry or weaken required scenarios.

## Minimal Reproducible Example

Use an injected clock and mocked GitHub responses with the existing controller: dispatch one accepted private run, return queued jobs for most of the run budget, then return running scenario jobs whose individual timeouts have not expired. Advance the clock to the controller deadline. Observe cancellation before a scenario verdict even though no job has failed. Cover token expiry and cancellation settlement independently.

## Context

This release-tooling behavior can delay a necessary consumer-first rollout and force operators to interrupt unrelated CI to obtain runner capacity. The report uses a synthetic scheduling sequence and contains no production records.
