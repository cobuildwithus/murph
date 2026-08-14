import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { test } from "vitest";

import { resolveHostedWebWorkspaceSourceEntries } from "../../../config/workspace-source-resolution";
import {
  HOSTED_WEB_BUILD_DIST_DIR,
  HOSTED_WEB_DEV_DIST_DIR,
  HOSTED_WEB_SMOKE_DIST_DIR,
  createHostedWebSmokeEnvironment,
  isHostedWebDevFileSystemCacheEnabled,
  isHostedWebSmokeArtifactMode,
  resolveHostedWebDistDir,
} from "../next-artifacts";
import {
  HOSTED_WEB_NEXT_TSCONFIG_PATH,
  HOSTED_WEB_PRODUCTION_BUILD_CPUS,
  HOSTED_WEB_WORKFLOW_OPTIONS,
  WORKSPACE_SOURCE_PACKAGE_NAMES,
  assertHostedBrowserDeviceSyncCallbackHostnameConfiguration,
  buildHostedWebClientEnv,
  buildHostedWebNextConfig,
  buildHostedWebTurbopackConfig,
  buildHostedWebContentSecurityPolicy,
  buildHostedWebSecurityHeaders,
  configureHostedWebWorkflowLocalDataDir,
  resolveHostedPrivyOrigin,
  resolveHostedPrivyOrigins,
  resolvePrivyBaseDomainOrigin,
} from "../next.config";

const productionNextConfig = buildHostedWebNextConfig(
  PHASE_PRODUCTION_BUILD,
  createProcessEnv({}),
);
const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const hostedWebWorkspaceEntries = resolveHostedWebWorkspaceSourceEntries(path.join(repoRoot, "apps/web"));

