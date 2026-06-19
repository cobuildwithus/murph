# Murph × Kernel Computer Sessions — Migration Spec

## Executive decision

Build a small **Computer Session** substrate in `apps/web` and expose it to Murph as a handful of dynamic tools. Do **not** wire Murph directly to Kernel CLI or raw Kernel API calls. Murph should get clean primitives such as:

```ts
computer_start_run(...)
computer_observe(...)
computer_act(...)
computer_eval(...)
computer_pause_for_user(...)
computer_finish_run(...)
```

The backend owns Kernel sessions, Kernel profiles, handoff URLs, durable user-pause checkpoints, and user ownership checks. The agent owns planning and browser work.

The cleanest long-term architecture is:

```txt
Murph agent turn
  |
  | dynamic tool call: murph.computer_*
  v
assistant-engine dynamic tool executor
  |
  | signed internal HTTP request
  v
apps/web internal computer-use API
  |
  | Prisma state + Kernel SDK
  v
Kernel browser session + Kernel profile
  |
  | live view iframe / Playwright execution / computer controls later
  v
Websites: Shop Pay, Shopify stores, dentist portals, booking sites
```

This keeps the primitive model simple: **runs**, **profiles**, **handoffs**, and **user-pause checkpoints**.

## What changes from the earlier sketch

The prior idea was basically right, but I would tighten three things:

1. **Login persistence must be first-class.** A plain live browser login only persists cookies/local storage if the Kernel browser is deleted or times out with a profile configured to save changes. For “I only log in once,” we should always use a per-user Kernel profile and explicitly checkpoint after login. For true “once ever,” profile-only cookies are not enough; important domains should graduate to Kernel Managed Auth or 1Password-backed Managed Auth.
2. **No brittle policy engine.** Keep only two hard invariants in the MVP: the run belongs to the user, and final irreversible/sensitive actions must pause the run for a text-channel user confirmation. Do not build a large allowed-domain/action-policy layer yet.
3. **Use Playwright execution as the primary control plane.** Kernel’s Playwright execution API runs inside the browser VM and returns structured data. Add computer-control screenshots/clicks later only when needed for visual or canvas/iframe-heavy flows.

## Confirmed repo facts that shape the design

Murph is a `pnpm` workspace with `packages/*` and `apps/*`, running on Node `>=24.14.1`. The web app is `apps/web`, using Next/Vercel with Prisma, Privy, Temporal, and internal Murph packages. fileciteturn5file0L1-L5 fileciteturn6file0L4-L10 fileciteturn6file0L35-L70

The existing hosted web/API code already has the patterns we should reuse: bounded request bodies, `withJsonError`, `jsonOk`, no-store headers, redacted logging, Prisma-backed state, Privy identity verification, and signed internal callbacks. fileciteturn29file0L127-L206 fileciteturn26file0L15-L17 fileciteturn28file0L42-L53 fileciteturn14file0L40-L64

Murph already has a dynamic tool mechanism in the Codex app-server path. Dynamic tools are registered through `MURPH_DYNAMIC_TOOLS`, passed into Codex thread context, parsed from `item/tool/call`, validated with Zod, and executed through `executeMurphDynamicToolRequest`. fileciteturn49file0L31-L49 fileciteturn50file0L7-L33 fileciteturn50file0L95-L161 fileciteturn61file0L68-L90

Internal hosted callbacks already support signed requests with timestamp, nonce, key id, user id, path/search/method, and payload binding, plus replay protection through Prisma-backed nonces. That is exactly the right authentication shape for `apps/web` internal computer-use APIs called by the hosted runner or dynamic tool executor. fileciteturn71file0L49-L67 fileciteturn71file0L93-L133 fileciteturn71file0L257-L294

The existing hosted execution contracts already model conversation channels (`linq`, `telegram`, `email`, `whatsapp`) and assistant notification requests. That means a “quick confirm before I finish” can be implemented as ordinary conversation/channel output rather than a new approval-card product surface. fileciteturn42file0L69-L77 fileciteturn42file0L101-L148

## Confirmed Kernel facts that shape the design

Kernel’s TypeScript SDK is `@onkernel/sdk`; creating a browser returns a session object with `session_id`, `cdp_ws_url`, `webdriver_ws_url`, and `browser_live_view_url`. Kernel browsers can also run Playwright code through `kernel.browsers.playwright.execute(session_id, { code })`. citeturn718137view1

Kernel recommends agent control through computer controls or Playwright execution, and specifically says Playwright execution runs co-located with the browser VM, has `page`, `context`, and `browser` in scope, and returns structured values. citeturn718137view2

Every Kernel browser exposes a `browser_live_view_url` that can be opened in a browser tab or embedded in an iframe for human-in-the-loop handoff. Kernel also supports `?readOnly=true` for non-interactive views. citeturn238046view0

Kernel profiles persist cookies and local storage across browser sessions. To persist changes, create the browser with `profile: { name, save_changes: true }`, then explicitly delete the Kernel browser when finished; calling `browser.close()` alone does not save profile state. citeturn238046view4 citeturn238046view5

