---
title: 'Release app verification stalls under forced app overlap'
severity: 'major'
issue: 'cobuildwithus/murph#2656'
---

## Expected Behavior

The required Ubuntu app-verification shard completes within its observed release window and bounds resource use when hosted Web and Cloudflare verification share one runner.

## Current Behavior

The workflow forces both app owners to run concurrently. In two consecutive exact-head attempts, Cloudflare Node verification stopped after the same three runner-project files while the concurrent Next build peaked at 10.45 GiB. Web later passed, but the parent waited indefinitely for Cloudflare; one attempt ran for 106 minutes and the second for 49 minutes before exact cancellation. Both app lanes pass on the same head locally, including Cloudflare with CI semantics.

## Possible Solution

Run the two app owners serially on the two-core Ubuntu runner and give the app-verification job a bounded timeout. Preserve parallelism within each owner where its existing harness already controls it.

## Minimal Reproducible Example

Run the required host-support app job on a Ready pull request with `MURPH_APP_VERIFY_PARALLEL=1`, `MURPH_VERIFY_STEP_PARALLEL=1`, and the dedicated supplement-search database enabled. Inspect the completed step log: the Cloudflare runner project stops scheduling files while the overlapping Next build memory guard exceeds its modeled budget.

## Context

This blocks the required Release checks aggregator and therefore prevents otherwise green, reviewed pull requests from merging.
