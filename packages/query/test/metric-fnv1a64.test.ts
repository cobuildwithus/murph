import { expect, it } from "vitest";

import { fnv1a64Hex } from "../src/metrics/fnv1a64.ts";

function bigIntFnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

it("matches the published 64-bit FNV-1a vectors", () => {
  expect(fnv1a64Hex("")).toBe("cbf29ce484222325");
  expect(fnv1a64Hex("a")).toBe("af63dc4c8601ec8c");
  expect(fnv1a64Hex("foobar")).toBe("85944171f73967e8");
});

it("matches 64-bit integer arithmetic for every UTF-16 code unit and long inputs", () => {
  let seed = 0x2f6e2b1;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const inputs = [
    "\uffff\uffff\uffff",
    "\u{1f600} na\u00efve \u2713",
    "x".repeat(4096),
    JSON.stringify(["resting-heart-rate", "2026-01-01T00:00:00Z", "2026-01-01", "day", "mean", 52, "bpm"]),
  ];
  for (let count = 0; count < 2000; count += 1) {
    let input = "";
    for (let length = next() % 96; length > 0; length -= 1) {
      input += String.fromCharCode(next() % (next() % 5 === 0 ? 0x10000 : 0x80));
    }
    inputs.push(input);
  }
  for (const input of inputs) {
    expect(fnv1a64Hex(input)).toBe(bigIntFnv1a64Hex(input));
  }
});