Kernel Managed Auth is the way to get closer to “log in once ever”: a Managed Auth connection attaches an authenticated domain to a profile, users can complete the login through hosted or custom UI, and future browsers created with that profile can start logged in. Kernel can also use stored credentials to re-authenticate automatically when sessions expire. citeturn238046view6 citeturn876751view2 citeturn876751view3

Kernel credentials are encrypted at rest, write-only, not logged, and not passed to LLMs. Kernel can also use 1Password credentials without storing credential values in Kernel; values remain in 1Password and are retrieved at authentication time. citeturn876751view6 citeturn238046view8

## Product behavior

### Supplement purchase

```txt
User: "Buy me the Bryan Johnson supplement."

Murph:
1. Starts/reuses a Kernel computer run with the user's commerce profile.
2. Navigates to the site and cart/checkout with Playwright.
3. If Shop Pay/login/payment is needed, sends a Murph handoff link.
4. User opens Murph link, signs in inside the embedded browser, clicks Done.
5. Murph checkpoints the profile, resumes, and rebuilds cart if needed.
6. Before final order submit, Murph calls `computer_pause_for_user(reason="final_confirmation")`, then texts:
   "Quick confirm: I found [product], quantity [n], total [$x], shipping to [city/address hint]. Want me to place it?"
7. User replies yes/no in the normal text channel.
8. Murph submits only after yes.
```

### Dentist appointment

```txt
User: "Book me a dentist appointment."

Murph:
1. Starts/reuses a Kernel computer run with the user's appointments profile.
2. Searches/uses the dentist portal or booking site.
3. If portal login or insurance/payment details are needed, sends a handoff link.
4. User completes login/details inside Murph live-view page.
5. Murph finds candidate slot.
6. Before final submit, Murph calls `computer_pause_for_user(reason="final_confirmation")`, then texts:
   "Quick confirm: I can book [provider] on [date/time] at [location]. Should I book it?"
7. User replies yes/no.
8. Murph books only after yes.
```

No approval card is required. The confirmation is a normal text-channel checkpoint.

## Core primitives

### 1. Computer profile

A durable per-user Kernel profile reference.

```ts
type ComputerProfileKey =
  | "commerce"
  | "appointments"
  | "default";

type HostedComputerProfile = {
  id: string;
  memberId: string;
  profileKey: ComputerProfileKey;
  kernelProfileName: string;
  lastCheckpointAt: string | null;
  lastAuthenticatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Recommended profile naming:

```txt
murph-{environment}-{memberId}-{profileKey}
```

Use `commerce` for Shop Pay / Shopify / retail checkout, `appointments` for health/dentist portals, and `default` for everything else. Do **not** create one Kernel profile per website at first; that causes unnecessary fragmentation.

### 2. Computer run

An active or recently completed browser session.

```ts
type ComputerRunStatus =
  | "running"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "expired"
  | "canceled";

type ComputerAwaitingReason =
  | "login_needed"
  | "payment_needed"
  | "final_confirmation"
  | "stuck"
  | "other";