test("resolveHostedWebWorkspaceSourceEntries points at hosted source package entries", () => {
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/cloudflare-hosted-control"],
    path.join(repoRoot, "packages/cloudflare-hosted-control/package.json"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/device-syncd"],
    path.join(repoRoot, "packages/device-syncd/src/index.ts"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/gateway-core"],
    path.join(repoRoot, "packages/gateway-core/src/index.ts"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/parsers"],
    path.join(repoRoot, "packages/parsers/src/index.ts"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/core"],
    path.join(repoRoot, "packages/core/src/index.ts"),
  );
  assert.equal(
    hostedWebWorkspaceEntries["@murphai/hosted-execution"],
    path.join(repoRoot, "packages/hosted-execution/src/index.ts"),
  );
});

test("next.config transpiles hosted workspace source packages instead of pinning dist aliases", () => {
  assert.deepEqual(productionNextConfig.transpilePackages, [...WORKSPACE_SOURCE_PACKAGE_NAMES]);
});

test("next.config stays out of hosted web runtime source modules", () => {
  const source = readFileSync(path.join(repoRoot, "apps/web/next.config.ts"), "utf8");

  assert.doesNotMatch(source, /from ["']\.\/src\//u);
});

test("next.config exposes the non-secret Telegram username override to client bundles", () => {
  assert.deepEqual(
    buildHostedWebClientEnv(createProcessEnv({
      MURPH_TELEGRAM_USERNAME_OVERRIDE: " @murphdevelopment_bot ",
    })),
    {
      MURPH_TELEGRAM_USERNAME_OVERRIDE: "@murphdevelopment_bot",
    },
  );
});

test("hosted web tsconfig resolves Temporal orchestration-control from source", () => {
  const tsconfig = JSON.parse(
    readFileSync(path.join(repoRoot, "apps/web/tsconfig.json"), "utf8"),
  ) as {
    compilerOptions?: {
      paths?: Record<string, readonly string[]>;
    };
  };

  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/hosted-execution/orchestration-control"],
    ["../../packages/hosted-execution/src/orchestration-control.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/hosted-execution/connected-apps"],
    ["../../packages/hosted-execution/src/connected-apps.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/hosted-execution/routes"],
    ["../../packages/hosted-execution/src/routes.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/hosted-execution/phone-calls"],
    ["../../packages/hosted-execution/src/phone-calls.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/hosted-execution/plan-usage"],
    ["../../packages/hosted-execution/src/plan-usage.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/hosted-execution/subscription"],
    ["../../packages/hosted-execution/src/subscription.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/hosted-execution/assistant-identifiers"],
    ["../../packages/hosted-execution/src/assistant-identifiers.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/hosted-execution/assistant-personalization"],
    ["../../packages/hosted-execution/src/assistant-personalization.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/runtime-state/assistant-generated-deliveries"],
    ["../../packages/runtime-state/src/assistant-generated-deliveries.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/device-syncd/providers/junction-client"],
    ["../../packages/device-syncd/src/providers/junction-client.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/device-syncd/provider-credential-policy"],
    ["../../packages/device-syncd/src/provider-credential-policy.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/device-syncd/provider-match"],
    ["../../packages/device-syncd/src/provider-match.ts"],
  );
  assert.deepEqual(
    tsconfig.compilerOptions?.paths?.["@murphai/device-syncd/providers/junction-config"],
    ["../../packages/device-syncd/src/providers/junction-config.ts"],
  );
});

test("hosted web build tsconfig keeps tests out of Next production checks", () => {
  const tsconfig = JSON.parse(
    readFileSync(path.join(repoRoot, "apps/web/tsconfig.next.json"), "utf8"),
  ) as {
    extends?: string;
    include?: readonly string[];
    exclude?: readonly string[];
    compilerOptions?: {
      tsBuildInfoFile?: string;
    };
  };

  assert.equal(tsconfig.extends, "./tsconfig.json");
  assert.equal(tsconfig.compilerOptions?.tsBuildInfoFile, ".next/cache/tsconfig.next.tsbuildinfo");
  assert.ok(tsconfig.include?.includes("app/**/*.tsx"));
  assert.ok(tsconfig.include?.includes("src/**/*.ts"));
  assert.ok(tsconfig.include?.includes(".next/types/**/*.ts"));
  assert.ok(!tsconfig.include?.includes("test/**/*.ts"));
  assert.ok(!tsconfig.include?.includes("test/**/*.tsx"));
  assert.ok(tsconfig.exclude?.includes("test"));
});

test("hosted web keeps Next on TypeScript 5 while workspace checks use TypeScript 7", () => {
  const rootRequire = createRequire(path.join(repoRoot, "package.json"));
  const hostedWebRequire = createRequire(path.join(repoRoot, "apps/web/package.json"));

  const readTypeScriptVersion = (packageRequire: NodeJS.Require): string => {
    const packageMetadata: unknown = JSON.parse(
      readFileSync(packageRequire.resolve("typescript/package.json"), "utf8"),
    );

    assert.ok(packageMetadata && typeof packageMetadata === "object");
    const version = "version" in packageMetadata ? packageMetadata.version : undefined;
    if (typeof version !== "string") {
      throw new TypeError("Resolved TypeScript package does not declare a string version.");
    }
    return version;
  };

  assert.match(readTypeScriptVersion(rootRequire), /^7\./u);
  assert.match(readTypeScriptVersion(hostedWebRequire), /^5\./u);
});

test("hosted web dist-dir selection reserves a dedicated artifact directory for interactive dev", () => {
  assert.equal(resolveHostedWebDistDir(PHASE_DEVELOPMENT_SERVER), HOSTED_WEB_DEV_DIST_DIR);
  assert.equal(resolveHostedWebDistDir(PHASE_PRODUCTION_BUILD), HOSTED_WEB_BUILD_DIST_DIR);
  assert.equal(productionNextConfig.distDir, HOSTED_WEB_BUILD_DIST_DIR);
});

test("hosted web dev smoke uses its own Next artifact directory", () => {
  assert.equal(isHostedWebSmokeArtifactMode(createProcessEnv({})), false);
  assert.equal(
    isHostedWebSmokeArtifactMode(createHostedWebSmokeEnvironment(createProcessEnv({}))),
    true,
  );
  assert.equal(
    resolveHostedWebDistDir(
      PHASE_DEVELOPMENT_SERVER,
      createHostedWebSmokeEnvironment(createProcessEnv({})),
    ),
    HOSTED_WEB_SMOKE_DIST_DIR,
  );
  assert.equal(
    resolveHostedWebDistDir(
      PHASE_PRODUCTION_BUILD,
      createHostedWebSmokeEnvironment(createProcessEnv({})),
    ),
    HOSTED_WEB_SMOKE_DIST_DIR,
  );
});

test("next.config externalizes the Temporal client only for hosted-local smoke artifacts", () => {
  const smokeNextConfig = buildHostedWebNextConfig(
    PHASE_PRODUCTION_BUILD,
    createHostedWebSmokeEnvironment(createProcessEnv({})),
  );

  assert.deepEqual(smokeNextConfig.serverExternalPackages, ["@temporalio/client"]);
  assert.equal(productionNextConfig.serverExternalPackages, undefined);
});

test("hosted web smoke can isolate concurrent dev and production runs with a dist-dir suffix", () => {
  assert.equal(
    resolveHostedWebDistDir(
      PHASE_DEVELOPMENT_SERVER,
      createHostedWebSmokeEnvironment(createProcessEnv({
        NEXT_DIST_DIR_SUFFIX: "e2e-run",
      })),
    ),
    `${HOSTED_WEB_SMOKE_DIST_DIR}-e2e-run`,
  );
  assert.equal(
    resolveHostedWebDistDir(
      PHASE_PRODUCTION_BUILD,
      createHostedWebSmokeEnvironment(createProcessEnv({
        NEXT_DIST_DIR_SUFFIX: "e2e-run",
      })),
    ),
    `${HOSTED_WEB_SMOKE_DIST_DIR}-e2e-run`,
  );
});

test("next.config scopes Workflow local-world storage to the hosted web dist directory", () => {
  const devEnvironment = createProcessEnv({
    WORKFLOW_LOCAL_DATA_DIR: ".next/workflow-data",
    WORKFLOW_TARGET_WORLD: "local",
  });

  configureHostedWebWorkflowLocalDataDir(PHASE_DEVELOPMENT_SERVER, devEnvironment);

  assert.equal(
    devEnvironment.WORKFLOW_LOCAL_DATA_DIR,
    path.join(HOSTED_WEB_DEV_DIST_DIR, "workflow-data"),
  );

  const smokeEnvironment = createHostedWebSmokeEnvironment(createProcessEnv({
    WORKFLOW_TARGET_WORLD: "local",
  }));

  configureHostedWebWorkflowLocalDataDir(PHASE_DEVELOPMENT_SERVER, smokeEnvironment);

  assert.equal(
    smokeEnvironment.WORKFLOW_LOCAL_DATA_DIR,
    path.join(HOSTED_WEB_SMOKE_DIST_DIR, "workflow-data"),
  );
});

test("next.config preserves explicit nonlocal Workflow world configuration", () => {
  const explicitDataDirEnvironment = createProcessEnv({
    WORKFLOW_LOCAL_DATA_DIR: "custom-workflow-data",
    WORKFLOW_TARGET_WORLD: "local",
  });

  configureHostedWebWorkflowLocalDataDir(
    PHASE_DEVELOPMENT_SERVER,
    explicitDataDirEnvironment,
  );

  assert.equal(explicitDataDirEnvironment.WORKFLOW_LOCAL_DATA_DIR, "custom-workflow-data");

  const nonLocalWorldEnvironment = createProcessEnv({
    WORKFLOW_LOCAL_DATA_DIR: ".next/workflow-data",
    WORKFLOW_TARGET_WORLD: "vercel",
  });

  configureHostedWebWorkflowLocalDataDir(
    PHASE_DEVELOPMENT_SERVER,
    nonLocalWorldEnvironment,
  );

  assert.equal(nonLocalWorldEnvironment.WORKFLOW_LOCAL_DATA_DIR, ".next/workflow-data");

  const vercelEnvironment = createProcessEnv({
    VERCEL_DEPLOYMENT_ID: "deployment_123",
    WORKFLOW_LOCAL_DATA_DIR: ".next/workflow-data",
  });

  configureHostedWebWorkflowLocalDataDir(PHASE_DEVELOPMENT_SERVER, vercelEnvironment);

  assert.equal(vercelEnvironment.WORKFLOW_LOCAL_DATA_DIR, ".next/workflow-data");
});

test("hosted web dev filesystem cache defaults off and allows explicit opt-in", () => {
  assert.equal(isHostedWebDevFileSystemCacheEnabled(), false);
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "1",
      }),
    ),
    true,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "yes",
      }),
    ),
    true,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "true",
      }),
    ),
    true,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "0",
      }),
    ),
    false,
  );
  assert.equal(
    isHostedWebDevFileSystemCacheEnabled(
      createProcessEnv({
        MURPH_NEXT_DEV_FILESYSTEM_CACHE: "no",
      }),
    ),
    false,
  );
});

