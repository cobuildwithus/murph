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
    result: { instances: [{ id: "native-fixture", current_placement: { status: { container_status: state } } }] },
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

  it("reads every dashboard page before permitting reuse and ignores inactive historical objects", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true, result: { instances: [],
        durable_objects: [{ id: "historical-object" }] }, result_info: { next_page_token: "second page" } }))
      .mockResolvedValueOnce(response("stopped"));
    await createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).assertDrained("inactive-app");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const urls = fetchImpl.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[0]?.pathname).toBe("/client/v4/accounts/fixture/containers/dash/applications/inactive-app/instances");
    expect(urls[0]?.searchParams.get("per_page")).toBe("1000");
    expect(urls[1]?.searchParams.get("page_token")).toBe("second page");
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("requests a bounded larger page while still requiring terminal drain evidence", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const largePage = new URL(String(url)).searchParams.get("per_page") === "1000";
      return Response.json({ success: true,
        result: { instances: [{ current_placement: { status: { container_status: "stopped" } } }],
          durable_objects: Array.from({ length: largePage ? 250 : 100 }, (_, index) => ({ id: `synthetic-object-${index}` })) },
        result_info: { next_page_token: largePage ? null : "synthetic-repeating-cursor" } });
    });
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .assertDrained("inactive-app")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("restarts the complete drain observation when a later page is still running", async () => {
    const firstPage = () => Response.json({ success: true, result: { instances: [] }, result_info: { next_page_token: "more" } });
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(firstPage()).mockResolvedValueOnce(response("running"))
      .mockResolvedValueOnce(firstPage()).mockResolvedValueOnce(response("stopped"));
    await createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).assertDrained("inactive-app");
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("page_token"))).toEqual([null, "more", null, "more"]);
  });

  it("waits for unplaced instances instead of treating them as drained", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true, result: { instances: [{ id: "unplaced" }] } }))
      .mockResolvedValueOnce(response("stopped"));
    await createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).assertDrained("inactive-app");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects repeated page tokens without inferring drain", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ success: true,
      result: { instances: [] }, result_info: { next_page_token: "same" } }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .assertDrained("inactive-app")).rejects.toThrow("Inactive instance pagination rejected: repeated token; page=2; nativeRows=0.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    { token: 123, reason: "non-string token" },
    { token: false, reason: "non-string token" },
    { token: { privateCursor: "synthetic-private-value" }, reason: "non-string token" },
    { token: ["synthetic-private-value"], reason: "non-string token" },
    { token: "   ", reason: "blank token" },
    { token: "synthetic-private-value".repeat(100), reason: "oversized token (length=2300)" },
  ])("explains $reason without exposing the provider cursor", async ({ token, reason }) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ success: true,
      result: { instances: [{ current_placement: { status: { container_status: "stopped" } } }] },
      result_info: { next_page_token: token } }));
    await expect(createRunnerReleaseProvider({ accountId: "synthetic-private-account",
      apiToken: "synthetic-private-secret", fetchImpl }).assertDrained("synthetic-private-application"))
      .rejects.toMatchObject({ message: `Authoritative runner release state is unavailable; deployment stopped. Inactive instance pagination rejected: ${reason}; page=1; nativeRows=1.` });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("bounds distinct pages and native rows", async () => {
    let page = 0;
    const pages = vi.fn<typeof fetch>(async () => Response.json({ success: true,
      result: { instances: [] }, result_info: { next_page_token: String(++page) } }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl: pages })
      .assertDrained("inactive-app")).rejects.toThrow("page bound");
    expect(pages).toHaveBeenCalledTimes(100);
    const rows = vi.fn<typeof fetch>(async () => Response.json({ success: true,
      result: { instances: Array.from({ length: 10_001 }, () => ({})) } }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl: rows })
      .assertDrained("inactive-app")).rejects.toThrow("unavailable");
    expect(rows).toHaveBeenCalledOnce();
  });

  it("keeps opaque page tokens and application identity out of provider failure diagnostics", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: true, result: { instances: [] }, result_info: { next_page_token: "opaque-cursor" } }))
      .mockResolvedValueOnce(Response.json({ success: false, errors: [{ code: 10001, message: "inactive-app rejected opaque-cursor" }] }, { status: 404 }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl })
      .assertDrained("inactive-app")).rejects.toThrow('Read inactive instances: HTTP 404; errors=[{"code":10001,"message":"<redacted> rejected <redacted>"}]');
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
    scheduling_policy: "default", max_instances: 12,
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
    expect(JSON.parse(String(request?.body))).toEqual({ ...specification, instances: 0, name: input.name, durable_objects: { namespace_id: input.namespaceId } });
  });

  it("reports rejected quota without retrying creation or reducing capacity", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ success: false, errors: [{ code: 400, message: "synthetic quota failure" }] }, { status: 400 }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).admitApplication({ ...input, applicationId: null })).rejects.toThrow('Create inactive application: HTTP 400; errors=[{"code":400,"message":"synthetic quota failure"}].');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).max_instances).toBe(12);
  });

  it("redacts the requested application name and image while preserving rejection details", async () => {
    const message = `Application ${input.name}, image ${specification.configuration.image}: 12 instances exceed the available limit.\nNo application created.`;
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ success: false, errors: [{ code: 1607, message, details: { private: "discarded" } }] }, { status: 400 }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "synthetic-token", fetchImpl }).admitApplication({ ...input, applicationId: null })).rejects.toMatchObject({
      message: 'Authoritative runner release state is unavailable; deployment stopped. Create inactive application: HTTP 400; errors=[{"code":1607,"message":"Application <redacted>, image <redacted>: 12 instances exceed the available limit. No application created."}].',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).max_instances).toBe(12);
  });

  it("reconciles an interrupted PATCH before rollout instead of mistaking target equality for distribution", async () => {
    const target = { ...specification, id: "candidate", version: 2, name: input.name, durable_objects: { namespace_id: input.namespaceId } };
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => init?.method !== "GET" ? envelope({ id: "native-rollout" }) : String(url).includes("/rollouts?") ? envelope([]) : envelope(target));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).admitApplication(input)).resolves.toBe("modified");
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "GET", "POST"]);
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
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
      .mockResolvedValueOnce([{ ...specification, id: "candidate", version: 2 }]);
    const fetchImpl = vi.fn<typeof fetch>(async () => envelope([{ id: "native-rollout", target_version: 2, status: "completed", target_configuration: specification.configuration }]));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).assertApplicationReady({ ...input, listApplications })).resolves.toBeUndefined();
    expect(listApplications).toHaveBeenCalledTimes(3);
  });
});