type HostedComputerRun = {
  id: string;
  memberId: string;
  profileId: string;
  status: ComputerRunStatus;
  goal: string;
  taskKind: "purchase" | "appointment" | "auth" | "generic";
  kernelSessionId: string | null;
  kernelLiveViewUrlEncrypted: string | null;
  kernelCdpWsUrlEncrypted: string | null;
  lastUrl: string | null;
  lastTitle: string | null;
  awaitingReason: ComputerAwaitingReason | null;
  awaitingMessage: string | null;
  suggestedReply: string | null;
  pausedAt: string | null;
  resumedAt: string | null;
  pendingHandoffId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

### 3. Handoff

A short-lived, one-time Murph URL that renders the live browser iframe.

```ts
type ComputerHandoffPurpose =
  | "login"
  | "payment"
  | "card"
  | "captcha"
  | "manual_browser_help";

type HostedComputerHandoff = {
  id: string;
  runId: string;
  memberId: string;
  tokenHash: string;
  purpose: ComputerHandoffPurpose;
  status: "open" | "completed" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  completedAt: string | null;
  resumeMessage: string;
};
```

The raw Kernel live-view URL should never be sent directly to the user. The user receives:

```txt
https://murph.app/computer/handoff/{token}
```

The Murph page verifies token, user/session ownership, run status, and expiry before rendering the Kernel iframe.

### 4. User-pause checkpoint

```ts
type ComputerPauseForUser = {
  runId: string;
  reason: ComputerAwaitingReason;
  message: string;
  handoffUrl: string | null;
  suggestedReply: string | null;
  pausedAt: string;
};
```

No approval card is required. `computer_pause_for_user` stores this state durably, optionally creates a handoff URL, sends the text through Murph's existing channel delivery dependency, and returns control so the Codex turn can end.

The resume path is explicit and durable:

- `computer_observe`, `computer_act`, and `computer_eval` must not auto-clear an `awaiting_user` checkpoint.
- A later user reply resumes through `computer_start_run`. The model does not provide confirmation text, accepted-input evidence, or a resume token.
- `apps/web` only marks an `awaiting_user` run running when it finds a newer hosted `conversation.message` mailbox item for the same member; the same Codex turn is also locked out of additional computer tools after a pause request.
- Handoff URLs and tokenized pause messages are user-channel capabilities. They may be sent to the user, but must not be returned in Codex-visible tool output. Tool results should expose only sanitized metadata such as `runId`, `status`, `awaitingReason`, and `handoffCreated`.

On the next user reply, the agent reuses or discovers the active pending run. The backend resumes only when it finds a same-member conversation message newer than the pause; a completed handoff helps identify the pending run, but it is not by itself confirmation to continue.

## Why this satisfies “log in once”

There are two levels:

### MVP: profile login

The user logs in manually through a live-view handoff. The run is attached to a Kernel profile with `save_changes: true`. After login, Murph explicitly deletes the Kernel browser to persist cookies/local storage into the profile, then starts a fresh browser with the same profile and navigates back to the task.

This gives “log in once until the site expires/revokes the session.” It is simple and should work for many Shopify/Shop Pay flows.

### Long-term: Managed Auth login

For domains that matter, especially Shop Pay / Shopify / recurring dentist portals, create Kernel Managed Auth connections attached to the same user profile. Kernel’s auth connection stores/maintains authenticated session state, and with credentials or 1Password it can re-authenticate after session expiry without involving the user.

This is the version that actually matches “I should only have to log in once ever.” Profile cookies alone cannot promise that forever because websites expire sessions.

Recommended rollout:

```txt
Phase 1: Profile-only live-view login + explicit profile checkpoint.
Phase 2: Managed Auth for common domains: shop.app, shopify.com, accounts.shopify.com.
Phase 3: Optional 1Password provider for users who want true credential-backed re-auth without Murph or Kernel storing raw values.
```

## Database migration

Add these models to `apps/web/prisma/schema.prisma`.

```prisma
enum HostedComputerRunStatus {
  running
  awaiting_user
  completed
  failed
  expired
  canceled
}

enum HostedComputerAwaitingReason {
  login_needed
  payment_needed
  final_confirmation
  stuck
  other
}

enum HostedComputerTaskKind {
  purchase
  appointment
  auth
  generic
}

enum HostedComputerHandoffStatus {
  open
  completed
  expired
  revoked
}

model HostedComputerProfile {
  id                    String              @id
  memberId              String              @map("member_id")
  profileKey            String              @map("profile_key")
  kernelProfileName     String              @unique @map("kernel_profile_name")
  lastCheckpointAt      DateTime?           @map("last_checkpoint_at")
  lastAuthenticatedAt   DateTime?           @map("last_authenticated_at")
  metadataJson          Json?               @map("metadata_json")
  createdAt             DateTime            @default(now()) @map("created_at")
  updatedAt             DateTime            @updatedAt @map("updated_at")
  member                HostedMember        @relation(fields: [memberId], references: [id], onDelete: Cascade)
  runs                  HostedComputerRun[]

  @@unique([memberId, profileKey])
  @@index([memberId])
  @@map("hosted_computer_profile")
}

model HostedComputerRun {
  id                         String                   @id
  memberId                   String                   @map("member_id")
  profileId                  String                   @map("profile_id")
  status                     HostedComputerRunStatus  @default(running)
  taskKind                   HostedComputerTaskKind   @default(generic) @map("task_kind")
  goal                       String
  kernelSessionId            String?                  @map("kernel_session_id")
  kernelLiveViewUrlEncrypted String?                  @map("kernel_live_view_url_encrypted")
  kernelCdpWsUrlEncrypted    String?                  @map("kernel_cdp_ws_url_encrypted")
  lastUrl                    String?                  @map("last_url")
  lastTitle                  String?                  @map("last_title")
  awaitingReason             HostedComputerAwaitingReason? @map("awaiting_reason")
  awaitingMessage            String?                  @map("awaiting_message")
  suggestedReply             String?                  @map("suggested_reply")
  pausedAt                   DateTime?                @map("paused_at")
  resumedAt                  DateTime?                @map("resumed_at")
  pendingHandoffId           String?                  @map("pending_handoff_id")
  metadataJson               Json?                    @map("metadata_json")
  lastErrorCode              String?                  @map("last_error_code")
  lastErrorMessage           String?                  @map("last_error_message")
  expiresAt                  DateTime                 @map("expires_at")
  createdAt                  DateTime                 @default(now()) @map("created_at")
  updatedAt                  DateTime                 @updatedAt @map("updated_at")
  completedAt                DateTime?                @map("completed_at")
  member                     HostedMember             @relation(fields: [memberId], references: [id], onDelete: Cascade)
  profile                    HostedComputerProfile    @relation(fields: [profileId], references: [id], onDelete: Cascade)
  handoffs                   HostedComputerHandoff[]

  @@index([memberId, status, updatedAt])
  @@index([status, expiresAt])
  @@index([profileId, updatedAt])
  @@map("hosted_computer_run")
}

model HostedComputerHandoff {
  id              String                       @id
  runId           String                       @map("run_id")
  memberId        String                       @map("member_id")
  tokenHash       String                       @unique @map("token_hash")
  purpose         String
  status          HostedComputerHandoffStatus  @default(open)
  resumeMessage   String                       @map("resume_message")
  createdAt       DateTime                     @default(now()) @map("created_at")
  expiresAt       DateTime                     @map("expires_at")
  openedAt        DateTime?                    @map("opened_at")
  completedAt     DateTime?                    @map("completed_at")
  member          HostedMember                 @relation(fields: [memberId], references: [id], onDelete: Cascade)
  run             HostedComputerRun            @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([memberId, status, expiresAt])
  @@index([runId, status])
  @@index([expiresAt])
  @@map("hosted_computer_handoff")
}
```

Also add relations to `HostedMember`:

```prisma
computerProfiles HostedComputerProfile[]
computerRuns     HostedComputerRun[]
computerHandoffs HostedComputerHandoff[]
```

Do not add a Murph password table.

## File map

```txt
packages/hosted-execution/src/computer-use.ts
  Shared schemas/types for dynamic tools and apps/web routes.

packages/hosted-execution/package.json
  Export ./computer-use.

packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
  Add murph.computer_* tool definitions, Zod validators, request union cases, and executor calls.

apps/web/src/lib/computer-use/kernel-client.ts
  Thin Kernel SDK adapter. No Prisma.

apps/web/src/lib/computer-use/store.ts
  Prisma reads/writes for profiles, runs, handoffs, and pause checkpoints.

apps/web/src/lib/computer-use/service.ts
  Orchestrates Kernel + store + state transitions.

apps/web/src/lib/computer-use/http.ts
  Route helpers, request parsers, domain errors.

apps/web/app/api/internal/computer/runs/route.ts
apps/web/app/api/internal/computer/runs/[runId]/observe/route.ts
apps/web/app/api/internal/computer/runs/[runId]/act/route.ts
apps/web/app/api/internal/computer/runs/[runId]/eval/route.ts
apps/web/app/api/internal/computer/runs/[runId]/pause-for-user/route.ts
apps/web/app/api/internal/computer/runs/[runId]/finish/route.ts
  Signed internal APIs called by dynamic tools.

apps/web/app/computer/handoff/[token]/page.tsx
apps/web/app/api/computer/handoff/[token]/done/route.ts
  User-facing handoff page and Done button.
```

## Shared contract sketch

`packages/hosted-execution/src/computer-use.ts`:

```ts
import { z } from "zod";

export const HOSTED_COMPUTER_RUN_STATUS = [
  "running",
  "awaiting_user",
  "completed",
  "failed",
  "expired",
  "canceled",
] as const;

export const hostedComputerStartRunRequestSchema = z.object({
  goal: z.string().trim().min(1).max(2_000),
  taskKind: z.enum(["purchase", "appointment", "auth", "generic"]).default("generic"),
  profileKey: z.enum(["commerce", "appointments", "default"]).default("default"),
  startUrl: z.string().url().nullable().default(null),
}).strict();

export const hostedComputerObserveRequestSchema = z.object({}).strict();

export const hostedComputerActRequestSchema = z.object({
  action: z.enum(["goto", "click", "fill", "press", "select", "check", "uncheck"]),
  selector: z.string().trim().min(1).max(1_000).nullable().default(null),
  url: z.string().url().nullable().default(null),
  value: z.string().max(4_000).nullable().default(null),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
}).strict();

export const hostedComputerEvalRequestSchema = z.object({
  code: z.string().trim().min(1).max(20_000),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
}).strict();

export const hostedComputerPauseForUserRequestSchema = z.object({
  reason: z.enum(["login_needed", "payment_needed", "final_confirmation", "stuck", "other"]),
  message: z.string().trim().min(1).max(1_000),
  handoffPurpose: z.enum(["login", "payment", "card", "captcha", "manual_browser_help"]).nullable().default(null),
  suggestedReply: z.string().trim().min(1).max(200).nullable().default(null),
}).strict();

export type HostedComputerStartRunRequest = z.infer<typeof hostedComputerStartRunRequestSchema>;
export type HostedComputerObserveRequest = z.infer<typeof hostedComputerObserveRequestSchema>;
export type HostedComputerActRequest = z.infer<typeof hostedComputerActRequestSchema>;
export type HostedComputerEvalRequest = z.infer<typeof hostedComputerEvalRequestSchema>;
export type HostedComputerPauseForUserRequest = z.infer<typeof hostedComputerPauseForUserRequestSchema>;
```

## Kernel adapter sketch

`apps/web/src/lib/computer-use/kernel-client.ts`:

```ts
import Kernel, { ConflictError } from "@onkernel/sdk";

export interface KernelBrowserHandle {
  cdpWsUrl: string;
  liveViewUrl: string;
  sessionId: string;
}

export class KernelComputerClient {
  private readonly kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });

  async ensureProfile(name: string): Promise<void> {
    try {
      await this.kernel.profiles.create({ name });
    } catch (error) {
      if (error instanceof ConflictError) return;
      throw error;
    }
  }

  async createBrowser(input: {
    profileName: string;
    saveChanges: boolean;
    startUrl?: string | null;
  }): Promise<KernelBrowserHandle> {
    const browser = await this.kernel.browsers.create({
      profile: {
        name: input.profileName,
        save_changes: input.saveChanges,
      },
      ...(input.startUrl ? { start_url: input.startUrl } : {}),
      stealth: true,
    });

    return {
      sessionId: browser.session_id,
      liveViewUrl: browser.browser_live_view_url,
      cdpWsUrl: browser.cdp_ws_url,
    };
  }

  async executePlaywright(input: {
    sessionId: string;
    code: string;
    timeoutMs: number;
  }): Promise<unknown> {
    const response = await this.kernel.browsers.playwright.execute(input.sessionId, {
      code: input.code,
      timeout_ms: input.timeoutMs,
    });
    return response.result;
  }

  async captureScreenshot(sessionId: string): Promise<unknown> {
    return await this.kernel.browsers.computer.captureScreenshot(sessionId);
  }

  async deleteBrowser(sessionId: string): Promise<void> {
    await this.kernel.browsers.deleteByID(sessionId);
  }
}
```

Keep this adapter intentionally small. If Kernel SDK names drift, only this file changes.

## Service sketch

`apps/web/src/lib/computer-use/service.ts`:

```ts
export class ComputerUseService {
  constructor(
    private readonly kernel: KernelComputerClient,
    private readonly store: ComputerUseStore,
    private readonly crypto: ComputerUseCrypto,
  ) {}

  async startRun(input: {
    memberId: string;
    goal: string;
    taskKind: "purchase" | "appointment" | "auth" | "generic";
    profileKey: "commerce" | "appointments" | "default";
    startUrl?: string | null;
  }) {
    const profile = await this.store.upsertProfile({
      memberId: input.memberId,
      profileKey: input.profileKey,
      kernelProfileName: buildKernelProfileName(input.memberId, input.profileKey),
    });

    await this.kernel.ensureProfile(profile.kernelProfileName);

    const browser = await this.kernel.createBrowser({
      profileName: profile.kernelProfileName,
      saveChanges: true,
      startUrl: input.startUrl ?? null,
    });

    return await this.store.createRun({
      memberId: input.memberId,
      profileId: profile.id,
      goal: input.goal,
      taskKind: input.taskKind,
      kernelSessionId: browser.sessionId,
      kernelLiveViewUrlEncrypted: await this.crypto.encrypt(browser.liveViewUrl),
      kernelCdpWsUrlEncrypted: await this.crypto.encrypt(browser.cdpWsUrl),
      expiresAt: computeComputerRunExpiry(),
    });
  }

  async eval(input: {
    memberId: string;
    runId: string;
    code: string;
    timeoutMs: number;
  }) {
    const run = await this.store.requireOwnedRunningRun(input.memberId, input.runId);
    const result = await this.kernel.executePlaywright({
      sessionId: requireKernelSessionId(run),
      code: input.code,
      timeoutMs: input.timeoutMs,
    });
    await this.store.touchRunFromPlaywrightResult(run.id, result);
    return { result };
  }

  async pauseForUser(input: {
    memberId: string;
    runId: string;
    reason: ComputerAwaitingReason;
    message: string;
    handoffPurpose?: ComputerHandoffPurpose | null;
    suggestedReply?: string | null;
  }) {
    const run = await this.store.requireOwnedRunningRun(input.memberId, input.runId);
    const handoff = input.handoffPurpose
      ? await this.createHandoff({ memberId: input.memberId, runId: run.id, purpose: input.handoffPurpose })
      : null;
    await this.store.markRunAwaitingUser({
      awaitingMessage: handoff
        ? `${input.message}\n\n${handoff.handoffUrl}`
        : input.message,
      awaitingReason: input.reason,
      pendingHandoffId: handoff?.id ?? null,
      runId: run.id,
      suggestedReply: input.suggestedReply ?? null,
    });

    return {
      handoffUrl: handoff?.handoffUrl ?? null,
      message: handoff ? `${input.message}\n\n${handoff.handoffUrl}` : input.message,
    };
  }

  async finishRun(input: {
    memberId: string;
    runId: string;
    outcome: "completed" | "failed" | "canceled";
    error?: { code: string; message: string } | null;
  }) {
    const run = await this.store.requireOwnedRun(input.memberId, input.runId);
    if (run.kernelSessionId) {
      await this.kernel.deleteBrowser(run.kernelSessionId);
    }
    return await this.store.finishRun(run.id, input.outcome, input.error ?? null);
  }
}
```

The important state transition is `pauseForUser`: it persists an awaiting-user checkpoint and lets the Codex turn end. For login handoffs, the public Done route can checkpoint and reopen the Kernel browser before marking the handoff completed. The run stays `awaiting_user` until a later same-member chat reply lets `computer_start_run` clear the checkpoint.

## Internal API routes

Use signed internal routes, not public user auth, for agent/tool calls.

Pattern:

```ts
export const POST = withJsonError(async (request: Request, context) => {
  const payloadText = await readRawBodyBuffer(request, { limitBytes: COMPUTER_MAX_BODY_BYTES })
    .then((buffer) => buffer.toString("utf8"));

  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: COMPUTER_MAX_BODY_BYTES,
    payloadText,
  });

  const body = parseComputerRouteRequest(JSON.parse(payloadText));
  const service = createComputerUseService();
  const result = await service.someOperation({ memberId, ...body });

  return jsonOk(result);
});
```

Routes:

```txt
POST /api/internal/computer/runs
  body: HostedComputerStartRunRequest
  returns: { runId, status }

POST /api/internal/computer/runs/:runId/observe
  body: HostedComputerObserveRequest
  returns: { runId, status, url, title, visibleText }

POST /api/internal/computer/runs/:runId/act
  body: HostedComputerActRequest
  returns: { result, url, title }

POST /api/internal/computer/runs/:runId/eval
  body: HostedComputerEvalRequest
  returns: { result }

POST /api/internal/computer/runs/:runId/pause-for-user
  body: HostedComputerPauseForUserRequest
  returns: { runId, status, awaitingReason, message, handoffUrl }

POST /api/internal/computer/runs/:runId/finish
  body: { outcome: "completed" | "failed" | "canceled"; error?: { code: string; message: string } | null }
  returns: { ok: true }
```

Do not expose Kernel session IDs or live-view URLs through these API responses unless strictly needed by an internal tool. Prefer `runId` handles.

## Handoff page

`apps/web/app/computer/handoff/[token]/page.tsx`:

Behavior:

1. Hash the token.
2. Load open handoff by token hash.
3. Require not expired and not revoked.
4. Load run and member.
5. Require current logged-in Murph web session to match the handoff member.
6. Decrypt live-view URL.
7. Render iframe.
8. Show Done button.
9. On Done, POST `/api/computer/handoff/[token]/done`.
10. Mark the handoff completed and the run resumable. For login handoffs, checkpoint/reopen the Kernel browser while keeping the run `awaiting_user`.
11. Show copyable/prefilled suggested reply, e.g. “I just logged in.”

Sketch:

```tsx
export default async function ComputerHandoffPage({ params }: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await requireHostedWebUser();
  const handoff = await computerUseService.requireOpenHandoffForToken({
    token,
    memberId: user.memberId,
  });

  return (
    <main>
      <h1>Finish this browser step</h1>
      <p>After you click Done, return to the chat and reply so Murph can continue.</p>
      <iframe
        src={handoff.liveViewUrl}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        style={{ width: "100%", height: "80vh", border: 0 }}
      />
      <form action={`/api/computer/handoff/${token}/done`} method="post">
        <button type="submit">Done</button>
      </form>
    </main>
  );
}
```

After Done, either:

- show `Return to Murph and send: "I just logged in"`; or
- render a channel-specific deep link with the message prefilled.

For iMessage/SMS this may be limited by platform behavior, so the reliable default is: mark the handoff completed server-side and show a copyable message.

## Dynamic tools

Add six dynamic tools to `MURPH_DYNAMIC_TOOLS`.

### `murph.computer_start_run`

```ts
{
  namespace: "murph",
  name: "computer_start_run",
  description: "Start a Kernel-backed browser session for web tasks that require checkout, appointment booking, login, or general website automation. Returns a run id. Reuse pending runs when possible.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      goal: { type: "string", minLength: 1, maxLength: 2000 },
      taskKind: { type: "string", enum: ["purchase", "appointment", "auth", "generic"], default: "generic" },
      profileKey: { type: "string", enum: ["commerce", "appointments", "default"], default: "default" },
      startUrl: { anyOf: [{ type: "string" }, { type: "null" }], default: null }
    },
    required: ["goal"]
  }
}
```

### `murph.computer_observe`

```ts
{
  namespace: "murph",
  name: "computer_observe",
  description: "Read the current browser state for a computer run, including URL, title, and visible page text. Use after starting or resuming a run before acting.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      runId: { type: "string", minLength: 1 }
    },
    required: ["runId"]
  }
}
```

### `murph.computer_act`

```ts
{
  namespace: "murph",
  name: "computer_act",
  description: "Perform a simple browser action for a computer run, such as navigating, clicking, filling, pressing a key, selecting, checking, or unchecking.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      runId: { type: "string", minLength: 1 },
      action: { type: "string", enum: ["goto", "click", "fill", "press", "select", "check", "uncheck"] },
      selector: { anyOf: [{ type: "string", minLength: 1, maxLength: 1000 }, { type: "null" }], default: null },
      url: { anyOf: [{ type: "string" }, { type: "null" }], default: null },
      value: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }], default: null },
      timeoutMs: { type: "number", minimum: 1000, maximum: 60000, default: 30000 }
    },
    required: ["runId", "action"]
  }
}
```

### `murph.computer_eval`

```ts
{
  namespace: "murph",
  name: "computer_eval",
  description: "Run Playwright TypeScript/JavaScript code inside the active Kernel browser VM for a computer run. Use when observe/act is not expressive enough.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      runId: { type: "string", minLength: 1 },
      code: { type: "string", minLength: 1, maxLength: 20000 },
      timeoutMs: { type: "number", minimum: 1000, maximum: 60000, default: 30000 }
    },
    required: ["runId", "code"]
  }
}
```

### `murph.computer_pause_for_user`

```ts
{
  namespace: "murph",
  name: "computer_pause_for_user",
  description: "Pause a computer run for user input, store a durable checkpoint, optionally create a secure browser handoff link, and send the message through the current Murph channel.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      runId: { type: "string", minLength: 1 },
      reason: { type: "string", enum: ["login_needed", "payment_needed", "final_confirmation", "stuck", "other"] },
      message: { type: "string", minLength: 1, maxLength: 1000 },
      handoffPurpose: { anyOf: [{ type: "string", enum: ["login", "payment", "card", "captcha", "manual_browser_help"] }, { type: "null" }], default: null },
      suggestedReply: { anyOf: [{ type: "string", minLength: 1, maxLength: 200 }, { type: "null" }], default: null }
    },
    required: ["runId", "reason", "message"]
  }
}
```

### `murph.computer_finish_run`

```ts
{
  namespace: "murph",
  name: "computer_finish_run",
  description: "Finish a computer run and close the Kernel browser, persisting profile changes when configured.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      runId: { type: "string", minLength: 1 },
      outcome: { type: "string", enum: ["completed", "failed", "canceled"] },
      summary: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }], default: null }
    },
    required: ["runId", "outcome"]
  }
}
```

## Dynamic tool executor sketch

Add a small client in `dynamic-tools.ts` or a neighboring file:

```ts
async function callHostedComputerApi(input: {
  fetchImpl: typeof fetch;
  method: "POST";
  path: string;
  body: unknown;
}): Promise<unknown> {
  const baseUrl = "http://web-control.worker";
  const payload = JSON.stringify(input.body ?? {});
  const response = await input.fetchImpl(new URL(input.path, baseUrl), {
    method: input.method,
    headers: {
      "content-type": "application/json",
    },
    body: payload,
  });

  if (!response.ok) {
    return { ok: false, status: response.status, error: await response.text() };
  }

  return await response.json();
}
```

In hosted runtime this request goes through the Worker-owned `web-control.worker` proxy, which allowlists the route and adds the existing signed internal callback headers. Do not put the web callback signing private key into the assistant runner environment.

## Agent instructions

Add a short tool-use instruction to the hosted assistant prompt, not a giant policy system:

```txt
For website tasks requiring login, checkout, appointment booking, payment, health/insurance forms, or other external browser actions, use the murph.computer_* tools.

Use murph.computer_observe before acting on a resumed run. Use murph.computer_act for simple browser actions and murph.computer_eval when a task needs custom Playwright code.

When the user must log in, enter payment/card details, solve a challenge, manually inspect a page, or make a final confirmation, call murph.computer_pause_for_user. The tool stores a durable pause checkpoint and sends the message through the current Murph channel.

Before placing an order, booking an appointment, authorizing payment, submitting insurance/health information, or performing any irreversible action, call murph.computer_pause_for_user with reason="final_confirmation". End the turn after the pause and continue only in a later turn if the user clearly confirms.

Do not ask the user to log in again if the relevant Kernel profile already appears authenticated. If auth is expired, ask for handoff once and checkpoint the profile afterward.
```

## Resumption behavior

When a user replies “I just logged in” or “yes book it,” the next Murph turn should be able to find active pending runs.

Add a helper:

```ts
findLatestPendingComputerRun(memberId: string): Promise<HostedComputerRun | null>
```

Priority order:

```txt
1. awaiting_user with completed handoff
2. awaiting_user with reason final_confirmation
3. running, updated recently
```

The agent can then call `computer_start_run` for the same task/profile. Browser resume, not Codex turn resume, is the correctness boundary.
The backend clears `awaiting_user` only after a same-member hosted `conversation.message` mailbox item newer than the pause. Browser actions and model-provided text never clear the checkpoint directly.

## Minimal safeguards

Do not build a brittle policy engine now. Keep only these primitives:

1. **Ownership:** every run/handoff/profile is keyed by `memberId`; all internal APIs require signed user id; all public handoff routes require matching logged-in user.
2. **Secret containment:** Kernel API key only in `apps/web`; raw Kernel live-view URLs encrypted at rest; Murph agent sees Murph handoff URLs, not Kernel URLs.
3. **Login durability:** after user login handoff, checkpoint Kernel profile through the public Done route, then require a later chat reply before returning the run to `running`.
4. **Final confirm:** final irreversible/sensitive actions pause the run with `reason="final_confirmation"` and use text-channel confirmation.
5. **Best-effort cleanup:** close/delete Kernel browser on finish, timeout, or error.

That is enough for MVP without turning the system into a fragile rules engine.

## Implementation order

### PR 1 — shared contracts

- Add `packages/hosted-execution/src/computer-use.ts`.
- Export it in `packages/hosted-execution/package.json`.
- Add unit tests for request schemas.

### PR 2 — Prisma migration

- Add `HostedComputerProfile`, `HostedComputerRun`, `HostedComputerHandoff`.
- Add `HostedMember` relations.
- Add migration.
- Add store tests for ownership, token hash lookup, expiry, status transitions.

### PR 3 — Kernel adapter and service

- Add `apps/web/src/lib/computer-use/kernel-client.ts`.
- Add `store.ts`, `service.ts`, `crypto.ts`, `errors.ts`, `http.ts`.
- Add env validation for `KERNEL_API_KEY` and `HOSTED_WEB_BASE_URL`.
- Unit test service with a fake Kernel client.

### PR 4 — internal APIs

- Add signed internal routes under `/api/internal/computer/*`.
- Reuse `requireHostedCloudflareCallbackRequest` or extract a generic signed internal request helper if the name is too Cloudflare-specific.
- Use bounded raw body reads and route JSON helpers.
- Add route tests for auth-before-parse where applicable, replay, wrong user, expired run, and oversized payload.

### PR 5 — handoff UI

- Add `/computer/handoff/[token]` page.
- Add `/api/computer/handoff/[token]/done` route.
- Require logged-in web member match.
- Render iframe and Done button.
- Add UX copy and channel-specific resume prompt.

### PR 6 — dynamic tools

- Add `murph.computer_*` tool definitions.
- Add Zod schemas and request union cases.
- Add execution branch that calls internal apps/web APIs.
- Add tests for valid/invalid tool args and hosted API error shaping.

### PR 7 — prompt/skill update

- Add a small computer-use section to assistant instructions.
- Optional: add a `computer-use` skill file if skill-loading is cleaner than baking it into base instructions.

### PR 8 — Managed Auth follow-up

- Add optional `ComputerAuthConnection` model only when needed.
- First target: Shop Pay / Shopify.
- Keep the external primitive the same: `computer_pause_for_user`. Backend can decide whether that pause uses profile-live-view mode or Managed Auth mode.

## Stress tests

### Stress test 1 — “log in once” durability

Failure mode: user logs into Shop Pay through live view, Murph continues, but the browser expires before Kernel profile state is persisted.

Design response:

- All runs use a Kernel profile with `save_changes: true`.
- After login handoff completion, the public Done route checkpoints the profile.
- That can delete the current Kernel browser, which persists cookies/local storage, and open a fresh browser with the same profile.
- If a cart is lost during checkpoint, Murph rebuilds the cart. Login state is more important than preserving transient cart state.

Remaining limitation:

- Profile-only login cannot promise “forever” if the website expires sessions. For true once-ever behavior, use Kernel Managed Auth or 1Password-backed auth connections for important domains.

### Stress test 2 — Vercel/serverless durability

Failure mode: Vercel cannot hold a long-lived Playwright connection or browser process.

Design response:

- Kernel hosts the browser; Vercel stores run metadata and calls Kernel per operation.
- Every API request is stateless and short-lived.
- Playwright code executes inside Kernel’s browser VM, not in a long-lived Vercel Playwright process.
- Reconnect/retry is based on `runId` and `kernelSessionId` from Prisma.

### Stress test 3 — model portability

Failure mode: native OpenAI computer-use actions lock Murph to OpenAI.

Design response:

- Murph exposes normal dynamic tools with JSON schemas.
- The primary control primitives are `computer_observe`, `computer_act`, and `computer_eval`.
- Future Anthropic/OpenAI/Gemini agents can call the same tool contract.
- Kernel computer controls can be added later behind the same `ComputerUseService` without changing the product API.

### Stress test 4 — accidental irreversible action

Failure mode: agent clicks “Place order” or “Book appointment” too early.

Design response:

- The MVP does not implement brittle DOM blockers.
- The assistant instruction and tool model require `computer_pause_for_user` with `reason="final_confirmation"` before irreversible/sensitive actions.
- The run status becomes `awaiting_user`.
- The agent resumes in a later turn only after the user clearly confirms in the normal text channel.
- For higher-risk domains later, add a tiny `confirmedAt` requirement to a specialized `computer_commit_action` primitive rather than a broad policy engine.

### Stress test 5 — handoff link leak

Failure mode: someone else opens the handoff link.

Design response:

- Handoff token is opaque, short-lived, single-use, and stored only as a hash.
- The handoff page requires a logged-in Murph web session matching `memberId`.
- Kernel live-view URL is not sent directly to the user and is encrypted at rest.
- Completing handoff marks the token completed and prevents replay.

## What not to build yet

Do not build these in the first migration:

- A giant per-domain allowlist/policy engine.
- A custom browser farm.
- A native OpenAI computer-use harness.
- A separate microservice before `apps/web` proves insufficient.
- A Murph-managed password vault.
- Sophisticated cart/order approval UI.
- Full visual computer-control loop unless Playwright proves insufficient.

## Final architecture in one sentence

Add a Kernel-backed `ComputerUseService` in `apps/web`, expose it through signed internal APIs and six small Murph dynamic tools, persist login state through per-user Kernel profiles with server-owned checkpointing, and use durable `computer_pause_for_user` checkpoints for login/payment/final-confirmation/user-help pauses.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