test("next.config keeps Turbopack focused on the repo root without custom workspace rewrite rules", () => {
  assert.equal(productionNextConfig.turbopack?.root, process.cwd());
  assert.equal(productionNextConfig.webpack, undefined);
  assert.deepEqual(productionNextConfig.typescript, {
    tsconfigPath: HOSTED_WEB_NEXT_TSCONFIG_PATH,
  });
  assert.equal(productionNextConfig.experimental?.cpus, HOSTED_WEB_PRODUCTION_BUILD_CPUS);
});

test("next.config leaves agent guidance under repository ownership", () => {
  assert.equal(productionNextConfig.agentRules, false);
});

test("production build config enables the bounded Webpack worker path", () => {
  assert.equal(productionNextConfig.experimental?.turbopackFileSystemCacheForBuild, false);
  assert.equal(productionNextConfig.experimental?.turbopackSourceMaps, false);
  assert.equal(productionNextConfig.experimental?.webpackBuildWorker, true);
  assert.equal(productionNextConfig.experimental?.webpackMemoryOptimizations, true);
});

test("hosted runtime issue imports avoid the runtime-state Node barrel", () => {
  const source = readFileSync(
    path.join(repoRoot, "apps/web/src/lib/hosted-execution/runtime-issues.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /from ["']@murphai\/runtime-state\/node["']/u);
  assert.match(source, /from ["']@murphai\/runtime-state\/node\/assistant-runtime-issues["']/u);
});

test("device connect routes use the narrow connect-config entrypoint", () => {
  for (const relativePath of [
    "apps/web/app/(dashboard)/connect/connect-page-content.tsx",
    "apps/web/app/api/connect-sources/[sourceId]/start/route.ts",
    "apps/web/app/api/internal/device-sync/connect-targets/[connectTarget]/connect-link/route.ts",
    "apps/web/app/device/connect/[claim]/route.ts",
    "apps/web/src/lib/device-sync/connect-completion.ts",
    "apps/web/src/lib/device-sync/connect-intents.ts",
    "apps/web/src/lib/device-sync/hosted-connect-start.ts",
    "apps/web/src/lib/device-sync/wake-service.ts",
  ]) {
    const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

    assert.doesNotMatch(source, /from ["']@murphai\/device-syncd\/config["']/u);
    assert.match(source, /from ["']@murphai\/device-syncd\/connect-config["']/u);
  }
});

test("connect-link routes use the lightweight device-sync error entrypoint", () => {
  for (const relativePath of [
    "apps/web/app/api/connect-sources/[sourceId]/start/route.ts",
    "apps/web/app/api/internal/device-sync/connect-targets/[connectTarget]/connect-link/route.ts",
    "apps/web/app/device/connect/[claim]/route.ts",
  ]) {
    const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

    assert.doesNotMatch(source, /from ["']@murphai\/device-syncd\/public-ingress["']/u);
    assert.match(source, /from ["']@murphai\/device-syncd\/errors["']/u);
  }
});

test("next.config uses Workflow lazy discovery to avoid eager dev rebuild loops", () => {
  assert.deepEqual(HOSTED_WEB_WORKFLOW_OPTIONS, {
    workflows: {
      lazyDiscovery: true,
    },
  });
});

test("next.config traces generated Health Commons route files without the monolithic catalog", () => {
  assert.deepEqual(
    productionNextConfig.outputFileTracingIncludes?.["/measurement-methods/[measurementMethodId]"],
    [
      "../../packages/health-commons/generated/web/routes/index.json",
      "../../packages/health-commons/generated/web/bundles/measurement_method/**/*.json",
    ],
  );
  assert.deepEqual(
    productionNextConfig.outputFileTracingIncludes?.["/biomarkers"],
    [
      "../../packages/health-commons/generated/web/browse/biomarkers.json",
      "../../packages/health-commons/generated/web/routes/index.json",
      "../../packages/health-commons/generated/web/shell/biomarkers/**/*.json",
      "../../packages/health-commons/generated/web/pages/biomarkers/**/*.json",
    ],
  );
  assert.equal(
    productionNextConfig.outputFileTracingIncludes?.["/biomarkers/[biomarkerId]"],
    undefined,
  );
  assert.equal(
    productionNextConfig.outputFileTracingIncludes?.["/biomarkers/[biomarkerId]/research"],
    undefined,
  );
  assert.doesNotMatch(
    JSON.stringify(productionNextConfig.outputFileTracingIncludes),
    /generated\/catalog\.json/u,
  );
});

test("next.config traces bundled image assets for the iMessage nutrition route", () => {
  const sharedImageAssets =
    productionNextConfig.outputFileTracingIncludes?.["/opengraph-image"];

  assert.ok(sharedImageAssets);
  assert.deepEqual(
    productionNextConfig.outputFileTracingIncludes?.[
      "/imessage/card/v1/[payload]"
    ],
    sharedImageAssets,
  );
});

test("next.config disables the Turbopack dev filesystem cache by default and honors explicit opt-in", () => {
  const previousValue = process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE;

  try {
    delete process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE;
    assert.equal(
      buildHostedWebNextConfig(PHASE_DEVELOPMENT_SERVER).experimental
        ?.turbopackFileSystemCacheForDev,
      false,
    );

    process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE = "1";
    assert.equal(
      buildHostedWebNextConfig(PHASE_DEVELOPMENT_SERVER).experimental
        ?.turbopackFileSystemCacheForDev,
      true,
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE;
    } else {
      process.env.MURPH_NEXT_DEV_FILESYSTEM_CACHE = previousValue;
    }
  }
});

test("buildHostedWebTurbopackConfig always points Turbopack at the repo root", () => {
  const turbopackConfig = buildHostedWebTurbopackConfig();
  const resolveAlias = turbopackConfig?.resolveAlias;
  const hasOptionalModule = resolveHostedOptionalModule();

  assert.equal(turbopackConfig?.root, process.cwd());
  if (hasOptionalModule) {
    assert.equal(resolveAlias, undefined);
  } else {
    assert.deepEqual(resolveAlias, {
      "@farcaster/mini-app-solana": "./src/lib/empty-module.ts",
    });
  }
});

test("resolvePrivyBaseDomainOrigin normalizes base-domain inputs into a Privy origin", () => {
  assert.equal(resolvePrivyBaseDomainOrigin("example.com"), "https://privy.example.com");
  assert.equal(
    resolvePrivyBaseDomainOrigin("https://privy.example.com/dashboard"),
    "https://privy.example.com",
  );
  assert.equal(resolvePrivyBaseDomainOrigin("https://www.example.com/join"), "https://privy.example.com");
  assert.equal(resolvePrivyBaseDomainOrigin("   "), null);
});

test("resolveHostedPrivyOrigin prefers an explicit custom auth domain and otherwise falls back to the hosted public origin", () => {
  assert.equal(
    resolveHostedPrivyOrigin(createProcessEnv({
      PRIVY_CUSTOM_AUTH_DOMAIN: "privy.custom.example.com",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://www.example.com",
    })),
    "https://privy.custom.example.com",
  );
  assert.equal(
    resolveHostedPrivyOrigin(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://www.example.com",
    })),
    "https://privy.example.com",
  );
});

test("resolveHostedPrivyOrigin rejects hosted public base URLs with non-root paths", () => {
  assert.throws(
    () => resolveHostedPrivyOrigin(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://www.example.com/join",
    })),
    /must not include a path/u,
  );
});

test("resolveHostedPrivyOrigin rejects a pathful HOSTED_WEB_BASE_URL fallback", () => {
  assert.throws(
    () => resolveHostedPrivyOrigin(createProcessEnv({
      HOSTED_WEB_BASE_URL: "https://www.example.com/app",
    })),
    /must not include a path/u,
  );
});

test("resolveHostedPrivyOrigin rejects a pathful Vercel production fallback", () => {
  assert.throws(
    () => resolveHostedPrivyOrigin(createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.example.com/app",
    })),
    /must not include a path/u,
  );
});

test("resolveHostedPrivyOrigin falls back to the Vercel production URL when no hosted public base URL is configured", () => {
  assert.equal(
    resolveHostedPrivyOrigin(createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.example.com",
    })),
    "https://privy.example.com",
  );
});

test("hosted Web accepts a path-capable device callback on every configured app-session hostname", () => {
  assert.doesNotThrow(() => {
    assertHostedBrowserDeviceSyncCallbackHostnameConfiguration(createProcessEnv({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://app.example.com/custom/device-sync",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://app.example.com",
      HOSTED_WEB_BASE_URL: "https://app.example.com",
    }));
  });
});

test("hosted Web rejects a device callback on a different HOSTED_WEB_BASE_URL hostname", () => {
  assert.throws(
    () => assertHostedBrowserDeviceSyncCallbackHostnameConfiguration(createProcessEnv({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.com/api/device-sync",
      HOSTED_WEB_BASE_URL: "https://app.example.com",
    })),
    /effective hosted browser device callback from DEVICE_SYNC_PUBLIC_BASE_URL must use the HOSTED_WEB_BASE_URL hostname/u,
  );
});

test("hosted Web rejects a callback that cannot return to the configured onboarding session hostname", () => {
  assert.throws(
    () => assertHostedBrowserDeviceSyncCallbackHostnameConfiguration(createProcessEnv({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://app.example.com/api/device-sync",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.com",
      HOSTED_WEB_BASE_URL: "https://app.example.com",
    })),
    /effective hosted browser device callback from DEVICE_SYNC_PUBLIC_BASE_URL must use the HOSTED_ONBOARDING_PUBLIC_BASE_URL hostname/u,
  );
});

test("hosted Web rejects an implicit callback derived from a split onboarding hostname", () => {
  assert.throws(
    () => assertHostedBrowserDeviceSyncCallbackHostnameConfiguration(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.com",
      HOSTED_WEB_BASE_URL: "https://app.example.com",
    })),
    /effective hosted browser device callback from HOSTED_ONBOARDING_PUBLIC_BASE_URL must use the HOSTED_WEB_BASE_URL hostname/u,
  );
});

