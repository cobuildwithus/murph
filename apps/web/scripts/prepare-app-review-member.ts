import type {
  HostedOpsAppReviewMemberMode,
  HostedOpsAppReviewMemberPrincipal,
} from "../src/lib/hosted-ops/app-review-member";

type Principal = HostedOpsAppReviewMemberPrincipal;

interface Options {
  apply: boolean;
  createPrivyUser: boolean;
  help: boolean;
  principal: Principal | null;
}

const usage = `
Usage:
  NODE_OPTIONS=--conditions=react-server \\
    vercel env run --environment=production -- \\
    pnpm --dir ../.. exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/prepare-app-review-member.ts --email <reviewer-email> --create-privy-user --apply

Options:
  --email <email>          Resolve the Privy reviewer user by email.
  --phone <e164>           Resolve the Privy reviewer user by phone.
  --privy-user-id <id>     Resolve the Privy reviewer user by Privy user id.
  --create-privy-user      Authenticate the configured Privy test account first.
                           This is supported for --email and requires --apply.
  --apply                  Perform production writes. Without this, only inspect.
  --help                   Print this message.
`;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage.trim());
    return;
  }
  if (!options.principal) {
    throw new Error("Choose exactly one reviewer principal: --email, --phone, or --privy-user-id.");
  }
  if (options.createPrivyUser && options.principal.kind !== "email") {
    throw new Error("--create-privy-user currently supports --email test accounts only.");
  }
  if (options.createPrivyUser && !options.apply) {
    throw new Error("--create-privy-user changes Privy state and requires --apply.");
  }
  assertReactServerCondition();

  const [{ createPrismaClient }, { prepareHostedOpsAppReviewMember }] =
    await Promise.all([
      import("../src/lib/prisma"),
      import("../src/lib/hosted-ops/app-review-member"),
    ]);

  const databaseUrl = normalizeRequiredEnv("DATABASE_URL", process.env.DATABASE_URL);
  const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

  try {
    printResult(await prepareHostedOpsAppReviewMember({
      createPrivyUser: options.createPrivyUser,
      mode: readMode(options),
      principal: options.principal,
      prisma,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apply: false,
    createPrivyUser: false,
    help: false,
    principal: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--create-privy-user":
        options.createPrivyUser = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--email":
        options.principal = setPrincipal(options.principal, {
          kind: "email",
          value: normalizeRequiredArgument(arg, argv[++i]),
        });
        break;
      case "--phone":
        options.principal = setPrincipal(options.principal, {
          kind: "phone",
          value: normalizeRequiredArgument(arg, argv[++i]),
        });
        break;
      case "--privy-user-id":
        options.principal = setPrincipal(options.principal, {
          kind: "privyUserId",
          value: normalizeRequiredArgument(arg, argv[++i]),
        });
        break;
      default:
        throw new Error(`Unknown option: ${arg ?? ""}`);
    }
  }

  return options;
}

function setPrincipal(existing: Principal | null, next: Principal): Principal {
  if (existing) {
    throw new Error("Choose only one of --email, --phone, or --privy-user-id.");
  }
  return next;
}

function normalizeRequiredArgument(name: string, value: string | undefined): string {
  const normalized = normalizeNullableString(value);
  if (!normalized || normalized.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return normalized;
}

function normalizeRequiredEnv(name: string, value: string | null | undefined): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new Error(`${name} must be present in the command environment.`);
  }
  return normalized;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readMode(options: Options): HostedOpsAppReviewMemberMode {
  return options.apply ? "apply" : "dry-run";
}

function assertReactServerCondition(): void {
  if (hasReactServerCondition()) {
    return;
  }
  throw new Error(
    "Run with NODE_OPTIONS=--conditions=react-server so the script can use server-only consent helpers.",
  );
}

function hasReactServerCondition(): boolean {
  const values = [
    ...process.execArgv,
    ...(process.env.NODE_OPTIONS ?? "").split(/\s+/u),
  ];

  return values.includes("--conditions=react-server")
    || (values.includes("--conditions") && values.includes("react-server"));
}

function printResult(summary: unknown): void {
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
