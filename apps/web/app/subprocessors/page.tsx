import type { Metadata } from "next";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Subprocessors · Murph",
  description:
    "Subprocessors and third-party providers that may process Murph personal information or health data.",
  alternates: {
    canonical: "/subprocessors",
  },
  openGraph: {
    type: "website",
  },
});

const providerRows = [
  {
    provider: "Vercel",
    service:
      "Hosted web deployment, pointer-only Workflow-managed runner nudge retries, edge/runtime infrastructure, and optional web analytics.",
    dataCategories:
      "Account, device/browser, operational, hosted-control-plane, opaque workflow input such as mailbox item identifiers and source labels, workflow event logs, and retry metadata. Provider webhook message bodies and verification secrets are not Workflow inputs.",
    region: "United States / global infrastructure",
    training: "No",
    retention:
      "Service logs, workflow state, and analytics per Vercel settings and Murph retention rules.",
    role: "Subprocessor",
  },
  {
    provider: "Cloudflare",
    service: "Hosted execution, Workers, Durable Objects, object storage, logs, and security.",
    dataCategories:
      "Encrypted stored workspace data, transient execution content needed to run requested hosted workflows, execution metadata, runtime logs, and operational artifacts.",
    region: "United States / global infrastructure",
    training: "No",
    retention: "Execution artifacts and logs per Murph retention rules and deployment settings.",
    role: "Subprocessor",
  },
  {
    provider: "Deployment-specific Postgres provider",
    service: "Hosted database selected by the deployment through DATABASE_URL.",
    dataCategories:
      "Hosted member, routing, billing reference, mailbox, workspace checkpoint, and operational records.",
    region: "Deployment-specific",
    training: "No",
    retention: "Per Murph retention targets and deployment-specific database backup settings.",
    role: "Subprocessor",
  },
  {
    provider: "Privy",
    service: "Hosted authentication, identity tokens, linked accounts, and embedded-wallet support.",
    dataCategories:
      "Identity, account, linked-account, wallet, and authentication metadata.",
    region: "United States / global infrastructure",
    training: "No",
    retention: "Per Privy service settings and Murph account-retention rules.",
    role: "Subprocessor",
  },
  {
    provider: "Stripe",
    service: "Checkout, subscription billing, invoices, tax/accounting records, and payment events.",
    dataCategories:
      "Billing contact, customer, subscription, checkout, invoice, payment status, and metering metadata.",
    region: "United States / global infrastructure",
    training: "No",
    retention: "Billing records retained for legal, tax, accounting, and dispute needs.",
    role: "Subprocessor",
  },
  {
    provider: "Vercel AI Gateway",
    service: "AI inference for requested assistant, summarization, extraction, and automation features.",
    dataCategories:
      "Prompts, messages, files, health context, tool context, and outputs needed for the requested feature.",
    region: "Provider-specific",
    training: "No for Murph health data",
    retention:
      "Limited to service delivery, security, and troubleshooting where contract or configuration allows.",
    role: "Model provider / subprocessor",
  },
  {
    provider: "Configured AI model providers",
    service: "Underlying model providers configured through the hosted assistant gateway for requested AI features.",
    dataCategories:
      "Prompts, messages, files, health context, tool context, and outputs needed for the requested feature.",
    region: "Provider-specific",
    training:
      "No for Murph-managed health data. Murph does not route health data to configured model providers unless no-training controls are in place. If a user supplies their own provider account, API key, or self-hosted configuration, that provider's own settings and terms may apply.",
    retention:
      "Limited to service delivery, security, and troubleshooting under applicable provider controls.",
    role: "Deployment-configured model provider",
  },
  {
    provider: "Linq",
    service: "User-directed messaging, message delivery, attachment retrieval, and webhook ingress.",
    dataCategories:
      "Messaging identifiers, routing metadata, message content, attachments, delivery status, and webhook metadata.",
    region: "Provider-specific",
    training: "No",
    retention: "Per enabled messaging feature, provider policy, and Murph retention rules.",
    role: "Messaging provider",
  },
  {
    provider: "Telegram",
    service: "User-directed Telegram messaging, file retrieval, delivery status, and webhook ingress.",
    dataCategories:
      "Telegram identifiers, routing metadata, message content, attachments, delivery status, and webhook metadata.",
    region: "Provider-specific",
    training: "No",
    retention: "Per enabled messaging feature, provider policy, and Murph retention rules.",
    role: "Messaging provider",
  },
  {
    provider: "AgentMail",
    service: "Optional email inbox, email sync, attachment retrieval, and outbound email delivery.",
    dataCategories:
      "Email address, message headers, message content, attachments, thread metadata, and delivery status.",
    region: "Provider-specific",
    training: "No",
    retention: "Per enabled email feature, provider policy, and Murph retention rules.",
    role: "Email provider",
  },
  {
    provider: "Oura, WHOOP, Garmin, Strava, and similar wearable providers",
    service: "Optional user-authorized wearable, activity, and wellness data sync.",
    dataCategories:
      "Connection metadata, provider account identifiers, activity, sleep, recovery, body-state, and physiological data authorized by the user.",
    region: "Provider-specific",
    training: "No for Murph-directed processing",
    retention: "Per active integration, provider policy, and Murph retention rules.",
    role: "Connected service / integration provider",
  },
  {
    provider: "Mapbox",
    service: "Optional routing, geocoding, directions, and map enrichment requested by the user.",
    dataCategories:
      "Route inputs, approximate locations, directions requests, and operational metadata.",
    region: "Provider-specific",
    training: "No for Murph health data",
    retention: "Temporary request processing under Murph feature limits and provider policy.",
    role: "Feature provider / subprocessor",
  },
  {
    provider: "Configured search providers",
    service: "Optional user-requested search, retrieval, or source-discovery features.",
    dataCategories:
      "Feature-specific search queries, result snippets, source URLs, health context needed for the requested feature, and operational metadata.",
    region: "Provider-specific",
    training:
      "Murph does not send health data to search providers unless the feature requires it, the user requests it, and applicable no-training/no-secondary-use controls are in place.",
    retention:
      "Limited to service delivery, security, and troubleshooting under applicable provider controls.",
    role: "Deployment-configured feature provider",
  },
  {
    provider: "Deployment-configured transcription and parsing providers",
    service: "Optional transcription, parsing, routing, or enrichment features requested by the user.",
    dataCategories:
      "Feature-specific prompts, files, audio, extracted text, and operational metadata.",
    region: "Provider-specific",
    training:
      "No for Murph-managed health data when applicable no-training controls are in place.",
    retention:
      "Limited to service delivery, security, and troubleshooting under applicable provider controls.",
    role: "Deployment-configured feature provider",
  },
] as const;

