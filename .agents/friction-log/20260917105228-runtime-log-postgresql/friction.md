---
title: 'Runtime-log PostgreSQL teardown races pool disconnection'
severity: 'minor'
---

## Expected Behavior

The isolated runtime-log concurrency suite closes its connections and drops its synthetic database without unhandled errors.

## Current Behavior

The installed pg-pool resolves end() after removing clients from its array, before their asynchronous disconnect callbacks finish. Immediate DROP DATABASE WITH (FORCE) can terminate those closing connections with PostgreSQL error 57P01. CI reported all assertions passing but failed on the unhandled error.

## Possible Solution

Use ordinary DROP DATABASE after pool.end(), allowing PostgreSQL to wait for the disconnects instead of forcibly terminating them.

## Minimal Reproducible Example

Create an isolated synthetic local database. Open eight pg.Pool connections concurrently with SELECT 1, await pool.end(), then immediately drop the database WITH (FORCE). A 20-round local reproduction observed one 57P01 error; the same 20 rounds without FORCE had zero errors. All rounds observed pool.end() resolving before all remove events.

## Context

Release Web PostgreSQL verification was blocked during runtime retirement work. The task includes the ordinary-drop fix and focused suite validation.
