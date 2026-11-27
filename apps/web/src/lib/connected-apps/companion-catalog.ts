import type { ComposioConnectedAccount } from "./composio";
import { formatHostedConnectedAppToolkitLabel, type HostedConnectedAppsConfig } from "./config";

const catalog: Readonly<Record<string, { name: string; kind: string; detail: string; logoPath: string }>> = {
  gmail: { name: "Gmail", kind: "Email", detail: "Murph can read your email and send one when you ask.", logoPath: "/brand-logos/connect/gmail-app.png" },
  googlecalendar: { name: "Google Calendar", kind: "Calendar", detail: "Murph can see your calendar and add an event when you ask.", logoPath: "/brand-logos/connect/google-calendar-app.png" },
  outlook: { name: "Outlook", kind: "Email and calendar", detail: "Murph can read your email and calendar, and send an email or add an event when you ask.", logoPath: "/brand-logos/connect/outlook-app.png" },
  zoho_mail: { name: "Zoho Mail", kind: "Email", detail: "Murph can read your email.", logoPath: "/brand-logos/connect/zoho-mail-app.png" },
  googledrive: { name: "Google Drive", kind: "Files", detail: "Murph can look through your files.", logoPath: "/brand-logos/connect/google-drive-app.png" },
  one_drive: { name: "OneDrive", kind: "Files", detail: "Murph can look through your files.", logoPath: "/brand-logos/connect/onedrive-app.png" },
  dropbox: { name: "Dropbox", kind: "Files", detail: "Murph can look through your files.", logoPath: "/brand-logos/connect/dropbox-app.png" },
  googletasks: { name: "Google Tasks", kind: "To-dos", detail: "Murph can see your to-dos.", logoPath: "/brand-logos/connect/google-tasks-app.png" },
  todoist: { name: "Todoist", kind: "To-dos", detail: "Murph can see your to-dos.", logoPath: "/brand-logos/connect/todoist-app.png" },
  notion: { name: "Notion", kind: "Notes", detail: "Murph can read your pages.", logoPath: "/brand-logos/connect/notion-app.png" },
};

type InventoryEntry = { account: ComposioConnectedAccount; connectedAt: string | null };

function accountTime(entry: InventoryEntry): number {
  const time = Date.parse(entry.connectedAt ?? entry.account.createdAt ?? "");
  return Number.isFinite(time) ? time : Infinity;
}

export function presentCompanionConnectedApps(
  config: Pick<HostedConnectedAppsConfig, "toolkits" | "maxAccountsPerToolkit">,
  inventory: InventoryEntry[],
) {
  const byToolkit = new Map<string, typeof inventory>(config.toolkits.map(slug => [slug, []]));
  for (const entry of inventory) {
    if (entry.account.status !== "ACTIVE") continue;
    const slug = entry.account.toolkit.slug;
    const accounts = byToolkit.get(slug);
    if (accounts) accounts.push(entry);
    else byToolkit.set(slug, [entry]);
  }

  return {
    schemaVersion: 1,
    apps: Array.from(byToolkit, ([id, entries]) => {
      const metadata = Object.hasOwn(catalog, id) ? catalog[id] : undefined;
      entries.sort((a, b) => accountTime(a) - accountTime(b) || a.account.id.localeCompare(b.account.id));
      return {
        id,
        name: metadata?.name ?? formatHostedConnectedAppToolkitLabel(id),
        kind: metadata?.kind ?? null,
        detail: metadata?.detail ?? null,
        logoPath: metadata?.logoPath ?? null,
        canAdd: config.toolkits.includes(id) && entries.length < config.maxAccountsPerToolkit,
        accounts: entries.map(({ account, connectedAt }) => ({ id: account.id, name: account.alias, connectedAt })),
      };
    }),
  };
}
