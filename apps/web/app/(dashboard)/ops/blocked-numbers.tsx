"use client";
import { useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Field, FieldLabel } from "@/src/components/ui/field";

export type BlockPage = { blocks: Array<{ contact: string; reason: string; createdAt: string }>; nextCursor: string | null };
/** The initial props exist for the design study; the Ops page passes none. */
export function BlockedNumbers(input: { initialPage?: BlockPage | null; initialError?: string | null } = {}) {
  const [contact, setContact] = useState("");
  const [page, setPage] = useState<BlockPage | null>(input.initialPage ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(input.initialError ?? null);
  const [status, setStatus] = useState("");
  async function load(after?: string) {
    const response = await fetch(`/api/ops/linq-handle-block${after ? `?after=${encodeURIComponent(after)}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load blocked numbers. Try again.");
    const next: BlockPage = await response.json();
    setPage(prior => ({ ...next, blocks: after ? [...(prior?.blocks ?? []), ...next.blocks] : next.blocks }));
  }
  async function run(operation?: "block" | "unblock", value?: string, after?: string) {
    setPending(true); setError(null); setStatus("");
    try {
      if (operation) {
        const response = await fetch("/api/ops/linq-handle-block", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation, contact: value }) });
        if (!response.ok) throw new Error(response.status === 400 ? "Enter a valid phone number or email address." : "Could not update blocked numbers. Try again.");
        if (operation === "block") setContact("");
        setStatus(operation === "block" ? "Number blocked." : "Number unblocked.");
      }
      await load(after);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update blocked numbers. Try again."); }
    finally { setPending(false); }
  }
  return <section aria-labelledby="blocked-numbers-title" className="border-t border-border/70 pt-6">
    <h2 id="blocked-numbers-title" className="font-serif text-2xl font-semibold">Blocked numbers</h2>
    <form className="mt-4 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void run("block", contact); }}>
      <Field className="min-w-0 flex-1"><FieldLabel htmlFor="blocked-contact">Phone number or email</FieldLabel>
        <Input id="blocked-contact" value={contact} onChange={event => setContact(event.target.value)} required maxLength={320} autoComplete="off" disabled={pending} />
      </Field>
      <Button type="submit" disabled={pending || !contact.trim()}>Block number</Button>
    </form>
    <p role="status" className="mt-3 text-sm text-muted-foreground">{pending ? "Updating…" : status}</p>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {page === null ? <Button className="mt-3" variant="outline" disabled={pending} onClick={() => void run()}>Show blocked numbers</Button>
      : page.blocks.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No blocked numbers.</p>
      : <ul className="mt-4 max-w-xl divide-y divide-border">{page.blocks.map(block => <li key={block.contact} className="flex items-center justify-between gap-4 py-3">
        <span className="min-w-0 break-all text-sm">{block.contact}</span>
        <Button variant="outline" disabled={pending} aria-label={`Unblock ${block.contact}`} onClick={() => void run("unblock", block.contact)}>Unblock</Button>
      </li>)}</ul>}
    {page?.nextCursor && <Button variant="outline" className="mt-3" disabled={pending} onClick={() => void run(undefined, undefined, page.nextCursor!)}>Show more</Button>}
  </section>;
}