describe("native provider failure diagnostics", () => {
  const provider = (fetchImpl: typeof fetch) => createRunnerReleaseProvider({
    accountId: "private-account", apiToken: "private-token", fetchImpl,
  });

  it.each([400, 403, 429, 503])("retains HTTP %s and native rejection codes without private details", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      success: false,
      errors: [{ code: 10000, message: "SURPASSED_TOTAL_LIMITS", details: { account: "private-account" } }],
      result: { token: "private-token" },
    }, { status }));
    await expect(provider(fetchImpl).readAccountLimits()).rejects.toMatchObject({
      message: `Authoritative runner release state is unavailable; deployment stopped. Read account limits: HTTP ${status}; errors=[{"code":10000,"message":"SURPASSED_TOTAL_LIMITS"}].`,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retains an unsuccessful API envelope even when HTTP succeeds", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      success: false, errors: [{ code: 10000, message: "VALIDATE_INPUT" }],
    }));
    await expect(provider(fetchImpl).readAccountLimits()).rejects.toThrow('HTTP 200; errors=[{"code":10000,"message":"VALIDATE_INPUT"}]');
  });

  it("preserves actionable provider prose while redacting known credentials and identifiers", async () => {
    const resource = "a".repeat(32);
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      success: false,
      errors: [null, { code: 1607, message: `Account private-account cannot admit 12 instances. Token private-token; namespace ${resource}; contact ops@example.test.`, details: { private: "unpublished body" } }],
      result: { private: "unpublished result" },
    }, { status: 400 }));
    await expect(provider(fetchImpl).readAccountLimits()).rejects.toMatchObject({
      message: 'Authoritative runner release state is unavailable; deployment stopped. Read account limits: HTTP 400; errors=[{"code":1607,"message":"Account <redacted> cannot admit 12 instances. Token <redacted>; namespace <redacted-resource>; contact <redacted-email>."}].',
    });
  });

  it("bounds messages and error count and excludes malformed code values", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      success: false,
      errors: [...Array.from({ length: 5 }, () => ({ code: "private-token", message: "A".repeat(400) })), { code: 999, message: "EXCLUDED" }],
    }, { status: 400 }));
    await expect(provider(fetchImpl).readAccountLimits()).rejects.toMatchObject({
      message: `Authoritative runner release state is unavailable; deployment stopped. Read account limits: HTTP 400; errors=${JSON.stringify(Array.from({ length: 5 }, () => ({ code: null, message: "A".repeat(320) })))}.`,
    });
  });

  it("reports invalid JSON with the known HTTP status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("private response", { status: 502 }));
    await expect(provider(fetchImpl).readAccountLimits()).rejects.toMatchObject({ message: "Authoritative runner release state is unavailable; deployment stopped. Read account limits: HTTP 502; invalid JSON response." });
  });

  it("identifies a transport failure without exposing its raw exception", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("private-account private-token"); });
    await expect(provider(fetchImpl).readAccountLimits()).rejects.toMatchObject({ message: "Authoritative runner release state is unavailable; deployment stopped. Read account limits: request failed before a response." });
  });
});

