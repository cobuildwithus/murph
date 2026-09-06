---
title: 'Codex egress inventory misses Linux linker tokens during macOS upgrades'
severity: 'minor'
issue: 'cobuildwithus/murph#2959'
---

## Expected Behavior

A pinned Codex upgrade should classify the Linux runner artifact's conservative route candidates before CI, even when local verification runs on macOS.

## Current Behavior

The source-reviewed provider routes and macOS binary conformance passed for Codex 0.153.4. The Linux binary exposed two different concatenated printable tokens, causing the otherwise passing Cloudflare suite to fail its explicit-disposition assertion.

## Possible Solution

Check the pinned Linux artifact alongside the host binary during future Codex upgrades. Keep unknown-route discovery strict and record exact source-reviewed false positives rather than broadly trimming route prefixes.

## Minimal Reproducible Example

Run the Codex egress conformance test on macOS and Linux with the same 0.153.4 lockfile before the additional Linux candidate classifications. Only the Linux artifact exposes the new linker strings.

## Context

The correction adds exact non-provider classifications to the existing test inventory. It does not change production egress policy or permit new routes.
