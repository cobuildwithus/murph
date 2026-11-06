// Incident rules supplied for regression proof; no production member data.
export const AUGUST_PHONE_BARRIERS = [
  { id: "rule_temporary_phone_call_writer_cutover_admission_pause_pBrbWE", name: "Temporary phone-call writer cutover admission pause", active: true,
    action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
    conditionGroup: [{ conditions: [{ type: "path", op: "eq", value: "/api/internal/phone-calls" }] }] },
  { id: "rule_temporary_phone_call_writer_cutover_result_ingress_freeze_aTR79O", name: "Temporary phone-call writer cutover result-ingress freeze", active: true,
    action: { mitigate: { action: "deny", rateLimit: null, redirect: null, actionDuration: null } },
    conditionGroup: [{ conditions: [{ type: "path", op: "eq", value: "/api/retell/webhook" }] }] },
];

const path = (op: string, value: string) => ({ type: "path", op, value });
const post = { type: "method", op: "eq", value: "POST" };
const rateLimit = (id: string, groups: unknown[][], limit: number, window = 60, keys = ["ip"]) => ({
  id, active: true, valid: true, validationErrors: null,
  action: { mitigate: { action: "rate_limit", actionDuration: null, redirect: null,
    rateLimit: { action: "rate_limit", algo: "fixed_window", keys, limit, window } } },
  conditionGroup: groups.map((conditions) => ({ conditions })),
});

// v8 rule shapes inspected read-only; administrative identities omitted.
export const PUBLIC_FIREWALL_V8 = {
  version: 8, firewallEnabled: true, ips: [], changes: [],
  crs: Object.fromEntries(["gen", "java", "lfi", "ma", "php", "rce", "rfi", "sd", "sf", "sqli", "xss"].map((key) => [key, {
    action: "log", active: ["gen", "rce", "sqli", "xss"].includes(key),
  }])),
  rules: [
    rateLimit("public-diagnostics", [[path("eq", "/api/device-sync/companion/auth-diagnostics")]], 30),
    rateLimit("public-search", [[path("eq", "/api/public/v1/products/search"), post]], 30),
    rateLimit("public-detail", [[path("pre", "/api/public/v1/products/"), { ...path("eq", "/api/public/v1/products/search"), neg: true }], [path("pre", "/search/products/")]], 120),
    rateLimit("public-pairing", [[path("eq", "/api/vault-sync/agent/session/exchange"), post]], 10, 600, ["ip", "ja4"]),
    rateLimit("public-referral", [[path("pre", "/r/"), path("suf", "/claim"), post]], 10),
  ],
};
