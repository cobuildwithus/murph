import "server-only";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer, emailOTP, phoneNumber } from "better-auth/plugins";
import type { PrismaClient } from "@prisma/client";
import { hostedAuthAdapter } from "./adapter";
import { authLookupKey } from "./record-crypto";
import { hostedAuthRateLimitStorage } from "./rate-limit";
import { hostedAuthCookieName } from "./transport";

export function hostedBetterAuthCookieName(baseURL: string): string {
  return hostedAuthCookieName(new URL(baseURL).protocol === "https:");
}

export interface HostedAuthDelivery {
  email(input: { address: string; code: string }): Promise<void>;
  sms(input: { phoneNumber: string; code: string }): Promise<void>;
}

// Instances are private to the hosted authentication owner. Do not expose the
// library's catch-all handler: the route owner controls transport, contact
// reconciliation and the database-only login completion transaction.
export function createHostedBetterAuth(input: {
  baseURL: string;
  database?: BetterAuthOptions["database"];
  delivery: HostedAuthDelivery;
  hooks?: BetterAuthOptions["databaseHooks"];
  generateId?: (input: { model: string }) => string;
  primaryAuthenticatedAt?: Date;
  prisma: PrismaClient;
  secret: string;
}) {
  if (input.secret.length < 32) throw new TypeError("Better Auth requires a configured secret.");
  return betterAuth({
    appName: "Murph", baseURL: input.baseURL, basePath: "/api/auth",
    secret: input.secret, trustedOrigins: [new URL(input.baseURL).origin],
    database: input.database ?? hostedAuthAdapter(input.prisma),
    logger: { disabled: true },
    emailAndPassword: { enabled: false },
    user: {
      deleteUser: { enabled: false }, changeEmail: { enabled: false },
      additionalFields: { credentialsChangedAt: { type: "date", required: false, input: false, returned: false } },
    },
    account: { accountLinking: { enabled: false }, storeAccountCookie: false },
    // The bounded hosted-retention owner drains expired rows off the login path.
    verification: { disableCleanup: true },
    session: {
      expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: false },
      additionalFields: { primaryAuthenticatedAt: { type: "date", required: false, input: false, returned: false } },
    },
    advanced: {
      // The library otherwise prepends __Secure- even to a custom __Host- name.
      // Set the secure attribute explicitly so the browser enforces host scope.
      cookiePrefix: "murph-auth", useSecureCookies: false,
      cookies: { session_token: { name: hostedBetterAuthCookieName(input.baseURL) } },
      database: { generateId: input.generateId },
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: { secure: new URL(input.baseURL).protocol === "https:", httpOnly: true, sameSite: "lax", path: "/" },
    },
    rateLimit: { enabled: true, customStorage: hostedAuthRateLimitStorage(input.prisma) },
    databaseHooks: {
      ...input.hooks,
      user: {
        ...input.hooks?.user,
        create: {
          ...input.hooks?.user?.create,
          async before(user, context) {
            const prepared = await input.hooks?.user?.create?.before?.(user, context);
            if (prepared === false) return false;
            return { data: { ...user, credentialsChangedAt: new Date(), ...(prepared && typeof prepared === "object" ? prepared.data : {}) } };
          },
        },
      },
      session: {
        ...input.hooks?.session,
        create: {
          ...input.hooks?.session?.create,
          async before(session, context) {
            const prepared = await input.hooks?.session?.create?.before?.(session, context);
            if (prepared === false) return false;
            return { data: {
              ...session, primaryAuthenticatedAt: input.primaryAuthenticatedAt ?? null,
              ...(prepared && typeof prepared === "object" ? prepared.data : {}), ipAddress: null, userAgent: null,
            } };
          },
        },
      },
    },
    plugins: [
      bearer(),
      emailOTP({
        otpLength: 6, expiresIn: 300, allowedAttempts: 3, storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in" || email.endsWith("@auth.invalid")) {
            throw new TypeError("Unsupported authentication email operation.");
          }
          await input.delivery.email({ address: email, code: otp });
        },
      }),
      phoneNumber({
        otpLength: 6, expiresIn: 300, allowedAttempts: 3,
        phoneNumberValidator: (value) => /^\+[1-9]\d{6,14}$/u.test(value),
        sendOTP: ({ phoneNumber: value, code }) => input.delivery.sms({ phoneNumber: value, code }),
        signUpOnVerification: {
          getTempEmail: (value) => `${authLookupKey("user", "phone-alias", value)}@auth.invalid`,
          getTempName: () => "",
        },
      }),
    ],
  });
}