test("hosted Web accepts an implicit callback when every browser surface shares one hostname", () => {
  assert.doesNotThrow(
    () => assertHostedBrowserDeviceSyncCallbackHostnameConfiguration(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://app.example.com",
      HOSTED_WEB_BASE_URL: "https://app.example.com",
    })),
  );
});

test("resolveHostedPrivyOrigins adds the base-domain fallback for common hosted-web subdomains", () => {
  assert.deepEqual(
    resolveHostedPrivyOrigins(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://app.withmurph.ai",
    })),
    [
      "https://privy.app.withmurph.ai",
      "https://privy.withmurph.ai",
    ],
  );
});

test("resolveHostedPrivyOrigins prefers PRIVY_BASE_DOMAIN over hosted public subdomain fallbacks", () => {
  assert.deepEqual(
    resolveHostedPrivyOrigins(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://app.withmurph.ai",
      PRIVY_BASE_DOMAIN: "withmurph.ai",
    })),
    ["https://privy.withmurph.ai"],
  );
});

test("buildHostedWebContentSecurityPolicy includes Privy, WalletConnect, and hosted browser protections", () => {
  const csp = buildHostedWebContentSecurityPolicy(createProcessEnv({
    HOSTED_COMPUTER_LIVE_VIEW_ORIGINS: "https://kernel.example.test",
    NODE_ENV: "production",
    PRIVY_CUSTOM_AUTH_DOMAIN: "https://privy.custom.example.com",
  }));

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src [^;]*https:\/\/auth\.privy\.io/);
  assert.match(csp, /script-src [^;]*https:\/\/telegram\.org/);
  assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /manifest-src 'self'/);
  assert.match(csp, /media-src 'self' blob:/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /child-src [^;]*https:\/\/auth\.privy\.io/);
  assert.match(csp, /child-src [^;]*https:\/\/privy\.custom\.example\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/privy\.custom\.example\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/\*\.onkernel\.com:8443/);
  assert.doesNotMatch(csp, /https:\/\/kernel\.example\.test/);
  assert.match(csp, /frame-src [^;]*https:\/\/oauth\.telegram\.org/);
  assert.match(csp, /frame-src [^;]*https:\/\/verify\.walletconnect\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/privy\.custom\.example\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/\*\.onkernel\.com:8443/);
  assert.match(csp, /connect-src [^;]*wss:\/\/\*\.onkernel\.com:8443/);
  assert.match(csp, /connect-src [^;]*https:\/\/\*\.rpc\.privy\.systems/);
  assert.match(csp, /connect-src [^;]*https:\/\/explorer-api\.walletconnect\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/status\.withmurph\.ai/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});

