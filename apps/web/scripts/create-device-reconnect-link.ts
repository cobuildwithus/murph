import {
  createHostedDeviceReconnectLink,
  parseHostedDeviceReconnectLinkCliArgs,
} from "../src/lib/device-sync/reconnect-link-tool";

const USAGE = `Usage:
  pnpm --dir apps/web device:reconnect-link -- --member-id <member-id> --source-provider-slug whoop_v2

Options:
  --member-id <id>                 Hosted member id that owns the reconnect link.
  --source-provider-slug <slug>    Junction source slug, for example whoop_v2.
  --connect-source <id>            Optional public source id, for example whoop.
  --connect-target <target>        Optional connect target, for example whoop.
  --base-url <url>                 Optional hosted web origin when env is not configured.
`;

async function main(): Promise<void> {
  const args = parseHostedDeviceReconnectLinkCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE.trim());
    return;
  }

  const result = await createHostedDeviceReconnectLink({ args });
  console.log(`Created ${result.target.label} reconnect link.`);
  console.log(`Provider: ${result.target.provider}`);
  if (result.target.sourceProviderSlug) {
    console.log(`Source provider slug: ${result.target.sourceProviderSlug}`);
  }
  console.log(`Expires at: ${result.expiresAt}`);
  console.log(`Connect URL: ${result.connectUrl}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
