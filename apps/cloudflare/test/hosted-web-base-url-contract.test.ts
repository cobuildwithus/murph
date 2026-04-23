import { describe, expect, it } from "vitest";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

describe("hosted web base URL contract", () => {
  it("rejects a hosted web base url with a non-root path", () => {
    expect(() =>
      readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
      })),
    ).toThrow(/must not include a path/u);
  });
});
