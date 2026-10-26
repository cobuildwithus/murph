import assert from "node:assert/strict";
import { test } from "vitest";

import * as eventRead from "@murphai/core/event-read";
import { readEvent, readOwnedEvent } from "../src/index.ts";

test("event-read exposes only the existing canonical readers", () => {
  assert.deepEqual(Object.keys(eventRead).sort(), ["readEvent", "readOwnedEvent"]);
  assert.equal(eventRead.readEvent, readEvent);
  assert.equal(eventRead.readOwnedEvent, readOwnedEvent);
});
