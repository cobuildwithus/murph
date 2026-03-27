import type { Metadata } from "next";

import { HostedPhoneAuth } from "@/src/components/hosted-onboarding/hosted-phone-auth";
import { hasHostedPrivyPhoneAuthConfig, resolveHostedSignupPhoneNumber } from "@/src/lib/hosted-onboarding/landing";

export const metadata: Metadata = {
  title: "Healthy Bob",
  description: "Your personal health assistant.",
};

const featureItems = [
  {
    title: "Ask in plain English",
    body: "Get help understanding your health without turning your life into a spreadsheet.",
  },
  {
    title: "Sync your wearables",
    body: "Bring in signals from tools like Oura and WHOOP so the picture stays current.",
  },
  {
    title: "Remember what helps",
    body: "Keep track of meals, routines, supplements, and other things you want to revisit later.",
  },
  {
    title: "Notice patterns over time",
    body: "See how sleep, food, movement, and symptoms connect so the next step feels obvious.",
  },
] as const;

export default function HomePage() {
  const signupPhone = resolveHostedSignupPhoneNumber();
  const signupHref = signupPhone ? `sms:${signupPhone.smsValue}` : null;
  const phoneAuthReady = hasHostedPrivyPhoneAuthConfig();

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "clamp(1.25rem, 4vw, 2.75rem)",
        background:
          "radial-gradient(circle at top, rgba(191, 219, 254, 0.4) 0%, rgba(248, 250, 252, 0.98) 34%, rgba(226, 232, 240, 0.96) 100%)",
        color: "rgb(15 23 42)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "72rem",
          margin: "0 auto",
          display: "grid",
          gap: "2.5rem",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "0.95rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Healthy Bob
          </span>
          <span
            style={{
              borderRadius: "999px",
              border: "1px solid rgba(148, 163, 184, 0.28)",
              background: "rgba(255,255,255,0.7)",
              padding: "0.45rem 0.8rem",
              fontSize: "0.9rem",
              color: "rgb(71 85 105)",
            }}
          >
            Private health guidance that fits real life
          </span>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))",
            gap: "1.25rem",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              borderRadius: "2rem",
              background: "rgba(255,255,255,0.8)",
              boxShadow: "0 20px 60px rgba(15, 23, 42, 0.08)",
              padding: "clamp(1.5rem, 4vw, 3rem)",
              display: "grid",
              gap: "1.1rem",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                width: "fit-content",
                borderRadius: "999px",
                background: "rgba(15, 23, 42, 0.07)",
                padding: "0.35rem 0.7rem",
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Your personal health assistant
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(2.5rem, 7vw, 5.5rem)",
                lineHeight: 0.95,
                letterSpacing: "-0.05em",
                maxWidth: "10ch",
              }}
            >
              Your personal health assistant.
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: "34rem",
                fontSize: "1.06rem",
                lineHeight: 1.7,
                color: "rgb(51 65 85)",
              }}
            >
              Healthy Bob helps you understand what is happening, remember what matters, and make calmer decisions
              about your health.
            </p>
          </div>

          <section
            aria-labelledby="signup-title"
            style={{
              borderRadius: "2rem",
              background: "rgb(15 23 42)",
              color: "white",
              boxShadow: "0 20px 60px rgba(15, 23, 42, 0.16)",
              padding: "clamp(1.5rem, 4vw, 2.25rem)",
              display: "grid",
              gap: "1rem",
              alignContent: "start",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                width: "fit-content",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.12)",
                padding: "0.35rem 0.7rem",
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Signup
            </span>
            <div style={{ display: "grid", gap: "0.65rem" }}>
              <h2
                id="signup-title"
                style={{
                  margin: 0,
                  fontSize: "clamp(1.75rem, 5vw, 2.5rem)",
                  lineHeight: 1.05,
                  letterSpacing: "-0.04em",
                }}
              >
                Start with your phone.
              </h2>
              <p
                style={{
                  margin: 0,
                  color: "rgba(255,255,255,0.78)",
                  lineHeight: 1.7,
                }}
              >
                Verify your phone number, create your rewards wallet, and continue to payment in one clean flow.
              </p>
            </div>

            <div
              style={{
                borderRadius: "1.5rem",
                background: "rgba(255,255,255,0.98)",
                padding: "1rem 1.05rem",
                color: "rgb(15 23 42)",
              }}
            >
              {phoneAuthReady ? (
                <HostedPhoneAuth mode="public" />
              ) : (
                <div style={{ lineHeight: 1.6, color: "rgb(71 85 105)" }}>
                  Phone signup is not configured for this environment yet.
                </div>
              )}
            </div>

            {signupHref && signupPhone ? (
              <div
                style={{
                  borderRadius: "1.25rem",
                  background: "rgba(255,255,255,0.08)",
                  padding: "1rem 1.05rem",
                  display: "grid",
                  gap: "0.65rem",
                }}
              >
                <strong>Prefer texting first?</strong>
                <p
                  style={{
                    margin: 0,
                    color: "rgba(255,255,255,0.68)",
                    lineHeight: 1.6,
                  }}
                >
                  You can still start from SMS and we’ll send back a secure signup link at {signupPhone.displayValue}.
                </p>
                <a
                  href={signupHref}
                  style={{
                    display: "inline-flex",
                    width: "fit-content",
                    justifyContent: "center",
                    alignItems: "center",
                    borderRadius: "999px",
                    background: "white",
                    color: "rgb(15 23 42)",
                    padding: "0.85rem 1.05rem",
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  Text to start instead
                </a>
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gap: "0.6rem",
                paddingTop: "0.25rem",
                color: "rgba(255,255,255,0.68)",
                lineHeight: 1.6,
              }}
            >
              <span>1. Verify your phone number.</span>
              <span>2. Create your secure Healthy Bob account.</span>
              <span>3. Provision your rewards wallet and continue to checkout.</span>
            </div>
          </section>
        </section>

        <section
          aria-label="Core features"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
            gap: "1rem",
          }}
        >
          {featureItems.map((item) => (
            <article
              key={item.title}
              style={{
                borderRadius: "1.5rem",
                background: "rgba(255,255,255,0.74)",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                padding: "1.1rem 1.15rem",
                display: "grid",
                gap: "0.55rem",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "1.05rem",
                  lineHeight: 1.2,
                }}
              >
                {item.title}
              </h2>
              <p
                style={{
                  margin: 0,
                  color: "rgb(71 85 105)",
                  lineHeight: 1.65,
                }}
              >
                {item.body}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
