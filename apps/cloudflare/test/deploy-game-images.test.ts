import { describe, expect, it, vi } from "vitest";
import { assertPrivateGameImageVariants } from "../scripts/deploy-game-images.ts";

const source = { CLOUDFLARE_ACCOUNT_ID: "synthetic-account", CLOUDFLARE_API_TOKEN: "synthetic-token" };
const variant = (id: string, pixels: number) => ({ id, neverRequireSignedURLs: false,
  options: { width: pixels, height: pixels, fit: "scale-down", metadata: "none" } });
const privateVariants = () => ({ "gameavatar": variant("gameavatar", 600), "gamephoto": variant("gamephoto", 1600) });
const response = (variants: unknown) => Response.json({ success: true, result: { variants } });

describe("private game Images deploy admission", () => {
  it("admits the private fixed renditions with a bounded authenticated read", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(privateVariants()));
    await assertPrivateGameImageVariants(source, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/synthetic-account/images/v1/variants",
      expect.objectContaining({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal),
        headers: { authorization: "Bearer synthetic-token", accept: "application/json" } }),
    );
  });

  it("rejects a public bypass even on an unrelated variant", async () => {
    await expect(assertPrivateGameImageVariants(source, async () => response({ ...privateVariants(),
      public: { ...variant("public", 100), neverRequireSignedURLs: true },
    }))).rejects.toThrow("bypasses private delivery");
  });

  it.each([
    {},
    { ...privateVariants(), "gamephoto": variant("gamephoto", 600) },
    { ...privateVariants(), "gameavatar": { ...variant("gameavatar", 600), options: { ...variant("gameavatar", 600).options, metadata: "keep" } } },
  ])("rejects missing or unsafe renditions", async variants => {
    await expect(assertPrivateGameImageVariants(source, async () => response(variants))).rejects.toThrow("missing or misconfigured");
  });

  it.each([null, [], { success: false }, { success: true, result: { variants: [] } }])("fails closed on malformed responses", async payload => {
    await expect(assertPrivateGameImageVariants(source, async () => Response.json(payload))).rejects.toThrow("invalid variants response");
  });

  it("does not expose provider errors or credential material", async () => {
    await expect(assertPrivateGameImageVariants(source, async () => { throw new Error("synthetic-token private-provider-detail"); }))
      .rejects.toThrow(/^Game Images admission failed: cannot read account variants; verify Images Read permission\.$/u);
    await expect(assertPrivateGameImageVariants(source, async () => new Response("private-provider-detail", { status: 403 })))
      .rejects.toThrow("cannot read account variants");
  });
});
