import { describe, expect, it } from "vitest";

import {
  readAllowedHostedLinqOperation,
} from "../src/runner-egress-linq-policy.ts";

describe("hosted Linq egress policy", () => {
  it("admits only the exact documented iMessage capability route", () => {
    expect(
      readAllowedHostedLinqOperation("POST", "/capability/check_imessage"),
    ).toBe("check_imessage_capability");

    for (const [method, path] of [
      ["GET", "/capability/check_imessage"],
      ["PUT", "/capability/check_imessage"],
      ["POST", "/capability/check_imessage/"],
      ["POST", "/capability/check_imessage/extra"],
      ["POST", "/capability/check_rcs"],
    ] as const) {
      expect(
        readAllowedHostedLinqOperation(method, path),
        `${method} ${path}`,
      ).toBeNull();
    }
  });
});