export default function SubprocessorsPage() {
  return (
    <>
      <main className="min-h-screen bg-background px-6 py-12 antialiased sm:px-10 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <header className="max-w-2xl">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              Legal
            </p>
            <h1 className="mt-4 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground">
              Subprocessors and model providers
            </h1>
            <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
              This page lists providers that may process personal information or
              health data for Murph when a hosted feature, integration, or
              user-directed workflow uses that provider. Some providers apply only
              when you enable the related feature.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Last updated: April 29, 2026. Material changes to providers that
              process health data will be reflected here and, where required by
              law or contract, notified to users.
            </p>
            <a
              href="/legal/subprocessors.pdf"
              className="mt-4 inline-flex font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-primary transition-colors hover:text-foreground"
            >
              Download PDF
            </a>
          </header>

          <div
            aria-label="Subprocessor provider table"
            className="mt-10 overflow-x-auto rounded-md border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
            role="region"
            tabIndex={0}
          >
            <table className="min-w-[1120px] border-collapse text-left text-[13px]">
              <caption className="sr-only">
                Subprocessors and third-party providers that may process Murph
                personal information or health data.
              </caption>
              <thead className="bg-muted font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
                <tr>
                  <th className="border-b border-border px-4 py-3 font-medium" scope="col">Provider</th>
                  <th className="border-b border-border px-4 py-3 font-medium" scope="col">Service</th>
                  <th className="border-b border-border px-4 py-3 font-medium" scope="col">Data categories</th>
                  <th className="border-b border-border px-4 py-3 font-medium" scope="col">Country/region</th>
                  <th className="border-b border-border px-4 py-3 font-medium" scope="col">Trains on Murph data?</th>
                  <th className="border-b border-border px-4 py-3 font-medium" scope="col">Retention</th>
                  <th className="border-b border-border px-4 py-3 font-medium" scope="col">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {providerRows.map((row) => (
                  <tr key={row.provider} className="align-top">
                    <th className="w-[180px] px-4 py-4 font-semibold text-foreground" scope="row">
                      {row.provider}
                    </th>
                    <td className="w-[220px] px-4 py-4 leading-relaxed text-foreground">
                      {row.service}
                    </td>
                    <td className="w-[260px] px-4 py-4 leading-relaxed text-muted-foreground">
                      {row.dataCategories}
                    </td>
                    <td className="w-[150px] px-4 py-4 leading-relaxed text-muted-foreground">
                      {row.region}
                    </td>
                    <td className="w-[150px] px-4 py-4 leading-relaxed text-foreground">
                      {row.training}
                    </td>
                    <td className="w-[230px] px-4 py-4 leading-relaxed text-muted-foreground">
                      {row.retention}
                    </td>
                    <td className="w-[160px] px-4 py-4 leading-relaxed text-muted-foreground">
                      {row.role}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-8 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Connected services may also process data as independent providers
            under their own privacy policies when you choose to connect or share
            data with them. The Murph Privacy Policy explains those boundaries
            and how to exercise privacy rights.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
