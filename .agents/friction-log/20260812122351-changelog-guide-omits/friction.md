---
title: 'Changelog guide omits the list marker required by CI'
severity: 'minor'
issue: 'cobuildwithus/murph#1742'
---

## Expected Behavior

The completion guide and pull-request validation should require the same
changelog declaration syntax.

## Current Behavior

The guide describes a single `Changelog: updated` or
`Changelog: not applicable` disposition, but the validation script accepts it
only as a Markdown list item. Following the prose literally causes the frontend
design-proof check to fail after the pull request is opened.

## Possible Solution

Show the required leading `- ` in the guide's canonical examples and add a
focused documentation-contract test that compares the documented forms with
the validator.

## Minimal Reproducible Example

1. Create a pull-request body with one unbulleted `Changelog: updated` line,
   following the completion guide.
2. Run the frontend design-proof validation against that body.
3. Observe that it reports no changelog bullet even though the documented
   disposition is present.

## Context

This creates an avoidable CI round and a pull-request metadata edit for
otherwise valid changelog-bearing work.
