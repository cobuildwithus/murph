---
title: 'ReviewGPT accepted sends lose waited capture while the conversation URL settles'
severity: 'minor'
issue: 'cobuildwithus/murph#4839'
---

## Expected Behavior

The repository review command should continue capturing the same accepted review when the initial chat page receives its canonical conversation URL shortly after submission. Exact turn, attachment, requested model and completion validation must remain intact.

## Current Behavior

Two full-snapshot review submissions completed staging and persisted committed-turn metadata, then the waited command exited while the conversation URL was still pending. The reviews continued normally. Recovering them required finding each original target's canonical URL, using the exact-metadata thread exporter, and manually pacing completion checks. Model selection was confirmed before submission, but the early exit skipped the ordinary sent-model evidence log.

## Possible Solution

Keep the existing accepted-turn receipt and boundedly resolve the original target's URL before leaving waited capture. Persist any already-observed sent-model evidence before reporting a recoverable URL failure. Never resend an accepted prompt to repair capture.

## Minimal Reproducible Example

Run the repository's guarded full-snapshot PR review with --wait against a clean pushed candidate. If submission commits before the URL changes from the initial chat page, observe that capture stops although the original target later displays the completed review. Recover with thread export using the unchanged capture metadata and the canonical URL of that exact target.

## Context

This affected completion of a repository architecture cleanup. No member data, source behavior, or production access is involved. Existing entries for disabled Send, terminal generation errors and metadata cleanup do not describe this accepted-send URL race.