describe("single-fleet rollout recovery", () => {
  const configuration = { image: `registry.example.test/runner@sha256:${"a".repeat(64)}`, vcpu: 2, memory_mib: 6144, disk: { size_mb: 6000 }, observability: { logs: { enabled: true } }, wrangler_ssh: { enabled: false } };
  const specification = { configuration, max_instances: 748, scheduling_policy: "default", constraints: { tiers: [1, 2] }, rollout_active_grace_period: 300 };
  const input = { applicationId: "serving", name: "serving-app", namespaceId: "serving-namespace", specification };
  const live = { ...specification, id: input.applicationId, name: input.name, durable_objects: { namespace_id: input.namespaceId }, version: 5 };
  const envelope = (result: unknown) => Response.json({ success: true, result });

  it.each(["progressing", "completed"])("reconciles an accepted rollout after a lost response: %s", async status => {
    const rollout = { id: "rollout-fixture", current_version: 4, target_version: 5, status, target_configuration: configuration };
    const fetchImpl = vi.fn<typeof fetch>(async url => String(url).includes("/rollouts")
      ? envelope(status === "completed" ? [rollout] : rollout)
      : envelope({ ...live, ...(status === "progressing" ? { active_rollout_id: rollout.id, version: 4, configuration: { ...configuration, image: "old-image" } } : {}) }));
    const provider = createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl });
    await expect(provider.admitApplication(input)).resolves.toBe(status === "completed" ? "unchanged" : "modified");
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("refuses to replace an active rollout for another image", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async url => String(url).includes("/rollouts")
      ? envelope({ id: "other-rollout", current_version: 4, target_version: 5, status: "progressing", target_configuration: { ...configuration, image: "other-image" } })
      : envelope({ ...live, active_rollout_id: "other-rollout" }));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).admitApplication(input)).rejects.toThrow("does not match");
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("passes gradual steps to native rollout after updating the application", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => envelope(init?.method === "GET"
      ? { ...live, configuration: { ...configuration, image: "old-image" } } : {}));
    await createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).admitApplication({ ...input, rolloutStepPercentage: [10, 25, 50, 100] });
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "PATCH", "POST"]);
    expect(JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ strategy: "rolling", kind: "full_auto", steps: [10, 25, 50, 100].map(percentage => ({ step_size: { percentage }, description: expect.any(String) })) });
  });

  it.each([0, 1, 2])("accounts for smoke and every other application before expansion (other=%s)", async others => {
    const fetchImpl = vi.fn<typeof fetch>(async url => envelope(String(url).endsWith("/me")
      ? { limits: { total_vcpu: 1500, total_memory_mib: 6_000_000, total_disk_mb: 6_000_000 } }
      : [{ ...live, max_instances: 324 }, { id: "retired", configuration, max_instances: 0 }, { id: "smoke", configuration, max_instances: 1 }, { id: "unrelated", configuration, max_instances: others }]));
    const work = createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).assertCapacity(input);
    if (others <= 1) await expect(work).resolves.toBeUndefined();
    else await expect(work).rejects.toThrow("exceeds the measured");
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("does not retire a pool whose stopped observation changed before mutation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async url => envelope(String(url).includes("/instances?")
      ? { instances: [{ current_placement: { status: { container_status: "running" } } }] } : live));
    await expect(createRunnerReleaseProvider({ accountId: "fixture", apiToken: "fixture", fetchImpl }).retireApplication(input)).rejects.toThrow("not drained");
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
});
