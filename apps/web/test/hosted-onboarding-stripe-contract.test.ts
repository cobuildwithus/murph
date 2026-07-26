import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, test } from "vitest";

const STRIPE_API_VERSION = "2026-04-22.dahlia";
const RUN_STRIPE_BILLING_CONTRACT =
  process.env.MURPH_RUN_STRIPE_BILLING_CONTRACT === "1";
const STRIPE_CLI_PROFILE =
  process.env.MURPH_STRIPE_CLI_PROFILE?.trim() ?? "";
const CLI_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 180_000;
const RUN_METADATA_KEY = "murph_contract_run";
const runId = randomUUID();

type JsonRecord = Record<string, unknown>;
type StripeCliCommand = "delete" | "get" | "post";

type StripeRequestOptions = {
  data?: readonly string[];
  expand?: readonly string[];
  idempotencyKey?: string;
};

type TestClockContext = {
  frozenTime: number;
  id: string;
};

type PausedSubscriptionFixture = {
  customerId: string;
  subscriptionId: string;
};

type ActiveSubscriptionFixture = {
  customerId: string;
  paymentMethodId: string;
  subscriptionId: string;
  subscriptionItemId: string;
};

type CleanupSummary = {
  clocks: number;
  failures: number;
  prices: number;
  products: number;
};

const activeClockIds = new Set<string>();
const cleanupSummary: CleanupSummary = {
  clocks: 0,
  failures: 0,
  prices: 0,
  products: 0,
};

let productId: string | null = null;
let priceId: string | null = null;
let edgePriceId: string | null = null;

if (RUN_STRIPE_BILLING_CONTRACT && STRIPE_CLI_PROFILE.length === 0) {
  throw new Error(
    "Stripe billing contract requires an explicit Stripe CLI test profile.",
  );
}

function contractFailure(message: string): never {
  throw new Error(message);
}

function assertContract(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    contractFailure(message);
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
  );
}

function asRecord(value: unknown, message: string): JsonRecord {
  assertContract(isJsonRecord(value), message);
  return value;
}

function readRecord(
  record: JsonRecord,
  key: string,
  message: string,
): JsonRecord {
  return asRecord(record[key], message);
}

function readNullableRecord(
  record: JsonRecord,
  key: string,
  message: string,
): JsonRecord | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  return asRecord(value, message);
}

function readArray(
  record: JsonRecord,
  key: string,
  message: string,
): readonly unknown[] {
  const value = record[key];
  assertContract(Array.isArray(value), message);
  return value;
}

function readString(
  record: JsonRecord,
  key: string,
  message: string,
): string {
  const value = record[key];
  assertContract(typeof value === "string" && value.length > 0, message);
  return value;
}

function readOptionalString(
  record: JsonRecord,
  key: string,
  message: string,
): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  assertContract(typeof value === "string", message);
  return value;
}

function readNumber(
  record: JsonRecord,
  key: string,
  message: string,
): number {
  const value = record[key];
  assertContract(typeof value === "number" && Number.isFinite(value), message);
  return value;
}

function readObjectId(
  record: JsonRecord,
  key: string,
  message: string,
): string {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return readString(asRecord(value, message), "id", message);
}

function readOptionalObjectId(
  record: JsonRecord,
  key: string,
  message: string,
): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return readString(asRecord(value, message), "id", message);
}

function readObjectList(
  record: JsonRecord,
  key: string,
  message: string,
): readonly JsonRecord[] {
  return readArray(record, key, message).map((value) =>
    asRecord(value, message),
  );
}

function assertTestMode(record: JsonRecord, message: string): void {
  assertContract(record.livemode === false, message);
}

function requirePriceId(): string {
  assertContract(priceId !== null, "Stripe contract Price was not prepared.");
  return priceId;
}

function requireEdgePriceId(): string {
  assertContract(
    edgePriceId !== null,
    "Stripe contract Edge Price was not prepared.",
  );
  return edgePriceId;
}

function metadataData(): readonly string[] {
  return [`metadata[${RUN_METADATA_KEY}]=${runId}`];
}

function idempotencyKey(label: string): string {
  return `murph-contract:${runId}:${label}`;
}

function stripeChildEnvironment(): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    NODE_ENV: "test",
  };
  for (const key of ["HOME", "PATH", "XDG_CONFIG_HOME"] as const) {
    const value = process.env[key];
    if (value) {
      childEnvironment[key] = value;
    }
  }
  return childEnvironment;
}

function classifyStripeCliFailure(
  error: ExecFileException,
  stdout: string,
  stderr: string,
): string {
  if (error.code === "ENOENT") {
    return "cli_missing";
  }
  if (error.killed) {
    return "cli_timeout";
  }

  const combined = `${error.message}\n${stdout}\n${stderr}`.toLowerCase();
  if (combined.includes("api key") && combined.includes("expired")) {
    return "authentication_expired";
  }
  if (
    combined.includes("authentication")
    || combined.includes("invalid api key")
    || combined.includes("not logged in")
  ) {
    return "authentication";
  }
  if (combined.includes("idempotency")) {
    return "idempotency";
  }
  if (
    combined.includes("rate limit")
    || combined.includes("too many requests")
  ) {
    return "rate_limited";
  }
  if (
    combined.includes("connection")
    || combined.includes("network")
    || combined.includes("timeout")
  ) {
    return "network";
  }
  if (
    combined.includes("invalid_request_error")
    || combined.includes("parameter")
  ) {
    return "invalid_request";
  }
  return "provider_error";
}

function runStripeCli(
  operation: string,
  args: readonly string[],
): Promise<unknown> {
  const hasForbiddenArgument = args.some(
    (argument) =>
      argument === "--live"
      || argument.startsWith("--live=")
      || argument === "--api-key"
      || argument.startsWith("--api-key="),
  );
  assertContract(
    !hasForbiddenArgument,
    "Stripe contract attempted a forbidden CLI credential or live-mode flag.",
  );

  return new Promise((resolve, reject) => {
    execFile(
      "stripe",
      [...args],
      {
        encoding: "utf8",
        env: stripeChildEnvironment(),
        maxBuffer: 4 * 1024 * 1024,
        shell: false,
        timeout: CLI_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        const stdoutText = stdout;
        const stderrText = stderr;
        if (error) {
          const category = classifyStripeCliFailure(
            error,
            stdoutText,
            stderrText,
          );
          reject(
            new Error(`Stripe contract ${operation} failed (${category}).`),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdoutText));
        } catch {
          reject(
            new Error(
              `Stripe contract ${operation} returned a malformed response.`,
            ),
          );
        }
      },
    );
  });
}

async function stripeRequest(
  command: StripeCliCommand,
  path: string,
  operation: string,
  options: StripeRequestOptions = {},
): Promise<JsonRecord> {
  const args = [
    command,
    path,
    "-p",
    STRIPE_CLI_PROFILE,
    "--color",
    "off",
    "-v",
    STRIPE_API_VERSION,
  ];
  if (command !== "get") {
    args.push("-c");
  }
  for (const datum of options.data ?? []) {
    args.push("-d", datum);
  }
  for (const expansion of options.expand ?? []) {
    args.push("-e", expansion);
  }
  if (options.idempotencyKey) {
    args.push("-i", options.idempotencyKey);
  }
  return asRecord(
    await runStripeCli(operation, args),
    `Stripe contract ${operation} returned an invalid object.`,
  );
}

