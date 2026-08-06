import { describe, expect, it } from "vitest";

import {
  readAllowedHostedLinqOperation,
} from "../src/runner-egress-linq-policy.ts";

describe("hosted Linq egress policy", () => {
  it("admits only the exact documented iMessage capability route", () => {
    expect(
      readAllowedHostedLinqOperation("POST", "/capability/check_imessage"),
    ).toBe("check_imessage_capability");
    expect(
      readAllowedHostedLinqOperation("GET", "/capability/check_imessage"),
    ).toBeNull();
    expect(
      readAllowedHostedLinqOperation(
        "POST",
        "/capability/check_imessage/extra",
      ),
    ).toBeNull();
  });
});
