import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  const slash = path.lastIndexOf("/");
  if (slash >= 0) fs.mkdirSync(path.slice(0, slash), { recursive: true });
  fs.writeFileSync(path, content);
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`Missing anchor: ${label}`);
  if (content.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Non-unique anchor: ${label}`);
  }
  return content.slice(0, first) + after + content.slice(first + before.length);
}

function replaceAllExpected(content, before, after, expected, label) {
  const count = content.split(before).length - 1;
  if (count !== expected) {
    throw new Error(`Expected ${expected} anchors for ${label}, found ${count}`);
  }
  return content.split(before).join(after);
}

write(
  "apps/web/src/lib/hosted-groups/group-start-handoff.ts",
  `export const HOSTED_GROUP_START_PATH = "/groups/start";

const HOSTED_GROUP_START_HANDOFF_STORAGE_KEY =
  "murph:group-start-handoff:v1";
const HOSTED_GROUP_START_HANDOFF_TTL_MS = 24 * 60 * 60 * 1_000;

type HostedGroupStartHandoffStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export function armHostedGroupStartHandoff(input: {
  now?: Date;
  storage?: HostedGroupStartHandoffStorage | null;
} = {}): void {
  const storage = input.storage ?? readHostedGroupStartSessionStorage();
  const now = input.now ?? new Date();
  if (!storage || Number.isNaN(now.getTime())) {
    return;
  }

  try {
    storage.setItem(
      HOSTED_GROUP_START_HANDOFF_STORAGE_KEY,
      JSON.stringify({
        expiresAt: new Date(
          now.getTime() + HOSTED_GROUP_START_HANDOFF_TTL_MS,
        ).toISOString(),
        version: 1,
      }),
    );
  } catch {
    // The handoff is a convenience. Browser storage policy must never block
    // authentication or onboarding.
  }
}

export function consumeHostedGroupStartHandoff(input: {
  now?: Date;
  storage?: HostedGroupStartHandoffStorage | null;
} = {}): boolean {
  const storage = input.storage ?? readHostedGroupStartSessionStorage();
  const now = input.now ?? new Date();
  if (!storage || Number.isNaN(now.getTime())) {
    return false;
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(HOSTED_GROUP_START_HANDOFF_STORAGE_KEY);
    storage.removeItem(HOSTED_GROUP_START_HANDOFF_STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) {
    return false;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || typeof record.expiresAt !== "string") {
      return false;
    }
    const expiresAt = new Date(record.expiresAt);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt > now;
  } catch {
    return false;
  }
}

export function clearHostedGroupStartHandoff(input: {
  storage?: HostedGroupStartHandoffStorage | null;
} = {}): void {
  const storage = input.storage ?? readHostedGroupStartSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(HOSTED_GROUP_START_HANDOFF_STORAGE_KEY);
  } catch {
    // Best effort for browsers that block storage.
  }
}

function readHostedGroupStartSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
`,
);

write(
  "apps/web/src/lib/hosted-onboarding/linq-group-setup.ts",
  `import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import { readHostedAppSessionHmacKey } from "./app-session-config";
