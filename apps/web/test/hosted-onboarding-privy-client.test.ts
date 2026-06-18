import { describe, expect, it } from "vitest";

import { readHostedPrivyClientSessionState } from "@/src/lib/hosted-onboarding/privy-client";

describe("hosted Privy client session state", () => {
  it("treats missing or partially hydrated user state as indeterminate", () => {
    expect(readHostedPrivyClientSessionState({ user: null })).toBeNull();
    expect(readHostedPrivyClientSessionState({ user: {} })).toBeNull();
  });

  it("reads verified phone state without requiring wallet state", () => {
    expect(
      readHostedPrivyClientSessionState({
        user: {
          linkedAccounts: [
            {
              latest_verified_at: 1741194420,
              phone_number: "+1 415 555 2671",
              type: "phone",
            },
          ],
        },
      }),
    ).toMatchObject({
      phone: {
        number: "+14155552671",
        verifiedAt: 1741194420,
      },
    });
  });

  it("reports a hydrated non-phone session so callers can choose recovery UI", () => {
    expect(
      readHostedPrivyClientSessionState({
        user: {
          linkedAccounts: [
            {
              address: "person@example.test",
              latest_verified_at: 1741194420,
              type: "email",
            },
          ],
        },
      }),
    ).toMatchObject({
      phone: null,
    });
  });
});
