import { describe, expect, it } from "vitest";

import {
  armHostedGroupStartHandoff,
  clearHostedGroupStartHandoff,
  consumeHostedGroupStartHandoff,
} from "../src/lib/hosted-groups/group-start-handoff";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("Hosted group-start browser handoff", () => {
  it("is consumed exactly once in the same browser tab", () => {
    const storage = createStorage();
    armHostedGroupStartHandoff({
      now: new Date("2026-07-31T04:00:00.000Z"),
      storage,
    });

    expect(consumeHostedGroupStartHandoff({
      now: new Date("2026-07-31T04:15:00.000Z"),
      storage,
    })).toBe(true);
    expect(consumeHostedGroupStartHandoff({
      now: new Date("2026-07-31T04:15:00.000Z"),
      storage,
    })).toBe(false);
  });

  it("rejects expired or malformed handoffs", () => {
    const storage = createStorage();
    armHostedGroupStartHandoff({
      now: new Date("2026-07-31T04:00:00.000Z"),
      storage,
    });
    expect(consumeHostedGroupStartHandoff({
      now: new Date("2026-08-01T04:00:00.000Z"),
      storage,
    })).toBe(false);

    storage.setItem("murph:group-start-handoff:v1", "not-json");
    expect(consumeHostedGroupStartHandoff({ storage })).toBe(false);
  });

  it("can be cleared when setup finishes without checkout", () => {
    const storage = createStorage();
    armHostedGroupStartHandoff({ storage });
    clearHostedGroupStartHandoff({ storage });
    expect(consumeHostedGroupStartHandoff({ storage })).toBe(false);
  });
});