import {
  createHostedLinqParticipantContact,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";
import { normalizePhoneNumber } from "./phone";
import { requireHostedOnboardingPublicBaseUrl } from "./runtime";
import { sha256Hex } from "../primitives";

export const HOSTED_LINQ_GROUP_SETUP_TEMPLATE = "group_setup";
export const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TEMPLATE =
  "group_email_recovery";

const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_PREFIX =
  "murph_linq_group_email_v1.";
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN =
  "murph.linq-group-email-recovery.v1";
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_VERSION = 1;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES = 12;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TAG_BYTES = 16;
const HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_MAX_BYTES = 4_096;
const HOSTED_LINQ_GROUP_CHAT_ID_MAX_CHARS = 512;

type HostedLinqGroupEmailRecoveryTokenPayload = {
  chatId: string;
  email: string;
  expiresAt: string;
  issuedAt: string;
  observedAt: string;
  recipientPhone: string;
  version: 1;
};

export type HostedLinqGroupEmailRecovery = {
  chatId: string;
  participantContact: HostedLinqParticipantContact & { kind: "email" };
  observedAt: Date;
  recipientPhone: string;
};

export function buildHostedLinqGroupSetupEffectId(input: {
  chatId: string;
}): string {
  const chatId = normalizeHostedLinqGroupChatId(input.chatId);
  if (!chatId) {
    throw new TypeError(
      "Hosted Linq group setup requires a non-empty chat id.",
    );
  }

  return \`linq-group-setup:\${sha256Hex(chatId).slice(0, 32)}\`;
}

export function buildHostedLinqGroupEmailRecoveryEffectId(input: {
  chatId: string;
  participantEmail: string;
  recipientPhone: string;
}): string {
  const chatId = normalizeHostedLinqGroupChatId(input.chatId);
  const participantContact = createHostedLinqParticipantContact({
    kind: "email",
    value: input.participantEmail,
  });
  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  if (
    !chatId
    || !participantContact
    || participantContact.kind !== "email"
    || !recipientPhone
  ) {
    throw new TypeError(
      "Hosted Linq group email recovery requires a valid chat, email, and recipient line.",
    );
  }

  return \`linq-group-email-recovery:\${sha256Hex(JSON.stringify({
    chatId,
    participantLookupKey: participantContact.lookupKey,
    recipientPhone,
  })).slice(0, 32)}\`;
}

export function buildHostedLinqGroupSetupUrl(): string {
  return \`\${requireHostedOnboardingPublicBaseUrl().replace(/\\/+$/u, "")}/groups/start\`;
}

export function buildHostedLinqGroupSetupMessage(): string {
  return [
    "I'm here — someone in this chat needs to finish setting up Murph,",
    "then message me here again:",
    buildHostedLinqGroupSetupUrl(),
  ].join(" ");
}

export function buildHostedLinqGroupEmailRecoveryMessage(input: {
  recoveryToken: string;
}): string {
  const recoveryUrl = buildHostedLinqGroupEmailRecoveryUrl(input.recoveryToken);
  return [
    "It looks like Messages sent your group message from an email Murph hasn't seen before.",
    "Open this to use your existing Murph account or create one,",
    "then message me in the group again:",
    recoveryUrl,
  ].join(" ");
}

export function issueHostedLinqGroupEmailRecoveryToken(input: {
  chatId: string;
  now?: Date;
  observedAt: string | Date;
  participantEmail: string;
  recipientPhone: string;
}): string {
  const chatId = normalizeHostedLinqGroupChatId(input.chatId);
  const participantContact = createHostedLinqParticipantContact({
    kind: "email",
    value: input.participantEmail,
  });
  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const observedAt = new Date(input.observedAt);
  const issuedAt = input.now ?? new Date();
  if (
    !chatId
    || !participantContact
    || participantContact.kind !== "email"
    || !recipientPhone
    || Number.isNaN(observedAt.getTime())
    || Number.isNaN(issuedAt.getTime())
  ) {
    throw new TypeError(
      "Hosted Linq group email recovery requires valid observed provider authority.",
    );
  }

  const expiresAt = new Date(
    issuedAt.getTime() + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TTL_MS,
  );
  const payload: HostedLinqGroupEmailRecoveryTokenPayload = {
    chatId,
    email: participantContact.value,
    expiresAt: expiresAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
    observedAt: observedAt.toISOString(),
    recipientPhone,
    version: HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_VERSION,
  };
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.byteLength > HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_MAX_BYTES) {
    throw new RangeError("Hosted Linq group email recovery token is too large.");
  }

  const iv = randomBytes(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveHostedLinqGroupEmailRecoveryKey(),
    iv,
  );
  cipher.setAAD(Buffer.from(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return \`\${HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_PREFIX}\${Buffer.concat([
    iv,
    tag,
    ciphertext,
  ]).toString("base64url")}\`;
}

export function openHostedLinqGroupEmailRecoveryToken(input: {
  now?: Date;
  token: string | null | undefined;
}): HostedLinqGroupEmailRecovery | null {
  const token = input.token?.trim() ?? "";
  if (
    !token.startsWith(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_PREFIX)
    || token !== input.token
  ) {
    return null;
  }

  const encoded = token.slice(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_PREFIX.length,
  );
  if (!encoded || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    return null;
  }

  let packed: Buffer;
  try {
    packed = Buffer.from(encoded, "base64url");
  } catch {
    return null;
  }
  if (
    packed.toString("base64url") !== encoded
    || packed.byteLength
      <= HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES
        + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TAG_BYTES
    || packed.byteLength > HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_MAX_BYTES
  ) {
    return null;
  }

  const iv = packed.subarray(0, HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES);
  const tag = packed.subarray(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES,
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES
      + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TAG_BYTES,
  );
  const ciphertext = packed.subarray(
    HOSTED_LINQ_GROUP_EMAIL_RECOVERY_IV_BYTES
      + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TAG_BYTES,
  );

  let payload: unknown;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveHostedLinqGroupEmailRecoveryKey(),
      iv,
    );
    decipher.setAAD(
      Buffer.from(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN),
    );
    decipher.setAuthTag(tag);
    payload = JSON.parse(
      Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    return null;
  }

  const parsed = parseHostedLinqGroupEmailRecoveryPayload(payload);
  if (!parsed) {
    return null;
  }
  const now = input.now ?? new Date();
  if (
    Number.isNaN(now.getTime())
    || parsed.issuedAt.getTime()
      > now.getTime() + HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CLOCK_SKEW_MS
    || parsed.expiresAt <= now
  ) {
    return null;
  }

  return {
    chatId: parsed.chatId,
    observedAt: parsed.observedAt,
    participantContact: parsed.participantContact,
    recipientPhone: parsed.recipientPhone,
  };
}

function buildHostedLinqGroupEmailRecoveryUrl(token: string): string {
  const url = new URL(buildHostedLinqGroupSetupUrl());
  url.hash = new URLSearchParams({ recover: token }).toString();
  return url.toString();
}

function deriveHostedLinqGroupEmailRecoveryKey(): Buffer {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_DOMAIN, "utf8")
    .digest();
}

function parseHostedLinqGroupEmailRecoveryPayload(value: unknown): {
  chatId: string;
  expiresAt: Date;
  issuedAt: Date;
  observedAt: Date;
  participantContact: HostedLinqParticipantContact & { kind: "email" };
  recipientPhone: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TOKEN_VERSION
    || typeof record.chatId !== "string"
    || typeof record.email !== "string"
    || typeof record.recipientPhone !== "string"
    || typeof record.observedAt !== "string"
    || typeof record.issuedAt !== "string"
    || typeof record.expiresAt !== "string"
  ) {
    return null;
  }

  const chatId = normalizeHostedLinqGroupChatId(record.chatId);
  const participantContact = createHostedLinqParticipantContact({
    kind: "email",
    value: record.email,
  });
  const recipientPhone = normalizePhoneNumber(record.recipientPhone);
  const observedAt = new Date(record.observedAt);
  const issuedAt = new Date(record.issuedAt);
  const expiresAt = new Date(record.expiresAt);
  if (
    !chatId
    || !participantContact
    || participantContact.kind !== "email"
    || !recipientPhone
    || Number.isNaN(observedAt.getTime())
    || Number.isNaN(issuedAt.getTime())
    || Number.isNaN(expiresAt.getTime())
    || expiresAt.getTime() - issuedAt.getTime()
      !== HOSTED_LINQ_GROUP_EMAIL_RECOVERY_TTL_MS
  ) {
    return null;
  }

  return {
    chatId,
    expiresAt,
    issuedAt,
    observedAt,
    participantContact,
    recipientPhone,
  };
}

function normalizeHostedLinqGroupChatId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= HOSTED_LINQ_GROUP_CHAT_ID_MAX_CHARS
    ? normalized
    : null;
}
`,
);

write(
  "apps/web/app/groups/start/page.tsx",
  `import type { Metadata } from "next";

import { HostedGroupStartClient } from "@/src/components/hosted-groups/group-start-client";
import { readActiveHostedMemberAccess } from "@/src/lib/hosted-onboarding/member-access";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Set up Murph for a group",
  description: "Finish setting up Murph, then return to your group chat.",
  referrer: "no-referrer",
  robots: {
    follow: false,
    index: false,
  },
};

export default async function HostedGroupStartPage() {
  const auth = await getHostedPageAuthSnapshot();
  const activeAccess = auth.authenticatedMember
    ? await readActiveHostedMemberAccess({
        memberId: auth.authenticatedMember.id,
      })
    : false;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <HostedGroupStartClient
        activeAccess={activeAccess}
        authenticated={auth.authenticated}
      />
    </main>
  );
}
`,
);

write(
  "apps/web/src/components/hosted-groups/group-start-client.tsx",
  `"use client";

import { Check, MessageCircle } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import {
  armHostedGroupStartHandoff,
  clearHostedGroupStartHandoff,
} from "@/src/lib/hosted-groups/group-start-handoff";
import { Button } from "@/src/components/ui/button";

type HostedGroupStartRecoveryResponse = {
  ok: true;
  status: "already_connected" | "linked";
};

type HostedGroupStartRecoveryStatus =
  | "checking"
  | "failed"
  | "idle"
  | "linked"
  | "linking";

export function HostedGroupStartClient({
  activeAccess,
  authenticated,
}: {
  activeAccess: boolean;
  authenticated: boolean;
}) {
  const recoveryStarted = useRef(false);
  const [authOpen, setAuthOpen] = useState(!authenticated);
  const [signedIn, setSignedIn] = useState(authenticated);
  const [readyAccess, setReadyAccess] = useState(activeAccess);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [recoveryStatus, setRecoveryStatus] =
    useState<HostedGroupStartRecoveryStatus>("checking");

  useEffect(() => {
    if (activeAccess) {
      clearHostedGroupStartHandoff();
    } else {
      armHostedGroupStartHandoff();
    }

    const token = readHostedGroupStartRecoveryToken();
    setRecoveryToken(token);
    if (!token || !authenticated) {
      setRecoveryStatus("idle");
      return;
    }
    if (recoveryStarted.current) {
      return;
    }

    recoveryStarted.current = true;
    setRecoveryStatus("linking");
    void linkRecovery(token).then(
      () => {
        clearHostedGroupStartRecoveryFragment();
        setRecoveryStatus("linked");
      },
      () => setRecoveryStatus("failed"),
    );
  }, [activeAccess, authenticated]);

  async function handleCompleted(payload: HostedPrivyCompletionPayload) {
    if (recoveryToken) {
      setRecoveryStatus("linking");
      try {
        await linkRecovery(recoveryToken);
        clearHostedGroupStartRecoveryFragment();
        setRecoveryStatus("linked");
      } catch {
        setRecoveryStatus("failed");
        return;
      }
    }

    if (!isHostedOnboardingAccessibleStage(payload.stage)) {
      armHostedGroupStartHandoff();
      navigateHostedAuthRedirect(payload.joinUrl);
      return;
    }

    clearHostedGroupStartHandoff();
    setSignedIn(true);
    setReadyAccess(true);
    setAuthOpen(false);
  }

  if (recoveryStatus === "checking" || recoveryStatus === "linking") {
    return (
      <HostedGroupStartFrame
        icon={<MessageCircle className="size-8" />}
        title={
          recoveryStatus === "linking"
            ? "Connecting your Messages address"
            : "Preparing Murph"
        }
        body={
          recoveryStatus === "linking"
            ? "One moment — Murph is linking the address that sent the group message to your account."
            : "One moment while Murph prepares group setup."
        }
      />
    );
  }

  if (recoveryStatus === "failed") {
    return (
      <HostedGroupStartFrame
        icon={<MessageCircle className="size-8" />}
        title="That recovery link did not work"
        body="Open the latest link Murph sent, or return to the group and have someone with Murph message again."
      >
        <Button
          type="button"
          size="xl"
          className="w-full"
          onClick={() => {
            if (!recoveryToken) {
              return;
            }
            setRecoveryStatus("linking");
            void linkRecovery(recoveryToken).then(
              () => {
                clearHostedGroupStartRecoveryFragment();
                setRecoveryStatus("linked");
              },
              () => setRecoveryStatus("failed"),
            );
          }}
        >
          Try again
        </Button>
      </HostedGroupStartFrame>
    );
  }

  if (signedIn || recoveryStatus === "linked") {
    return readyAccess ? (
      <HostedGroupStartFrame
        icon={<Check className="size-8" />}
        title="Go back to the group"
        body="Message Murph in that group again. Your next message will connect the chat and Murph will reply there."
      />
    ) : (
      <HostedGroupStartFrame
        icon={<MessageCircle className="size-8" />}
        title="Finish setting up Murph"
        body="Complete setup, then return to the group and message Murph again."
      >
        <Button
          render={<Link href="/join" />}
          nativeButton={false}
          size="xl"
          className="w-full"
        >
          Finish setup
        </Button>
      </HostedGroupStartFrame>
    );
  }

  return (
    <HostedGroupStartFrame
      icon={<MessageCircle className="size-8" />}
      title="Set up Murph for this group"
      body="Create or open your Murph account. When setup is finished, return to the group and message Murph again."
    >
      <Button
        type="button"
        size="xl"
        className="w-full"
        onClick={() => setAuthOpen(true)}
      >
        Continue
      </Button>
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onCompleted={handleCompleted}
        requireLaunchConsentOnCompletion
        title="Log in or sign up"
        description="Finish setting up Murph, then return to your group chat."
      />
    </HostedGroupStartFrame>
  );
}

async function linkRecovery(token: string): Promise<void> {
  await requestHostedOnboardingJson<HostedGroupStartRecoveryResponse>({
    payload: { token },
    url: "/api/groups/start/recover",
  });
}

function readHostedGroupStartRecoveryToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const token = new URLSearchParams(hash).get("recover")?.trim() ?? "";
  return token.length > 0 && token.length <= 6_000 ? token : null;
}

function clearHostedGroupStartRecoveryFragment(): void {
  if (typeof window === "undefined" || !window.location.hash) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

function HostedGroupStartFrame({
  body,
  children,
  icon,
  title,
}: {
  body: string;
  children?: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-8 text-center">
      <header className="flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          {icon}
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-pretty text-base leading-7 text-muted-foreground">
            {body}
          </p>
        </div>
      </header>
      {children ? <div className="flex flex-col gap-3">{children}</div> : null}
    </div>
  );
}
`,
);

write(
  "apps/web/app/api/groups/start/recover/route.ts",
  `import {
  demoteHostedMemberLinqGroupChatBindingsTx,
  readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { openHostedLinqGroupEmailRecoveryToken } from "@/src/lib/hosted-onboarding/linq-group-setup";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { readHostedThreadRouteByThreadIdentity } from "@/src/lib/hosted-routing/thread-route-store";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8_192;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(session.member);

  const body = await readOptionalJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
  });
  const token = readRecoveryToken(body.token);
  const recovery = openHostedLinqGroupEmailRecoveryToken({ token });
  if (!recovery) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID",
      httpStatus: 410,
      message: "That Messages recovery link is invalid or expired.",
      retryable: false,
    });
  }

  const prisma = getPrisma();
  const status = await prisma.$transaction(async (tx) => {
    const routeBefore = await readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: tx,
      threadId: recovery.chatId,
    });
    if (routeBefore) {
      return "already_connected" as const;
    }

    const routing = await readHostedMemberRoutingState({
      memberId: session.member.id,
      prisma: tx,
    });
    const pendingContact = routing?.pendingLinqParticipantContact ?? null;
    if (
      (routing?.pendingLinqChatId
        && routing.pendingLinqChatId !== recovery.chatId)
      || (pendingContact
        && pendingContact.lookupKey !== recovery.participantContact.lookupKey)
      || (routing?.pendingLinqRecipientPhone
        && routing.pendingLinqRecipientPhone !== recovery.recipientPhone)
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT",
        httpStatus: 409,
        message:
          "This Murph account is already finishing another Messages connection.",
        retryable: false,
      });
    }

    await upsertHostedMemberPendingLinqBindingTx({
      homeLineAssignedAt: null,
      linqChatId: recovery.chatId,
      memberId: session.member.id,
      participantContact: recovery.participantContact,
      participantContactObservedAt: recovery.observedAt,
      prisma: tx,
      recipientPhone: recovery.recipientPhone,
    });

    const routeAfter = await readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: tx,
      threadId: recovery.chatId,
    });
    if (routeAfter) {
      await demoteHostedMemberLinqGroupChatBindingsTx({
        linqChatId: recovery.chatId,
        prisma: tx,
      });
      return "already_connected" as const;
    }

    return "linked" as const;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return jsonOk({
    ok: true,
    status,
  });
});

function readRecoveryToken(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 6_000
    || value !== value.trim()
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID",
      httpStatus: 400,
      message: "A valid Messages recovery link is required.",
      retryable: false,
    });
  }
  return value;
}
`,
);

{
  const path = "apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx";
  let content = read(path);
  content = replaceOnce(
    content,
    'import { HOSTED_APP_INITIAL_VISIT_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";\n',
    'import { HOSTED_APP_INITIAL_VISIT_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";\nimport {\n  consumeHostedGroupStartHandoff,\n  HOSTED_GROUP_START_PATH,\n} from "@/src/lib/hosted-groups/group-start-handoff";\n',
    "success handoff import",
  );
  content = replaceAllExpected(
    content,
    "router.replace(HOSTED_APP_INITIAL_VISIT_HOME_PATH);",
    "router.replace(resolveHostedInviteSuccessRedirectPath());",
    2,
    "success redirect destinations",
  );
  content += `\nfunction resolveHostedInviteSuccessRedirectPath(): string {\n  return consumeHostedGroupStartHandoff()\n    ? HOSTED_GROUP_START_PATH\n    : HOSTED_APP_INITIAL_VISIT_HOME_PATH;\n}\n`;
  write(path, content);
}

{
  const path = "apps/web/src/components/hosted-onboarding/join-invite-auto-trial-island.tsx";
  let content = read(path);
  content = replaceOnce(
    content,
    'import { ContactSupportAction } from "@/src/components/support/contact-support-action";\n',
    'import { ContactSupportAction } from "@/src/components/support/contact-support-action";\nimport {\n  consumeHostedGroupStartHandoff,\n  HOSTED_GROUP_START_PATH,\n} from "@/src/lib/hosted-groups/group-start-handoff";\n',
    "auto trial handoff import",
  );
  content = replaceOnce(
    content,
    "      replace(enrollment.redirectPath);",
    "      replace(\n        consumeHostedGroupStartHandoff()\n          ? HOSTED_GROUP_START_PATH\n          : enrollment.redirectPath,\n      );",
    "auto trial success handoff",
  );
  content = replaceOnce(
    content,
    "      if (checkout.alreadyActive) {\n        refresh();\n        return;\n      }",
    "      if (checkout.alreadyActive) {\n        if (consumeHostedGroupStartHandoff()) {\n          replace(HOSTED_GROUP_START_PATH);\n        } else {\n          refresh();\n        }\n        return;\n      }",
    "auto trial already active handoff",
  );
  content = replaceOnce(
    content,
    "  }, [inviteCode, refresh]);",
    "  }, [inviteCode, refresh, replace]);",
    "auto trial dependency",
  );
  write(path, content);
}

{
  const path = "apps/web/src/components/hosted-onboarding/join-invite-islands.tsx";
  let content = read(path);
  content = replaceOnce(
    content,
    'import type { HostedConsentStatus } from "@/src/lib/legal/consent";\n',
    'import type { HostedConsentStatus } from "@/src/lib/legal/consent";\nimport {\n  consumeHostedGroupStartHandoff,\n  HOSTED_GROUP_START_PATH,\n} from "@/src/lib/hosted-groups/group-start-handoff";\n',
    "checkout handoff import",
  );
  content = replaceOnce(
    content,
    "    if (outcome.kind === \"alreadyActive\") {\n      router.refresh();\n      return;\n    }",
    "    if (outcome.kind === \"alreadyActive\") {\n      if (consumeHostedGroupStartHandoff()) {\n        router.replace(HOSTED_GROUP_START_PATH);\n      } else {\n        router.refresh();\n      }\n      return;\n    }",
    "checkout already active handoff",
  );
  write(path, content);
}

write(
  "apps/web/test/hosted-group-start-handoff.test.ts",
  `import { describe, expect, it } from "vitest";

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
      now: new Date("2026-07-31T05:00:00.000Z"),
      storage,
    })).toBe(true);
    expect(consumeHostedGroupStartHandoff({
      now: new Date("2026-07-31T05:00:00.000Z"),
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
`,
);

write(
  "apps/web/test/hosted-linq-group-setup.test.ts",
  `import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildHostedLinqGroupEmailRecoveryEffectId,
  buildHostedLinqGroupEmailRecoveryMessage,
  buildHostedLinqGroupSetupEffectId,
  issueHostedLinqGroupEmailRecoveryToken,
  openHostedLinqGroupEmailRecoveryToken,
} from "../src/lib/hosted-onboarding/linq-group-setup";

const TEST_SESSION_KEY = Buffer.alloc(32, 7).toString("base64url");

describe("Hosted Linq group setup", () => {
  const previousSessionKey = process.env.HOSTED_APP_SESSION_HMAC_KEY;
  const previousPublicBaseUrl = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;

  beforeEach(() => {
    process.env.HOSTED_APP_SESSION_HMAC_KEY = TEST_SESSION_KEY;
    process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = "https://murph.example";
  });

  afterEach(() => {
    if (previousSessionKey === undefined) {
      delete process.env.HOSTED_APP_SESSION_HMAC_KEY;
    } else {
      process.env.HOSTED_APP_SESSION_HMAC_KEY = previousSessionKey;
    }
    if (previousPublicBaseUrl === undefined) {
      delete process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL;
    } else {
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = previousPublicBaseUrl;
    }
  });

  it("round-trips one private email recovery token", () => {
    const observedAt = new Date("2026-07-31T04:00:00.000Z");
    const token = issueHostedLinqGroupEmailRecoveryToken({
      chatId: "chat_group_123",
      now: observedAt,
      observedAt,
      participantEmail: " Person@iCloud.com ",
      recipientPhone: "+15550000000",
    });

    expect(openHostedLinqGroupEmailRecoveryToken({
      now: new Date("2026-07-31T05:00:00.000Z"),
      token,
    })).toMatchObject({
      chatId: "chat_group_123",
      observedAt,
      participantContact: {
        kind: "email",
        value: "person@icloud.com",
      },
      recipientPhone: "+15550000000",
    });
  });

  it("keeps the private bearer token out of the request query", () => {
    const token = issueHostedLinqGroupEmailRecoveryToken({
      chatId: "chat_group_123",
      now: new Date("2026-07-31T04:00:00.000Z"),
      observedAt: "2026-07-31T04:00:00.000Z",
      participantEmail: "person@icloud.com",
      recipientPhone: "+15550000000",
    });
    const message = buildHostedLinqGroupEmailRecoveryMessage({
      recoveryToken: token,
    });
    const url = new URL(message.match(/https:\\/\\/\\S+/u)?.[0] ?? "");

    expect(url.pathname).toBe("/groups/start");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("recover")).toBe(token);
  });

  it("rejects tampered, future, and expired recovery tokens", () => {
    const token = issueHostedLinqGroupEmailRecoveryToken({
      chatId: "chat_group_123",
      now: new Date("2026-07-31T04:00:00.000Z"),
      observedAt: "2026-07-31T04:00:00.000Z",
      participantEmail: "person@icloud.com",
      recipientPhone: "+15550000000",
    });

    expect(openHostedLinqGroupEmailRecoveryToken({
      now: new Date("2026-07-31T05:00:00.000Z"),
      token: \`\${token.slice(0, -1)}x\`,
    })).toBeNull();
    expect(openHostedLinqGroupEmailRecoveryToken({
      now: new Date("2026-07-31T03:54:59.999Z"),
      token,
    })).toBeNull();
    expect(openHostedLinqGroupEmailRecoveryToken({
      now: new Date("2026-08-01T04:00:00.000Z"),
      token,
    })).toBeNull();
  });

  it("uses stable opaque setup and recovery identities", () => {
    const setupId = buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
    });
    const recoveryId = buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: "chat_group_123",
      participantEmail: "person@icloud.com",
      recipientPhone: "+15550000000",
    });

    expect(buildHostedLinqGroupSetupEffectId({
      chatId: "chat_group_123",
    })).toBe(setupId);
    expect(buildHostedLinqGroupEmailRecoveryEffectId({
      chatId: "chat_group_123",
      participantEmail: "PERSON@ICLOUD.COM",
      recipientPhone: "+1 (555) 000-0000",
    })).toBe(recoveryId);
    expect(\`\${setupId}:\${recoveryId}\`).not.toContain("icloud");
    expect(\`\${setupId}:\${recoveryId}\`).not.toContain("+1555");
  });
});
`,
);

write(
  "apps/web/test/hosted-group-start-recovery-route.test.ts",
  `import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  demoteHostedMemberLinqGroupChatBindingsTx: vi.fn(),
  getPrisma: vi.fn(),
  openHostedLinqGroupEmailRecoveryToken: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  upsertHostedMemberPendingLinqBindingTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  demoteHostedMemberLinqGroupChatBindingsTx:
    mocks.demoteHostedMemberLinqGroupChatBindingsTx,
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx:
    mocks.upsertHostedMemberPendingLinqBindingTx,
}));
vi.mock("@/src/lib/hosted-onboarding/linq-group-setup", () => ({
  openHostedLinqGroupEmailRecoveryToken:
    mocks.openHostedLinqGroupEmailRecoveryToken,
}));
vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

let route: typeof import("../app/api/groups/start/recover/route");
const tx = { tx: true };
const recovery = {
  chatId: "chat_group_123",
  observedAt: new Date("2026-07-31T04:00:00.000Z"),
  participantContact: {
    kind: "email" as const,
    lookupKey: "contact_lookup_key",
    value: "person@icloud.com",
  },
  recipientPhone: "+15550000000",
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
  mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: { id: "member_existing", suspendedAt: null },
  });
  mocks.openHostedLinqGroupEmailRecoveryToken.mockReturnValue(recovery);
  mocks.readHostedMemberRoutingState.mockResolvedValue(null);
  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
  mocks.upsertHostedMemberPendingLinqBindingTx.mockResolvedValue(undefined);
  mocks.demoteHostedMemberLinqGroupChatBindingsTx.mockResolvedValue({
    mailboxConsumedAt: null,
  });
  mocks.getPrisma.mockReturnValue({
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)),
  });
  route = await import("../app/api/groups/start/recover/route");
});

function buildRequest(token = "sealed_recovery_token") {
  return new Request("https://murph.example/api/groups/start/recover", {
    body: JSON.stringify({ token }),
    headers: {
      "content-type": "application/json",
      origin: "https://murph.example",
    },
    method: "POST",
  });
}

test("records one temporary sender bridge without creating a group", async () => {
  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "linked",
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).toHaveBeenCalledWith({
    homeLineAssignedAt: null,
    linqChatId: recovery.chatId,
    memberId: "member_existing",
    participantContact: recovery.participantContact,
    participantContactObservedAt: recovery.observedAt,
    prisma: tx,
    recipientPhone: recovery.recipientPhone,
  });
});

test("does not mutate an already connected group", async () => {
  mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValueOnce({
    containerMemberId: "group_runtime",
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "already_connected",
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("refuses to overwrite another pending Messages setup", async () => {
  mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
    pendingLinqChatId: "chat_other",
    pendingLinqParticipantContact: {
      kind: "email",
      lookupKey: "other_contact",
      value: "other@example.com",
    },
    pendingLinqRecipientPhone: "+15559999999",
  });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT" },
  });
  expect(mocks.upsertHostedMemberPendingLinqBindingTx).not.toHaveBeenCalled();
});

test("clears the temporary bridge if the route wins the write race", async () => {
  mocks.readHostedThreadRouteByThreadIdentity
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ containerMemberId: "group_runtime" });

  const response = await route.POST(buildRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    status: "already_connected",
  });
  expect(mocks.demoteHostedMemberLinqGroupChatBindingsTx).toHaveBeenCalledWith({
    linqChatId: recovery.chatId,
    prisma: tx,
  });
});

test("rejects an expired or malformed recovery token", async () => {
  mocks.openHostedLinqGroupEmailRecoveryToken.mockReturnValueOnce(null);

  const response = await route.POST(buildRequest("expired"));

  expect(response.status).toBe(410);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID" },
  });
  expect(mocks.getPrisma).not.toHaveBeenCalled();
});
`,
);

write(
  "agent-docs/exec-plans/completed/2026-07-31-unknown-linq-group-setup-recovery.md",
  `# Unknown Linq group setup recovery

Status: completed
Created: 2026-07-31
Updated: 2026-07-31

## Goal

Let an otherwise valid but unrouted iMessage group recover when its first sender
is not yet an active recognized Murph member, including the case where Apple
Messages sends from an email address instead of the member's phone number.

## Design

- Keep the existing invariant that only a later inbound message from an active,
  recognized member provisions the thread container.
- Send one idempotent setup link in an unknown group. Clicking it only signs in
  or signs up; it never claims or connects the group.
- Use one expiring same-tab browser handoff so the existing auto-trial or Stripe
  success client returns completed setup to the group instruction page. Billing
  APIs and durable account state remain unchanged.
- For an unknown iMessage email sender, send a private short-lived encrypted
  recovery link from the same healthy managed line. Keep its bearer token in the
  URL fragment so it does not enter request logs or referrers.
- Reuse \`HostedMemberRouting.pendingLinqParticipantContact\` plus the exact group
  chat id as a temporary identity bridge. The next message resolves through the
  existing pending-contact lookup, provisions through
  \`ensureHostedThreadContainerRouteTx\`, and the existing group demotion clears
  the temporary binding.
- Add no schema, alias table, claim model, ownership transfer, queue, cron, or
  message backfill.

## Verification

- Focused token, browser handoff, recovery-route, and group planner tests.
- \`apps/web\` typecheck and diff-aware verification in CI.
`,
);