async function stripeGet(
  path: string,
  operation: string,
  options: StripeRequestOptions = {},
): Promise<JsonRecord> {
  return stripeRequest("get", path, operation, options);
}

async function stripePost(
  path: string,
  operation: string,
  options: StripeRequestOptions = {},
): Promise<JsonRecord> {
  return stripeRequest("post", path, operation, options);
}

async function stripeDelete(
  path: string,
  operation: string,
  options: StripeRequestOptions = {},
): Promise<JsonRecord> {
  return stripeRequest("delete", path, operation, options);
}

async function waitFor<T>(
  operation: string,
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await load();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  contractFailure(`Stripe contract ${operation} did not settle in time.`);
}

async function retrieveClock(clockId: string): Promise<JsonRecord> {
  return stripeGet(
    `/v1/test_helpers/test_clocks/${clockId}`,
    "retrieve Test Clock",
  );
}

async function waitForClockReady(clockId: string): Promise<JsonRecord> {
  return waitFor(
    "Test Clock advance",
    () => retrieveClock(clockId),
    (clock) =>
      readOptionalString(
        clock,
        "status",
        "Stripe Test Clock status was invalid.",
      ) === "ready",
    120_000,
  );
}

async function advanceClock(
  clockId: string,
  frozenTime: number,
): Promise<JsonRecord> {
  await stripePost(
    `/v1/test_helpers/test_clocks/${clockId}/advance`,
    "advance Test Clock",
    {
      data: [`frozen_time=${frozenTime}`],
      idempotencyKey: idempotencyKey(
        `clock-advance-${frozenTime}-${randomUUID()}`,
      ),
    },
  );
  return waitForClockReady(clockId);
}

async function cleanClock(clockId: string): Promise<void> {
  try {
    await waitForClockReady(clockId);
    const deleted = await stripeDelete(
      `/v1/test_helpers/test_clocks/${clockId}`,
      "delete Test Clock",
      {
        idempotencyKey: idempotencyKey(`clock-delete-${clockId}`),
      },
    );
    assertContract(
      deleted.deleted === true,
      "Stripe Test Clock cleanup was not confirmed.",
    );
    activeClockIds.delete(clockId);
    cleanupSummary.clocks += 1;
  } catch {
    // The suite-level cleanup retries only the exact clock that remains here.
  }
}

async function withTestClock(
  scenario: string,
  callback: (clock: TestClockContext) => Promise<void>,
): Promise<void> {
  const frozenTime = Math.floor(Date.now() / 1_000);
  const clock = await stripePost(
    "/v1/test_helpers/test_clocks",
    "create Test Clock",
    {
      data: [
        `frozen_time=${frozenTime}`,
        `name=murph-contract-${scenario}-${runId.slice(0, 8)}`,
      ],
      idempotencyKey: idempotencyKey(`clock-create-${scenario}`),
    },
  );
  assertTestMode(clock, "Stripe Test Clock was not created in test mode.");
  const clockId = readString(
    clock,
    "id",
    "Stripe Test Clock did not return an id.",
  );
  activeClockIds.add(clockId);

  try {
    await callback({
      frozenTime: readNumber(
        clock,
        "frozen_time",
        "Stripe Test Clock did not return frozen time.",
      ),
      id: clockId,
    });
  } finally {
    await cleanClock(clockId);
  }
}

async function createCustomer(clockId: string): Promise<string> {
  const customer = await stripePost("/v1/customers", "create Customer", {
    data: [`test_clock=${clockId}`, ...metadataData()],
    idempotencyKey: idempotencyKey(`customer-${randomUUID()}`),
  });
  assertTestMode(customer, "Stripe Customer was not created in test mode.");
  return readString(
    customer,
    "id",
    "Stripe Customer did not return an id.",
  );
}

async function createAndAttachPaymentMethod(
  customerId: string,
  token: string,
  label: string,
): Promise<string> {
  const paymentMethod = await stripePost(
    "/v1/payment_methods",
    "create PaymentMethod",
    {
      data: ["type=card", `card[token]=${token}`, ...metadataData()],
      idempotencyKey: idempotencyKey(`payment-method-${label}`),
    },
  );
  assertTestMode(
    paymentMethod,
    "Stripe PaymentMethod was not created in test mode.",
  );
  const paymentMethodId = readString(
    paymentMethod,
    "id",
    "Stripe PaymentMethod did not return an id.",
  );
  const attached = await stripePost(
    `/v1/payment_methods/${paymentMethodId}/attach`,
    "attach PaymentMethod",
    {
      data: [`customer=${customerId}`],
      idempotencyKey: idempotencyKey(`payment-method-attach-${label}`),
    },
  );
  assertTestMode(
    attached,
    "Stripe PaymentMethod was not attached in test mode.",
  );
  assertContract(
    readString(
      attached,
      "id",
      "Attached Stripe PaymentMethod did not return an id.",
    ) === paymentMethodId,
    "Stripe attached a different PaymentMethod than requested.",
  );
  return paymentMethodId;
}

async function createPausedSubscription(
  clock: TestClockContext,
): Promise<PausedSubscriptionFixture> {
  const customerId = await createCustomer(clock.id);
  const trialEnd = clock.frozenTime + 2 * 24 * 60 * 60;
  const subscription = await stripePost(
    "/v1/subscriptions",
    "create paused-trial Subscription",
    {
      data: [
        `customer=${customerId}`,
        `items[0][price]=${requirePriceId()}`,
        `trial_end=${trialEnd}`,
        "trial_settings[end_behavior][missing_payment_method]=pause",
        ...metadataData(),
      ],
      idempotencyKey: idempotencyKey(
        `paused-subscription-${randomUUID()}`,
      ),
    },
  );
  assertTestMode(
    subscription,
    "Stripe paused-trial Subscription was not created in test mode.",
  );
  const subscriptionId = readString(
    subscription,
    "id",
    "Stripe paused-trial Subscription did not return an id.",
  );

  await advanceClock(clock.id, trialEnd + 60);
  await waitFor(
    "paused-trial Subscription",
    () =>
      stripeGet(
        `/v1/subscriptions/${subscriptionId}`,
        "retrieve paused-trial Subscription",
      ),
    (current) =>
      readOptionalString(
        current,
        "status",
        "Stripe Subscription status was invalid.",
      ) === "paused",
  );

  return {
    customerId,
    subscriptionId,
  };
}

function subscriptionItems(subscription: JsonRecord): readonly JsonRecord[] {
  const items = readRecord(
    subscription,
    "items",
    "Stripe Subscription items were missing.",
  );
  return readObjectList(
    items,
    "data",
    "Stripe Subscription item list was invalid.",
  );
}

