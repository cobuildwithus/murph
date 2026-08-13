---
title: 'Changelog content updates contend on a production-coupled design-study test'
severity: 'minor'
issue: 'cobuildwithus/murph#1667'
---

## Expected Behavior

A structured changelog entry should be validated by its registry contract and the data-driven page renderer without editing shared design-study fixtures or repeating production titles in one central page test.

## Current Behavior

The archive design study imports the production changelog registry, filters it through a hand-maintained item-ID set, and the page test repeats the selected titles. Independent changelog entries therefore edit the same set and assertion block, causing mechanical merge conflicts unrelated to renderer behavior.

## Possible Solution

Keep the archive study synthetic, exercise its visual and try-it states with synthetic props, and leave production-entry copy assertions with the changelog registry tests that own the content.

## Minimal Reproducible Example

1. Add one structured changelog entry on each of two branches.
2. Add both IDs to the production-item set in the archive study.
3. Add both titles to the shared archive-study assertion block.
4. Merge either branch, then merge the other and observe a conflict in the shared assertion block.

## Context

This repeatedly delays otherwise independent changelog and runtime pull requests while adding no new rendering coverage.
