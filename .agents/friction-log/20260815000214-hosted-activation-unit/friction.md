---
title: 'Hosted activation unit fixture does not exercise foreground conversation admission'
severity: 'minor'
issue: 'cobuildwithus/murph#1885'
---

## Expected Behavior

A synthetic hosted-runtime fixture for the first activation plus conversation prefix should enter the foreground assistant branch and prove the activation import occurs before that branch begins.

## Current Behavior

The existing fixture proves only that the activation is imported before idle checkpointing. It does not create runnable conversation work, so it remains green when the foreground branch returns before importing the activation.

## Possible Solution

Provide a reusable fixture helper that stages runnable conversation input and starts the runtime from the matching foreground wake without requiring the full hosted-local stack.

## Minimal Reproducible Example

Create synthetic conversation sequence 1 and system `member.activated` sequence 1 in one prefetch, run the workspace entrypoint, and assert the system import precedes assistant phase 1.

## Context

A cross-repository hosted-local scenario caught an ordering gap that the focused assistant-runtime fixture was intended to cover.