function subscriptionItem(subscription: JsonRecord): JsonRecord {
  const itemList = subscriptionItems(subscription);
  assertContract(
    itemList.length === 1,
    "Stripe contract fixture had an unexpected item count.",
  );
  return itemList[0];
}

function subscriptionHasItem(input: {
  id: string;
  priceId: string;
  quantity: number;
  subscription: JsonRecord;
}): boolean {
  return subscriptionItems(input.subscription).some((item) =>
    readString(
      item,
      "id",
      "Stripe Subscription item id was invalid.",
    ) === input.id &&
    readObjectId(
      item,
      "price",
      "Stripe Subscription item Price was invalid.",
    ) === input.priceId &&
    readNumber(
      item,
      "quantity",
      "Stripe Subscription item quantity was invalid.",
    ) === input.quantity
  );
}

async function createActiveSubscription(
  clock: TestClockContext,
): Promise<ActiveSubscriptionFixture> {
  const customerId = await createCustomer(clock.id);
  const paymentMethodId = await createAndAttachPaymentMethod(
    customerId,
    "tok_visa",
    `active-${randomUUID()}`,
  );
  await stripePost(`/v1/customers/${customerId}`, "set Customer tender", {
    data: [`invoice_settings[default_payment_method]=${paymentMethodId}`],
    idempotencyKey: idempotencyKey(`customer-tender-${randomUUID()}`),
  });
  const subscription = await stripePost(
    "/v1/subscriptions",
    "create active Subscription",
    {
      data: [
        `customer=${customerId}`,
        `default_payment_method=${paymentMethodId}`,
        `items[0][price]=${requirePriceId()}`,
        "payment_behavior=error_if_incomplete",
        ...metadataData(),
      ],
      expand: ["latest_invoice"],
      idempotencyKey: idempotencyKey(
        `active-subscription-${randomUUID()}`,
      ),
    },
  );
  assertTestMode(
    subscription,
    "Stripe active Subscription was not created in test mode.",
  );
  const subscriptionId = readString(
    subscription,
    "id",
    "Stripe active Subscription did not return an id.",
  );
  const invoiceId = readObjectId(
    subscription,
    "latest_invoice",
    "Stripe active Subscription did not return its invoice.",
  );
  await waitForInvoiceStatus(invoiceId, "paid");
  const currentSubscription = await waitFor(
    "active Subscription",
    () =>
      stripeGet(
        `/v1/subscriptions/${subscriptionId}`,
        "retrieve active Subscription",
      ),
    (current) =>
      readOptionalString(
        current,
        "status",
        "Stripe active Subscription status was invalid.",
      ) === "active",
  );
  const item = subscriptionItem(currentSubscription);
  return {
    customerId,
    paymentMethodId,
    subscriptionId,
    subscriptionItemId: readString(
      item,
      "id",
      "Stripe active Subscription item did not return an id.",
    ),
  };
}

async function resumeSubscription(
  subscriptionId: string,
  attemptKey: string,
): Promise<JsonRecord> {
  return stripePost(
    `/v1/subscriptions/${subscriptionId}/resume`,
    "resume Subscription",
    {
      data: ["billing_cycle_anchor=now"],
      expand: ["latest_invoice"],
      idempotencyKey: attemptKey,
    },
  );
}

async function retrieveInvoice(invoiceId: string): Promise<JsonRecord> {
  return stripeGet(`/v1/invoices/${invoiceId}`, "retrieve Invoice");
}

async function waitForInvoiceStatus(
  invoiceId: string,
  expectedStatus: string,
): Promise<JsonRecord> {
  return waitFor(
    `Invoice ${expectedStatus} state`,
    () => retrieveInvoice(invoiceId),
    (invoice) =>
      readOptionalString(
        invoice,
        "status",
        "Stripe Invoice status was invalid.",
      ) === expectedStatus,
  );
}

async function listInvoicePayments(
  invoiceId: string,
): Promise<readonly JsonRecord[]> {
  const response = await stripeGet(
    "/v1/invoice_payments",
    "list exact Invoice Payments",
    {
      data: [`invoice=${invoiceId}`, "limit=100"],
      expand: ["data.payment.payment_intent"],
    },
  );
  return readObjectList(
    response,
    "data",
    "Stripe Invoice Payment list was invalid.",
  );
}

async function invoicePaymentIntent(
  invoiceId: string,
  expectedStatus: "paid" | "open",
): Promise<JsonRecord> {
  const payments = await listInvoicePayments(invoiceId);
  const invoicePayment = payments.find((payment) => {
    const paymentDetails = readRecord(
      payment,
      "payment",
      "Stripe Invoice Payment details were invalid.",
    );
    return (
      readOptionalObjectId(
        payment,
        "invoice",
        "Stripe Invoice Payment invoice relation was invalid.",
      ) === invoiceId
      && readOptionalString(
        payment,
        "status",
        "Stripe Invoice Payment status was invalid.",
      ) === expectedStatus
      && readOptionalString(
        paymentDetails,
        "type",
        "Stripe Invoice Payment type was invalid.",
      ) === "payment_intent"
    );
  });
  assertContract(
    invoicePayment !== undefined,
    "Stripe did not return the expected exact Invoice Payment.",
  );
  const paymentDetails = readRecord(
    invoicePayment,
    "payment",
    "Stripe Invoice Payment details were invalid.",
  );
  const paymentIntentValue = paymentDetails.payment_intent;
  if (isJsonRecord(paymentIntentValue)) {
    return paymentIntentValue;
  }
  const paymentIntentId = readObjectId(
    paymentDetails,
    "payment_intent",
    "Stripe Invoice Payment did not return a PaymentIntent.",
  );
  return stripeGet(
    `/v1/payment_intents/${paymentIntentId}`,
    "retrieve Invoice Payment PaymentIntent",
  );
}

function assertStripeHostedInvoiceUrl(value: unknown): void {
  assertContract(
    typeof value === "string" && value.length > 0,
    "Stripe action-required Invoice did not return a hosted URL.",
  );
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    contractFailure("Stripe action-required Invoice returned an invalid URL.");
  }
  assertContract(
    parsed.protocol === "https:"
      && (
        parsed.hostname === "stripe.com"
        || parsed.hostname.endsWith(".stripe.com")
      ),
    "Stripe action-required Invoice returned an untrusted URL.",
  );
}

function pendingTargetQuantity(subscription: JsonRecord): number | null {
  const pendingUpdate = readNullableRecord(
    subscription,
    "pending_update",
    "Stripe Subscription pending update was invalid.",
  );
  if (pendingUpdate === null) {
    return null;
  }
  const pendingItems = readArray(
    pendingUpdate,
    "subscription_items",
    "Stripe pending Subscription items were invalid.",
  );
  assertContract(
    pendingItems.length === 1,
    "Stripe pending update had an unexpected item count.",
  );
  return readNumber(
    asRecord(
      pendingItems[0],
      "Stripe pending Subscription item was invalid.",
    ),
    "quantity",
    "Stripe pending Subscription quantity was invalid.",
  );
}

