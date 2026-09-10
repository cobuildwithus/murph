import { emptyJournalView, type JournalView } from "../journal-view.ts";
import type { BrowserVaultCoreCapableQueryClient } from "./shared.ts";

export function selectBrowserVaultJournal(
  client: BrowserVaultCoreCapableQueryClient,
): JournalView {
  return client.replica.journal ?? emptyJournalView();
}
