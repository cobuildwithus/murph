import { describe, expect, it } from "vitest";

import { readHostedExecutionDispatchEnvironment } from "@/src/lib/hosted-execution/env";

describe("readHostedExecutionDispatchEnvironment", () => {
  it("normalizes the dispatch url and optional secret", () => {
    const environment = readHostedExecutionDispatchEnvironment({
      HOSTED_EXECUTION_DISPATCH_URL: "https://runner.example.test/",
      HOSTED_EXECUTION_SIGNING_SECRET: "secret",
    });

    expect(environment.dispatchUrl).toBe("https://runner.example.test");
    expect(environment.signingSecret).toBe("secret");
  });

  it("accepts the recovered Cloudflare env aliases", () => {
    const environment = readHostedExecutionDispatchEnvironment({
      HOSTED_EXECUTION_CLOUDFLARE_BASE_URL: "https://runner.example.test/",
      HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "secret",
    });

    expect(environment.dispatchUrl).toBe("https://runner.example.test");
    expect(environment.signingSecret).toBe("secret");
  });
});