test("buildHostedWebContentSecurityPolicy keeps production script origins on a tight allowlist", () => {
  const csp = buildHostedWebContentSecurityPolicy(createProcessEnv({
    NODE_ENV: "production",
  }));
  const directives = readCspDirectives(csp);
  const expectedScriptSources = [
    "'self'",
    "'unsafe-inline'",
    "https://auth.privy.io",
    "https://telegram.org",
    "https://challenges.cloudflare.com",
  ];

  assert.deepEqual(directives.get("script-src"), expectedScriptSources);
  assert.ok(!directives.has("script-src-elem"));
  assert.deepEqual(directives.get("script-src-attr"), ["'none'"]);
  for (const directive of ["script-src", "script-src-elem", "script-src-attr"]) {
    assertScriptDirectiveHasNoBroadSource(directives, directive);
  }
  assert.doesNotMatch(csp, /cookieyes/u);
  assert.doesNotMatch(csp, /cdncookieyes/u);
});

test("buildHostedWebContentSecurityPolicy includes the base-domain Privy fallback for common hosted-web subdomains", () => {
  for (const hostedPublicBaseUrl of [
    "https://app.withmurph.ai",
    "https://www.withmurph.ai",
    "https://web.withmurph.ai",
  ]) {
    const csp = buildHostedWebContentSecurityPolicy(createProcessEnv({
      NODE_ENV: "production",
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: hostedPublicBaseUrl,
    }));

    assert.match(csp, /child-src [^;]*https:\/\/privy\.withmurph\.ai/);
    assert.match(csp, /frame-src [^;]*https:\/\/privy\.withmurph\.ai/);
    assert.match(csp, /connect-src [^;]*https:\/\/privy\.withmurph\.ai/);
  }
});

