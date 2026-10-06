import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { GET } from "../app/companion/telegram-return/route";

describe("Telegram recipient return handoff", () => {
  it.each(["", "token=bad&proof=bad", `token=${"a".repeat(43)}&proof=${"b".repeat(43)}&proof=extra`, "token=<script>&proof=javascript:alert(1)"])("fails closed for malformed fragments: %s", async (hash) => {
    const { button, status } = await render(hash);
    expect(button.hidden).toBe(true);
    expect(button.href).toBeUndefined();
    expect(status.textContent).toContain("start a new connection");
  });

  it("removes browser history proof and opens only the fixed native destination", async () => {
    const fields = `token=${"a".repeat(43)}&proof=${"b".repeat(43)}`;
    const { button, history, response } = await render(fields);
    expect(button).toEqual({ hidden: false, href: `murph-messaging://telegram/complete#${fields}` });
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/companion/telegram-return");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

async function render(hash: string) {
  const response = GET();
  const html = await response.text();
  const button: { hidden: boolean; href?: string } = { hidden: true };
  const status = { textContent: "" };
  const history = { replaceState: vi.fn() };
  const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
  if (!script) throw new Error("Missing return script");
  runInNewContext(script, { URLSearchParams, history, location: { hash: `#${hash}`, pathname: "/companion/telegram-return" }, document: { getElementById: (id: string) => id === "return" ? button : status } });
  return { button, status, history, response };
}
