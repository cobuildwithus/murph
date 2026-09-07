import { describe, expect, it, vi } from "vitest";
import { createRunnerReleaseProvider } from "../scripts/runner-release-provider.ts";

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));

describe("native account capacity evidence", () => {
  it("reads the account's actual quota and excludes unrelated private fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      result: {
        external_account_id: "private-fixture",
        defaults: { privateFixture: true },
        limits: { total_vcpu: 80, total_memory_mib: 240_000, total_disk_mb: 480_000 },
      },
    })));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .readAccountLimits()).resolves.toEqual({ vcpu: 80, memoryMiB: 240_000, diskMB: 480_000 });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.cloudflare.com/client/v4/accounts/fixture/containers/me");
  });

  it.each([undefined, null, {}, { total_vcpu: 0 }, { total_vcpu: "80" }])(
    "does not substitute published defaults for missing or invalid account limits: %s", async (limits) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        success: true, result: { limits },
      })));
      await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
        .readAccountLimits()).rejects.toThrow("unavailable");
    },
  );
});

describe("inactive runner target drain admission", () => {
  const response = (state: string) => new Response(JSON.stringify({
    success: true,
    result: [{ current_placement: { status: { container_status: state } } }],
  }));

  it("permits reuse only when the provider reports stopped instances", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response("stopped"));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .assertDrained("inactive-app")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(["running", "stopping", "unknown"])("keeps %s instances protected until they stop", async (state) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(state))
      .mockResolvedValueOnce(response("stopped"));
    const work = createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .assertDrained("inactive-app");
    await work;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not infer a drained target from failed or incomplete provider evidence", async () => {
    for (const body of [{ success: false }, { success: true, result: {} }, {
      success: true, result: [], result_info: { next_page_token: "next-page" },
    }]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
      await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
        .assertDrained("inactive-app")).rejects.toThrow("unavailable");
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
});

describe("native candidate admission", () => {
  const specification = {
    scheduling_policy: "default", instances: 0, max_instances: 12,
    configuration: { image: `registry.example.test/runner@sha256:${"a".repeat(64)}`, vcpu: 2, memory_mib: 4096, disk: { size_mb: 6000 }, observability: { logs: { enabled: true } }, wrangler_ssh: { enabled: false } },
    constraints: { tiers: [1, 2] }, rollout_active_grace_period: 300,
  };
  const input = { applicationId: "candidate", namespaceId: "candidate-namespace", name: "candidate-app", specification };
  const envelope = (result: unknown) => Response.json({ success: true, result });

  it("creates the exact namespace-backed application at its requested serving ceiling", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => envelope({ id: "new-candidate" }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).admitApplication({ ...input, applicationId: null })).resolves.toBe("created");
    const [, request] = fetchImpl.mock.calls[0]!;
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({ ...specification, name: input.name, durable_objects: { namespace_id: input.namespaceId } });
  });

  it("reports rejected quota without retrying creation or reducing capacity", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ success: false, errors: [{ code: 400, message: "synthetic quota failure" }] }, { status: 400 }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).admitApplication({ ...input, applicationId: null })).rejects.toThrow("unavailable");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).max_instances).toBe(12);
  });

  it("reconciles an interrupted PATCH before rollout instead of mistaking target equality for distribution", async () => {
    const target = { ...specification, name: input.name, durable_objects: { namespace_id: input.namespaceId } };
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => init?.method === "GET" ? envelope(target) : envelope({ id: "native-rollout" }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).admitApplication(input)).resolves.toBe("modified");
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "PATCH", "POST"]);
    expect(String(fetchImpl.mock.calls[2]?.[0])).toMatch(/\/candidate\/rollouts$/u);
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toMatchObject({ target_configuration: specification.configuration, step_percentage: 100 });
  });

  it("rejects an application bound to a different namespace before mutation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => envelope({ ...specification, name: input.name, durable_objects: { namespace_id: "serving-namespace" } }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).admitApplication(input)).rejects.toThrow("unavailable");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("waits for native distribution completion and exact image/configuration before allowing a Worker switch", async () => {
    const listApplications = vi.fn()
      .mockResolvedValueOnce([{ ...specification, active_rollout_id: "pending" }])
      .mockResolvedValueOnce([{ ...specification, configuration: { ...specification.configuration, image: "old-image" } }])
      .mockResolvedValueOnce([specification]);
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture" }).assertApplicationReady({ ...input, listApplications })).resolves.toBeUndefined();
    expect(listApplications).toHaveBeenCalledTimes(3);
  });
});