test("buildHostedWebContentSecurityPolicy keeps Next development relaxations scoped to development", () => {
  const csp = buildHostedWebContentSecurityPolicy(createProcessEnv({
    NODE_ENV: "development",
  }));

  assert.match(csp, /script-src [^;]*'unsafe-eval'/);
  assert.match(csp, /connect-src [^;]*ws:/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test("buildHostedWebSecurityHeaders adds production-only HSTS alongside the CSP bundle", () => {
  const productionHeaders = buildHostedWebSecurityHeaders(createProcessEnv({
    NODE_ENV: "production",
  }));
  const productionHeaderKeys = productionHeaders.map((header) => header.key);
  const productionHeaderValues = new Map(
    productionHeaders.map((header) => [header.key, header.value]),
  );

  assert.deepEqual(productionHeaderKeys, [
    "Content-Security-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "Cross-Origin-Opener-Policy",
    "Origin-Agent-Cluster",
    "X-DNS-Prefetch-Control",
    "X-Frame-Options",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ]);
  assert.equal(productionHeaderValues.get("Referrer-Policy"), "strict-origin");
  assert.equal(productionHeaderValues.get("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.equal(productionHeaderValues.get("Origin-Agent-Cluster"), "?1");
  assert.equal(productionHeaderValues.get("X-DNS-Prefetch-Control"), "off");
  assert.equal(
    productionHeaderValues.get("Permissions-Policy"),
    "camera=(), geolocation=(), microphone=(self)",
  );

  const testHeaders = buildHostedWebSecurityHeaders(createProcessEnv({
    NODE_ENV: "test",
  }));
  const testHeaderKeys = testHeaders.map((header) => header.key);
  const testHeaderValues = new Map(
    testHeaders.map((header) => [header.key, header.value]),
  );

  assert.deepEqual(testHeaderKeys, [
    "Content-Security-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "Cross-Origin-Opener-Policy",
    "Origin-Agent-Cluster",
    "X-DNS-Prefetch-Control",
    "X-Frame-Options",
    "Permissions-Policy",
  ]);
  assert.equal(testHeaderValues.get("Referrer-Policy"), "strict-origin");
  assert.equal(testHeaderValues.get("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.equal(testHeaderValues.get("Origin-Agent-Cluster"), "?1");
  assert.equal(testHeaderValues.get("X-DNS-Prefetch-Control"), "off");
  assert.equal(
    testHeaderValues.get("Permissions-Policy"),
    "camera=(), geolocation=(), microphone=(self)",
  );
});

test("next.config serves global security headers and stricter Murph Safe referrer privacy", async () => {
  const routes = await productionNextConfig.headers?.();

  assert.ok(routes);
  assert.equal(routes.length, 2);
  assert.equal(routes[0]?.source, "/(.*)");
  assert.deepEqual(
    routes[0]?.headers.map((header) => header.key),
    [
      "Content-Security-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "Cross-Origin-Opener-Policy",
      "Origin-Agent-Cluster",
      "X-DNS-Prefetch-Control",
      "X-Frame-Options",
      "Permissions-Policy",
    ],
  );
  assert.deepEqual(
    routes[0]?.headers.find((header) => header.key === "Referrer-Policy"),
    {
      key: "Referrer-Policy",
      value: "strict-origin",
    },
  );
  assert.equal(routes[1]?.source, "/search/:path*");
  assert.deepEqual(routes[1]?.headers, [
    {
      key: "Referrer-Policy",
      value: "no-referrer",
    },
  ]);
});

function resolveHostedOptionalModule(): boolean {
  try {
    require.resolve("@farcaster/mini-app-solana");
    return true;
  } catch {
    return false;
  }
}

function createProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}

function readCspDirectives(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();

  for (const part of csp.split(";")) {
    const [directive, ...sources] = part.trim().split(/\s+/u);

    if (!directive) {
      continue;
    }

    assert.ok(!directives.has(directive), `Duplicate ${directive} directive.`);
    directives.set(directive, sources);
  }

  return directives;
}

function assertScriptDirectiveHasNoBroadSource(
  directives: Map<string, string[]>,
  directive: string,
): void {
  const sources = directives.get(directive);

  if (!sources) {
    return;
  }

  for (const broadSource of ["*", "http:", "https:", "data:", "blob:"]) {
    assert.ok(!sources.includes(broadSource), `${directive} must not include ${broadSource}.`);
  }
}