describe.skipIf(!RUN_STRIPE_BILLING_CONTRACT)(
  "hosted onboarding Stripe billing contract",
  () => {
    beforeAll(async () => {
      const balance = await stripeGet("/v1/balance", "test-mode preflight");
      assertTestMode(
        balance,
        "Stripe billing contract refused a non-test-mode profile.",
      );

      const product = await stripePost("/v1/products", "create Product", {
        data: ["name=Murph billing contract fixture", ...metadataData()],
        idempotencyKey: idempotencyKey("product"),
      });
      assertTestMode(product, "Stripe Product was not created in test mode.");
      productId = readString(
        product,
        "id",
        "Stripe Product did not return an id.",
      );

      const price = await stripePost("/v1/prices", "create Price", {
        data: [
          "currency=usd",
          "unit_amount=800",
          "recurring[interval]=month",
          `product=${productId}`,
          ...metadataData(),
        ],
        idempotencyKey: idempotencyKey("price"),
      });
      assertTestMode(price, "Stripe Price was not created in test mode.");
      priceId = readString(
        price,
        "id",
        "Stripe Price did not return an id.",
      );
      const edgePrice = await stripePost("/v1/prices", "create Edge Price", {
        data: [
          "currency=usd",
          "unit_amount=1900",
          "recurring[interval]=month",
          `product=${productId}`,
          ...metadataData(),
        ],
        idempotencyKey: idempotencyKey("edge-price"),
      });
      assertTestMode(
        edgePrice,
        "Stripe Edge Price was not created in test mode.",
      );
      edgePriceId = readString(
        edgePrice,
        "id",
        "Stripe Edge Price did not return an id.",
      );
    }, 120_000);

    afterAll(async () => {
      for (const clockId of [...activeClockIds]) {
        await cleanClock(clockId);
      }
      cleanupSummary.failures += activeClockIds.size;
      for (const [label, currentPriceId] of [
        ["price", priceId],
        ["edge-price", edgePriceId],
      ] as const) {
        if (currentPriceId === null) {
          continue;
        }
        try {
          const price = await stripePost(
            `/v1/prices/${currentPriceId}`,
            `archive ${label}`,
            {
              data: ["active=false"],
              idempotencyKey: idempotencyKey(`archive-${label}`),
            },
          );
          assertContract(
            price.active === false,
            "Stripe Price cleanup was not confirmed.",
          );
          cleanupSummary.prices += 1;
        } catch {
          cleanupSummary.failures += 1;
        }
      }
      if (productId !== null) {
        try {
          const product = await stripePost(
            `/v1/products/${productId}`,
            "archive Product",
            {
              data: ["active=false"],
              idempotencyKey: idempotencyKey("archive-product"),
            },
          );
          assertContract(
            product.active === false,
            "Stripe Product cleanup was not confirmed.",
          );
          cleanupSummary.products += 1;
        } catch {
          cleanupSummary.failures += 1;
        }
      }

      process.stdout.write(
        `Stripe billing contract cleanup: clocks=${cleanupSummary.clocks}, `
          + `prices=${cleanupSummary.prices}, `
          + `products=${cleanupSummary.products}, `
          + `failures=${cleanupSummary.failures}\n`,
      );
      assertContract(
        cleanupSummary.failures === 0 && activeClockIds.size === 0,
        "Stripe billing contract cleanup was incomplete.",
      );
    }, 180_000);

    test(
      "copies a customer PaymentMethod to the Subscription before Resume and lets Stripe collect the exact resumption Invoice",
      async () => {
        await withTestClock("resume-payment-method", async (clock) => {
          const fixture = await createPausedSubscription(clock);
          const paymentMethodId = await createAndAttachPaymentMethod(
            fixture.customerId,
            "tok_visa",
            `resume-${randomUUID()}`,
          );
          const customer = await stripePost(
            `/v1/customers/${fixture.customerId}`,
            "set Customer invoice PaymentMethod",
            {
              data: [
                `invoice_settings[default_payment_method]=${paymentMethodId}`,
              ],
              idempotencyKey: idempotencyKey(
                `resume-customer-tender-${randomUUID()}`,
              ),
            },
          );
          const invoiceSettings = readRecord(
            customer,
            "invoice_settings",
            "Stripe Customer invoice settings were invalid.",
          );
          assertContract(
            readObjectId(
              invoiceSettings,
              "default_payment_method",
              "Stripe Customer did not retain its PaymentMethod.",
            ) === paymentMethodId,
            "Stripe Customer retained a different PaymentMethod.",
          );

          const beforeAttach = await stripeGet(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "retrieve Subscription before tender copy",
          );
          assertContract(
            readOptionalObjectId(
              beforeAttach,
              "default_payment_method",
              "Stripe Subscription default PaymentMethod was invalid.",
            ) === null,
            "Stripe paused Subscription unexpectedly already had a PaymentMethod.",
          );

          const attached = await stripePost(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "copy PaymentMethod to Subscription",
            {
              data: [`default_payment_method=${paymentMethodId}`],
              idempotencyKey: idempotencyKey(
                `resume-subscription-tender-${randomUUID()}`,
              ),
            },
          );
          assertContract(
            readObjectId(
              attached,
              "default_payment_method",
              "Stripe Subscription did not retain its PaymentMethod.",
            ) === paymentMethodId,
            "Stripe Subscription retained a different PaymentMethod.",
          );

          const resumed = await resumeSubscription(
            fixture.subscriptionId,
            idempotencyKey(`resume-payment-method-${randomUUID()}`),
          );
          const invoiceId = readObjectId(
            resumed,
            "latest_invoice",
            "Stripe Resume did not return a resumption Invoice.",
          );
          const invoiceBeforePayment = await retrieveInvoice(invoiceId);
          assertContract(
            !Object.hasOwn(invoiceBeforePayment, "payment_intent"),
            "Pinned Stripe Invoice unexpectedly exposed a legacy PaymentIntent field.",
          );
          const paidInvoice = await waitForInvoiceStatus(invoiceId, "paid");
          assertContract(
            paidInvoice.paid === true,
            "Stripe resumption Invoice was not paid.",
          );
          const paymentIntent = await invoicePaymentIntent(invoiceId, "paid");
          assertContract(
            readOptionalString(
              paymentIntent,
              "status",
              "Stripe resumption PaymentIntent status was invalid.",
            ) === "succeeded",
            "Stripe resumption PaymentIntent did not succeed.",
          );
          const current = await stripeGet(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "retrieve resumed Subscription",
          );
          assertContract(
            readOptionalString(
              current,
              "status",
              "Stripe resumed Subscription status was invalid.",
            ) === "active",
            "Stripe Subscription did not become active after exact Invoice payment.",
          );
        });
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "copies a legacy Source through default_source before Resume",
      async () => {
        await withTestClock("resume-legacy-source", async (clock) => {
          const fixture = await createPausedSubscription(clock);
          const customer = await stripePost(
            `/v1/customers/${fixture.customerId}`,
            "attach legacy Customer Source",
            {
              data: ["source=tok_visa"],
              idempotencyKey: idempotencyKey(
                `legacy-source-${randomUUID()}`,
              ),
            },
          );
          const sourceId = readObjectId(
            customer,
            "default_source",
            "Stripe Customer did not retain its legacy Source.",
          );
          assertContract(
            sourceId.startsWith("card_") || sourceId.startsWith("src_"),
            "Stripe legacy Source had an unexpected object type.",
          );

          const attached = await stripePost(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "copy legacy Source to Subscription",
            {
              data: [`default_source=${sourceId}`],
              idempotencyKey: idempotencyKey(
                `legacy-source-copy-${randomUUID()}`,
              ),
            },
          );
          assertContract(
            readObjectId(
              attached,
              "default_source",
              "Stripe Subscription did not retain its legacy Source.",
            ) === sourceId,
            "Stripe Subscription retained a different legacy Source.",
          );
          assertContract(
            readOptionalObjectId(
              attached,
              "default_payment_method",
              "Stripe Subscription default PaymentMethod was invalid.",
            ) === null,
            "Stripe legacy Source was incorrectly represented as a PaymentMethod.",
          );

          const resumed = await resumeSubscription(
            fixture.subscriptionId,
            idempotencyKey(`resume-legacy-source-${randomUUID()}`),
          );
          const invoiceId = readObjectId(
            resumed,
            "latest_invoice",
            "Stripe legacy-source Resume did not return an Invoice.",
          );
          await waitForInvoiceStatus(invoiceId, "paid");
          const paymentIntent = await invoicePaymentIntent(invoiceId, "paid");
          assertContract(
            readOptionalString(
              paymentIntent,
              "status",
              "Stripe legacy-source PaymentIntent status was invalid.",
            ) === "succeeded",
            "Stripe legacy-source resumption payment did not succeed.",
          );
          const current = await stripeGet(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "retrieve legacy-source resumed Subscription",
          );
          assertContract(
            readOptionalString(
              current,
              "status",
              "Stripe legacy-source Subscription status was invalid.",
            ) === "active",
            "Stripe legacy-source Subscription did not become active.",
          );
        });
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "replays the old Resume key after a terminal void and creates a new Invoice only for a fresh key",
      async () => {
        await withTestClock("resume-void-key-rotation", async (clock) => {
          const fixture = await createPausedSubscription(clock);
          const firstAttemptKey = idempotencyKey(
            `resume-terminal-${randomUUID()}`,
          );
          const firstResume = await resumeSubscription(
            fixture.subscriptionId,
            firstAttemptKey,
          );
          const firstInvoiceId = readObjectId(
            firstResume,
            "latest_invoice",
            "Stripe first Resume did not return an Invoice.",
          );
          const firstInvoice = await retrieveInvoice(firstInvoiceId);
          assertContract(
            readOptionalString(
              firstInvoice,
              "status",
              "Stripe first resumption Invoice status was invalid.",
            ) === "open",
            "Stripe missing-tender resumption Invoice was not open.",
          );

          const currentClock = await retrieveClock(clock.id);
          const currentFrozenTime = readNumber(
            currentClock,
            "frozen_time",
            "Stripe Test Clock frozen time was invalid.",
          );
          await advanceClock(
            clock.id,
            currentFrozenTime + 25 * 60 * 60,
          );
          await waitForInvoiceStatus(firstInvoiceId, "void");
          const paused = await stripeGet(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "retrieve Subscription after void",
          );
          assertContract(
            readOptionalString(
              paused,
              "status",
              "Stripe Subscription status after void was invalid.",
            ) === "paused",
            "Stripe Subscription did not remain paused after terminal void.",
          );

          const replay = await resumeSubscription(
            fixture.subscriptionId,
            firstAttemptKey,
          );
          assertContract(
            readObjectId(
              replay,
              "latest_invoice",
              "Stripe Resume replay did not return its Invoice.",
            ) === firstInvoiceId,
            "Stripe Resume did not replay the original idempotent response.",
          );

          const freshResume = await resumeSubscription(
            fixture.subscriptionId,
            idempotencyKey(`resume-after-terminal-${randomUUID()}`),
          );
          const freshInvoiceId = readObjectId(
            freshResume,
            "latest_invoice",
            "Stripe fresh Resume did not return an Invoice.",
          );
          assertContract(
            freshInvoiceId !== firstInvoiceId,
            "Stripe fresh Resume key did not create a new attempt Invoice.",
          );
        });
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "keeps a 3DS last-tier price swap pending through expiry, then applies and consolidates a fresh retry",
      async () => {
        await withTestClock("last-tier-price-swap", async (clock) => {
          const customerId = await createCustomer(clock.id);
          const paymentMethodId = await createAndAttachPaymentMethod(
            customerId,
            "tok_visa",
            `last-tier-${randomUUID()}`,
          );
          await stripePost(
            `/v1/customers/${customerId}`,
            "set last-tier Customer tender",
            {
              data: [
                `invoice_settings[default_payment_method]=${paymentMethodId}`,
              ],
              idempotencyKey: idempotencyKey(
                `last-tier-customer-tender-${randomUUID()}`,
              ),
            },
          );
          const created = await stripePost(
            "/v1/subscriptions",
            "create mixed-tier Subscription",
            {
              data: [
                `customer=${customerId}`,
                `default_payment_method=${paymentMethodId}`,
                `items[0][price]=${requirePriceId()}`,
                `items[1][price]=${requireEdgePriceId()}`,
                "payment_behavior=error_if_incomplete",
                ...metadataData(),
              ],
              expand: ["latest_invoice"],
              idempotencyKey: idempotencyKey(
                `last-tier-subscription-${randomUUID()}`,
              ),
            },
          );
          const subscriptionId = readString(
            created,
            "id",
            "Stripe mixed-tier Subscription did not return an id.",
          );
          const baseInvoiceId = readObjectId(
            created,
            "latest_invoice",
            "Stripe mixed-tier Subscription did not return its base Invoice.",
          );
          await waitForInvoiceStatus(baseInvoiceId, "paid");
          const before = await waitFor(
            "mixed-tier Subscription",
            () =>
              stripeGet(
                `/v1/subscriptions/${subscriptionId}`,
                "retrieve mixed-tier Subscription",
              ),
            (subscription) =>
              readOptionalString(
                subscription,
                "status",
                "Stripe mixed-tier Subscription status was invalid.",
              ) === "active" &&
              subscriptionItems(subscription).length === 2,
          );
          const beforeItems = subscriptionItems(before);
          const sourceItem = beforeItems.find((item) =>
            readObjectId(
              item,
              "price",
              "Stripe mixed-tier item Price was invalid.",
            ) === requirePriceId()
          );
          const retainedTargetItem = beforeItems.find((item) =>
            readObjectId(
              item,
              "price",
              "Stripe mixed-tier item Price was invalid.",
            ) === requireEdgePriceId()
          );
          assertContract(
            sourceItem !== undefined && retainedTargetItem !== undefined,
            "Stripe mixed-tier fixture did not expose one item per tier.",
          );
          const sourceItemId = readString(
            sourceItem,
            "id",
            "Stripe source Subscription item did not return an id.",
          );
          const retainedTargetItemId = readString(
            retainedTargetItem,
            "id",
            "Stripe target Subscription item did not return an id.",
          );

          const actionPaymentMethodId = await createAndAttachPaymentMethod(
            customerId,
            "tok_threeDSecure2Required",
            `last-tier-action-${randomUUID()}`,
          );
          await stripePost(
            `/v1/subscriptions/${subscriptionId}`,
            "set last-tier action-required tender",
            {
              data: [
                `default_payment_method=${actionPaymentMethodId}`,
              ],
              idempotencyKey: idempotencyKey(
                `last-tier-action-tender-${randomUUID()}`,
              ),
            },
          );
          const pending = await stripePost(
            `/v1/subscriptions/${subscriptionId}`,
            "create pending last-tier price swap",
            {
              data: [
                `items[0][id]=${sourceItemId}`,
                `items[0][price]=${requireEdgePriceId()}`,
                "items[0][quantity]=1",
                "payment_behavior=pending_if_incomplete",
                "proration_behavior=always_invoice",
              ],
              expand: ["latest_invoice"],
              idempotencyKey: idempotencyKey(
                `last-tier-pending-swap-${randomUUID()}`,
              ),
            },
          );
          assertContract(
            subscriptionItems(pending).length === 2 &&
              subscriptionHasItem({
                id: sourceItemId,
                priceId: requirePriceId(),
                quantity: 1,
                subscription: pending,
              }) &&
              subscriptionHasItem({
                id: retainedTargetItemId,
                priceId: requireEdgePriceId(),
                quantity: 1,
                subscription: pending,
              }),
            "Stripe changed the applied mixed-tier items before 3DS payment.",
          );
          const pendingUpdate = readRecord(
            pending,
            "pending_update",
            "Stripe last-tier pending update was missing.",
          );
          const pendingUpdateItems = readObjectList(
            pendingUpdate,
            "subscription_items",
            "Stripe last-tier pending update items were invalid.",
          );
          assertContract(
            pendingUpdateItems.length === 1 &&
              readString(
                pendingUpdateItems[0],
                "id",
                "Stripe last-tier pending item id was invalid.",
              ) === sourceItemId &&
              readObjectId(
                pendingUpdateItems[0],
                "price",
                "Stripe last-tier pending item Price was invalid.",
              ) === requireEdgePriceId() &&
              readNumber(
                pendingUpdateItems[0],
                "quantity",
                "Stripe last-tier pending item quantity was invalid.",
              ) === 1,
            "Stripe did not retain the exact last-tier price target.",
          );
          const expiresAt = readNumber(
            pendingUpdate,
            "expires_at",
            "Stripe last-tier pending expiry was invalid.",
          );
          const expiredInvoiceId = readObjectId(
            pending,
            "latest_invoice",
            "Stripe pending last-tier swap did not return an Invoice.",
          );
          assertContract(
            expiredInvoiceId !== baseInvoiceId,
            "Stripe pending last-tier swap reused the base Invoice.",
          );
          const actionInvoice = await waitForInvoiceStatus(
            expiredInvoiceId,
            "open",
          );
          assertStripeHostedInvoiceUrl(actionInvoice.hosted_invoice_url);
          const actionPaymentIntent = await invoicePaymentIntent(
            expiredInvoiceId,
            "open",
          );
          assertContract(
            readOptionalString(
              actionPaymentIntent,
              "status",
              "Stripe last-tier PaymentIntent status was invalid.",
            ) === "requires_action",
            "Stripe last-tier 3DS PaymentIntent did not require action.",
          );

          await advanceClock(clock.id, expiresAt + 60);
          const expired = await waitFor(
            "last-tier pending expiry",
            () =>
              stripeGet(
                `/v1/subscriptions/${subscriptionId}`,
                "retrieve expired last-tier swap",
              ),
            (subscription) =>
              readNullableRecord(
                subscription,
                "pending_update",
                "Stripe expired last-tier pending update was invalid.",
              ) === null,
          );
          assertContract(
            subscriptionItems(expired).length === 2 &&
              subscriptionHasItem({
                id: sourceItemId,
                priceId: requirePriceId(),
                quantity: 1,
                subscription: expired,
              }) &&
              subscriptionHasItem({
                id: retainedTargetItemId,
                priceId: requireEdgePriceId(),
                quantity: 1,
                subscription: expired,
              }),
            "Stripe applied an expired last-tier price swap.",
          );
          await waitForInvoiceStatus(expiredInvoiceId, "void");
          assertContract(
            readObjectId(
              expired,
              "latest_invoice",
              "Stripe expired last-tier latest Invoice was invalid.",
            ) === expiredInvoiceId,
            "Stripe lost the exact expired last-tier attempt Invoice.",
          );

          await stripePost(
            `/v1/subscriptions/${subscriptionId}`,
            "restore last-tier successful tender",
            {
              data: [`default_payment_method=${paymentMethodId}`],
              idempotencyKey: idempotencyKey(
                `last-tier-restore-tender-${randomUUID()}`,
              ),
            },
          );
          const retried = await stripePost(
            `/v1/subscriptions/${subscriptionId}`,
            "retry last-tier price swap",
            {
              data: [
                `items[0][id]=${sourceItemId}`,
                `items[0][price]=${requireEdgePriceId()}`,
                "items[0][quantity]=1",
                "payment_behavior=pending_if_incomplete",
                "proration_behavior=always_invoice",
              ],
              expand: ["latest_invoice"],
              idempotencyKey: idempotencyKey(
                `last-tier-retry-swap-${randomUUID()}`,
              ),
            },
          );
          const updateInvoiceId = readObjectId(
            retried,
            "latest_invoice",
            "Stripe retried last-tier swap did not return an Invoice.",
          );
          assertContract(
            updateInvoiceId !== baseInvoiceId &&
              updateInvoiceId !== expiredInvoiceId,
            "Stripe fresh last-tier retry did not create a new Invoice.",
          );
          await waitForInvoiceStatus(updateInvoiceId, "paid");
          const applied = await waitFor(
            "paid last-tier retry",
            () =>
              stripeGet(
                `/v1/subscriptions/${subscriptionId}`,
                "retrieve paid last-tier retry",
              ),
            (subscription) => {
              const pendingUpdate = readNullableRecord(
                subscription,
                "pending_update",
                "Stripe last-tier pending update was invalid.",
              );
              const items = subscriptionItems(subscription);
              return pendingUpdate === null &&
                items.length === 2 &&
                items.every((item) =>
                  readObjectId(
                    item,
                    "price",
                    "Stripe applied last-tier item Price was invalid.",
                  ) === requireEdgePriceId()
                );
            },
          );
          const appliedItems = subscriptionItems(applied);
          assertContract(
            appliedItems.some((item) =>
              readString(
                item,
                "id",
                "Stripe converted item id was invalid.",
              ) === sourceItemId
            ) &&
              appliedItems.some((item) =>
                readString(
                  item,
                  "id",
                  "Stripe retained item id was invalid.",
                ) === retainedTargetItemId
              ),
            "Stripe did not preserve both exact items after the paid price swap.",
          );

          const updateInvoiceLinesResponse = await stripeGet(
            `/v1/invoices/${updateInvoiceId}/lines`,
            "retrieve last-tier price-swap Invoice lines",
            {
              data: ["limit=100"],
              expand: ["data.pricing.price_details.price"],
            },
          );
          const updateInvoiceLines = readObjectList(
            updateInvoiceLinesResponse,
            "data",
            "Stripe last-tier price-swap Invoice lines were invalid.",
          );
          let netProrationAmount = 0;
          let sawSourceCredit = false;
          let sawTargetCharge = false;
          for (const line of updateInvoiceLines) {
            const parent = readRecord(
              line,
              "parent",
              "Stripe last-tier Invoice line parent was invalid.",
            );
            const details = readNullableRecord(
              parent,
              "subscription_item_details",
              "Stripe last-tier Invoice line details were invalid.",
            );
            if (
              parent.type !== "subscription_item_details" ||
              details?.proration !== true ||
              details.subscription_item !== sourceItemId
            ) {
              continue;
            }
            const amount = readNumber(
              line,
              "amount",
              "Stripe last-tier Invoice line amount was invalid.",
            );
            const pricing = readRecord(
              line,
              "pricing",
              "Stripe last-tier Invoice line pricing was invalid.",
            );
            const priceDetails = readRecord(
              pricing,
              "price_details",
              "Stripe last-tier Invoice price details were invalid.",
            );
            const linePriceId = readObjectId(
              priceDetails,
              "price",
              "Stripe last-tier Invoice Price was invalid.",
            );
            netProrationAmount += amount;
            sawSourceCredit ||= linePriceId === requirePriceId() && amount < 0;
            sawTargetCharge ||=
              linePriceId === requireEdgePriceId() && amount > 0;
          }
          assertContract(
            sawSourceCredit && sawTargetCharge && netProrationAmount > 0,
            "Stripe did not invoice the exact old-tier credit and new-tier charge.",
          );

          const normalized = await stripePost(
            `/v1/subscriptions/${subscriptionId}`,
            "consolidate duplicate target-tier items",
            {
              data: [
                `items[0][id]=${retainedTargetItemId}`,
                "items[0][quantity]=2",
                `items[1][id]=${sourceItemId}`,
                "items[1][deleted]=true",
                "proration_behavior=none",
              ],
              expand: ["latest_invoice"],
              idempotencyKey: idempotencyKey(
                `last-tier-consolidate-${randomUUID()}`,
              ),
            },
          );
          const normalizedItems = subscriptionItems(normalized);
          assertContract(
            readNullableRecord(
              normalized,
              "pending_update",
              "Stripe normalized pending update was invalid.",
            ) === null &&
              normalizedItems.length === 1 &&
              readString(
                normalizedItems[0],
                "id",
                "Stripe normalized item id was invalid.",
              ) === retainedTargetItemId &&
              readObjectId(
                normalizedItems[0],
                "price",
                "Stripe normalized item Price was invalid.",
              ) === requireEdgePriceId() &&
              readNumber(
                normalizedItems[0],
                "quantity",
                "Stripe normalized item quantity was invalid.",
              ) === 2,
            "Stripe did not consolidate the duplicate target-tier items exactly.",
          );
          assertContract(
            readObjectId(
              normalized,
              "latest_invoice",
              "Stripe normalized Subscription latest Invoice was invalid.",
            ) === updateInvoiceId,
            "Stripe no-proration consolidation created a second charge Invoice.",
          );
        });
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "keeps a 3DS quantity increase pending until expiry and applies a fresh retry",
      async () => {
        await withTestClock("pending-update-expiry", async (clock) => {
          const fixture = await createActiveSubscription(clock);
          const actionPaymentMethodId = await createAndAttachPaymentMethod(
            fixture.customerId,
            "tok_threeDSecure2Required",
            `action-required-${randomUUID()}`,
          );
          await stripePost(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "set action-required Subscription tender",
            {
              data: [
                `default_payment_method=${actionPaymentMethodId}`,
              ],
              idempotencyKey: idempotencyKey(
                `action-required-tender-${randomUUID()}`,
              ),
            },
          );

          const pending = await stripePost(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "create pending quantity update",
            {
              data: [
                `items[0][id]=${fixture.subscriptionItemId}`,
                "items[0][quantity]=2",
                "payment_behavior=pending_if_incomplete",
                "proration_behavior=always_invoice",
              ],
              expand: ["latest_invoice"],
              idempotencyKey: idempotencyKey(
                `quantity-pending-${randomUUID()}`,
              ),
            },
          );
          assertContract(
            readNumber(
              subscriptionItem(pending),
              "quantity",
              "Stripe applied Subscription quantity was invalid.",
            ) === 1,
            "Stripe applied an action-required quantity before payment.",
          );
          assertContract(
            pendingTargetQuantity(pending) === 2,
            "Stripe did not retain the target quantity in pending_update.",
          );
          const pendingUpdate = readRecord(
            pending,
            "pending_update",
            "Stripe pending quantity update was missing.",
          );
          const expiresAt = readNumber(
            pendingUpdate,
            "expires_at",
            "Stripe pending quantity expiry was invalid.",
          );
          const invoiceId = readObjectId(
            pending,
            "latest_invoice",
            "Stripe pending quantity update did not return an Invoice.",
          );
          const pendingInvoice = await waitForInvoiceStatus(invoiceId, "open");
          assertStripeHostedInvoiceUrl(pendingInvoice.hosted_invoice_url);
          const paymentIntent = await invoicePaymentIntent(invoiceId, "open");
          assertContract(
            readOptionalString(
              paymentIntent,
              "status",
              "Stripe action-required PaymentIntent status was invalid.",
            ) === "requires_action",
            "Stripe 3DS PaymentIntent did not require action.",
          );

          await advanceClock(clock.id, expiresAt + 60);
          const expired = await waitFor(
            "pending quantity expiry",
            () =>
              stripeGet(
                `/v1/subscriptions/${fixture.subscriptionId}`,
                "retrieve Subscription after pending expiry",
              ),
            (current) =>
              readNullableRecord(
                current,
                "pending_update",
                "Stripe pending update after expiry was invalid.",
              ) === null,
          );
          assertContract(
            readNumber(
              subscriptionItem(expired),
              "quantity",
              "Stripe quantity after pending expiry was invalid.",
            ) === 1,
            "Stripe applied an expired pending quantity.",
          );
          const voidedInvoice = await waitForInvoiceStatus(invoiceId, "void");
          assertContract(
            readOptionalString(
              voidedInvoice,
              "billing_reason",
              "Stripe expired pending Invoice billing reason was invalid.",
            ) === "subscription_update",
            "Stripe expired pending Invoice was not the quantity update Invoice.",
          );
          assertContract(
            readObjectId(
              expired,
              "latest_invoice",
              "Stripe Subscription latest Invoice after pending expiry was invalid.",
            ) === invoiceId,
            "Stripe Subscription no longer identified the expired attempt Invoice.",
          );
          const voidedInvoiceLines = await stripeGet(
            `/v1/invoices/${invoiceId}/lines`,
            "retrieve expired pending Invoice lines",
            {
              data: ["limit=100"],
              expand: ["data.pricing.price_details.price"],
            },
          );
          const targetProrationLine = readObjectList(
            voidedInvoiceLines,
            "data",
            "Stripe expired pending Invoice lines were invalid.",
          ).find((line) => {
            if (readNumber(
              line,
              "amount",
              "Stripe expired pending Invoice line amount was invalid.",
            ) <= 0) {
              return false;
            }
            const parent = readRecord(
              line,
              "parent",
              "Stripe expired pending Invoice line parent was invalid.",
            );
            const details = readNullableRecord(
              parent,
              "subscription_item_details",
              "Stripe expired pending Invoice line details were invalid.",
            );
            return parent.type === "subscription_item_details"
              && details?.proration === true
              && details.subscription === fixture.subscriptionId
              && details.subscription_item === fixture.subscriptionItemId
              && readNumber(
                line,
                "quantity",
                "Stripe expired pending Invoice line quantity was invalid.",
              ) === 2;
          });
          assertContract(
            targetProrationLine,
            "Stripe expired pending Invoice lacked the exact positive target proration line.",
          );
          const targetPricing = readRecord(
            targetProrationLine,
            "pricing",
            "Stripe expired pending Invoice line pricing was invalid.",
          );
          const targetPriceDetails = readRecord(
            targetPricing,
            "price_details",
            "Stripe expired pending Invoice price details were invalid.",
          );
          assertContract(
            targetPricing.type === "price_details"
              && readObjectId(
                targetPriceDetails,
                "price",
                "Stripe expired pending Invoice line Price was invalid.",
              ) === requirePriceId(),
            "Stripe expired pending Invoice line did not identify the unapplied target Price.",
          );

          await stripePost(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "restore successful Subscription tender",
            {
              data: [
                `default_payment_method=${fixture.paymentMethodId}`,
              ],
              idempotencyKey: idempotencyKey(
                `restore-successful-tender-${randomUUID()}`,
              ),
            },
          );
          const retried = await stripePost(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "retry quantity update",
            {
              data: [
                `items[0][id]=${fixture.subscriptionItemId}`,
                "items[0][quantity]=2",
                "payment_behavior=pending_if_incomplete",
                "proration_behavior=always_invoice",
              ],
              expand: ["latest_invoice"],
              idempotencyKey: idempotencyKey(
                `quantity-after-expiry-${randomUUID()}`,
              ),
            },
          );
          const retryInvoiceId = readObjectId(
            retried,
            "latest_invoice",
            "Stripe quantity retry did not return an Invoice.",
          );
          await waitForInvoiceStatus(retryInvoiceId, "paid");
          const applied = await waitFor(
            "retried quantity application",
            () =>
              stripeGet(
                `/v1/subscriptions/${fixture.subscriptionId}`,
                "retrieve retried quantity",
              ),
            (current) =>
              readNullableRecord(
                current,
                "pending_update",
                "Stripe retried pending update was invalid.",
              ) === null
              && readNumber(
                subscriptionItem(current),
                "quantity",
                "Stripe retried quantity was invalid.",
              ) === 2,
          );
          assertContract(
            readNumber(
              subscriptionItem(applied),
              "quantity",
              "Stripe applied quantity was invalid.",
            ) === 2,
            "Stripe did not apply the paid quantity retry.",
          );
        });
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "reconciles two successful partial refunds as one cumulative full refund",
      async () => {
        await withTestClock("cumulative-refunds", async (clock) => {
          const fixture = await createActiveSubscription(clock);
          const subscription = await stripeGet(
            `/v1/subscriptions/${fixture.subscriptionId}`,
            "retrieve refundable Subscription",
          );
          const invoiceId = readObjectId(
            subscription,
            "latest_invoice",
            "Stripe refundable Subscription did not return an Invoice.",
          );
          const invoice = await waitForInvoiceStatus(invoiceId, "paid");
          const amountPaid = readNumber(
            invoice,
            "amount_paid",
            "Stripe refundable Invoice amount was invalid.",
          );
          assertContract(
            amountPaid > 1,
            "Stripe refundable Invoice amount was too small.",
          );
          const paymentIntent = await invoicePaymentIntent(invoiceId, "paid");
          const paymentIntentId = readString(
            paymentIntent,
            "id",
            "Stripe refundable PaymentIntent did not return an id.",
          );
          const firstAmount = Math.floor(amountPaid / 2);
          const secondAmount = amountPaid - firstAmount;

          const firstRefund = await stripePost(
            "/v1/refunds",
            "create first partial Refund",
            {
              data: [
                `payment_intent=${paymentIntentId}`,
                `amount=${firstAmount}`,
                ...metadataData(),
              ],
              idempotencyKey: idempotencyKey(
                `refund-first-${randomUUID()}`,
              ),
            },
          );
          const secondRefund = await stripePost(
            "/v1/refunds",
            "create second partial Refund",
            {
              data: [
                `payment_intent=${paymentIntentId}`,
                `amount=${secondAmount}`,
                ...metadataData(),
              ],
              idempotencyKey: idempotencyKey(
                `refund-second-${randomUUID()}`,
              ),
            },
          );
          const firstRefundId = readString(
            firstRefund,
            "id",
            "Stripe first Refund did not return an id.",
          );
          const secondRefundId = readString(
            secondRefund,
            "id",
            "Stripe second Refund did not return an id.",
          );
          await waitFor(
            "partial Refund settlement",
            async () =>
              Promise.all([
                stripeGet(
                  `/v1/refunds/${firstRefundId}`,
                  "retrieve first Refund",
                ),
                stripeGet(
                  `/v1/refunds/${secondRefundId}`,
                  "retrieve second Refund",
                ),
              ]),
            (refunds) =>
              refunds.every(
                (refund) =>
                  readOptionalString(
                    refund,
                    "status",
                    "Stripe Refund status was invalid.",
                  ) === "succeeded",
              ),
          );

          const refundList = await stripeGet(
            "/v1/refunds",
            "list PaymentIntent Refunds",
            {
              data: [`payment_intent=${paymentIntentId}`, "limit=100"],
            },
          );
          const successfulRunRefunds = readObjectList(
            refundList,
            "data",
            "Stripe Refund list was invalid.",
          ).filter((refund) => {
            const metadata = readRecord(
              refund,
              "metadata",
              "Stripe Refund metadata was invalid.",
            );
            return (
              readOptionalString(
                refund,
                "status",
                "Stripe Refund status was invalid.",
              ) === "succeeded"
              && metadata[RUN_METADATA_KEY] === runId
            );
          });
          assertContract(
            successfulRunRefunds.length === 2,
            "Stripe did not return both successful partial Refunds.",
          );
          const cumulativeRefund = successfulRunRefunds.reduce(
            (total, refund) =>
              total
              + readNumber(
                refund,
                "amount",
                "Stripe Refund amount was invalid.",
              ),
            0,
          );
          assertContract(
            cumulativeRefund === amountPaid,
            "Stripe cumulative Refund amount did not equal the paid Invoice.",
          );
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);
