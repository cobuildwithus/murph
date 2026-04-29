import type { Metadata } from "next";

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
    service: "Hosted web deployment, edge/runtime infrastructure, and optional web analytics.",
    dataCategories:
      "Account, device/browser, operational, and hosted-control-plane metadata.",
    region: "United States / global infrastructure",
    training: "No",
    retention: "Service logs and analytics per Vercel settings and Murph retention rules.",
    role: "Subprocessor",
  },
  {
    provider: "Cloudflare",
    service: "Hosted execution, Workers, Durable Objects, queues, object storage, logs, and security.",
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
    <main className="min-h-screen bg-[#f5f0e8] px-6 py-14 text-[#2d3436] sm:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <header className="max-w-3xl">
          <p className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.12em] text-[#736a58]">
            Legal
          </p>
          <h1 className="mt-4 font-serif text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[1.05]">
            Subprocessors and model providers
          </h1>
          <p className="mt-5 text-base leading-relaxed text-[#736a58]">
            This page lists providers that may process personal information or
            health data for Murph when a hosted feature, integration, or
            user-directed workflow uses that provider. Some providers apply only
            when you enable the related feature.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[#736a58]">
            Last updated: April 29, 2026. Material changes to providers that
            process health data will be reflected here and, where required by
            law or contract, notified to users.
          </p>
        </header>

        <div
          aria-label="Subprocessor provider table"
          className="mt-10 overflow-x-auto border border-[rgba(196,168,130,0.35)] bg-[rgba(255,252,246,0.84)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6f7e4f] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f5f0e8]"
          role="region"
          tabIndex={0}
        >
          <table className="min-w-[1120px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Subprocessors and third-party providers that may process Murph
              personal information or health data.
            </caption>
            <thead className="bg-[rgba(196,168,130,0.16)] font-mono text-[0.65rem] uppercase tracking-[0.1em] text-[#736a58]">
              <tr>
                <th
                  className="border-b border-[rgba(196,168,130,0.35)] px-4 py-3 font-medium"
                  scope="col"
                >
                  Provider
                </th>
                <th
                  className="border-b border-[rgba(196,168,130,0.35)] px-4 py-3 font-medium"
                  scope="col"
                >
                  Service
                </th>
                <th
                  className="border-b border-[rgba(196,168,130,0.35)] px-4 py-3 font-medium"
                  scope="col"
                >
                  Data categories
                </th>
                <th
                  className="border-b border-[rgba(196,168,130,0.35)] px-4 py-3 font-medium"
                  scope="col"
                >
                  Country/region
                </th>
                <th
                  className="border-b border-[rgba(196,168,130,0.35)] px-4 py-3 font-medium"
                  scope="col"
                >
                  Trains on Murph data?
                </th>
                <th
                  className="border-b border-[rgba(196,168,130,0.35)] px-4 py-3 font-medium"
                  scope="col"
                >
                  Retention
                </th>
                <th
                  className="border-b border-[rgba(196,168,130,0.35)] px-4 py-3 font-medium"
                  scope="col"
                >
                  Role
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(196,168,130,0.24)]">
              {providerRows.map((row) => (
                <tr key={row.provider} className="align-top">
                  <th className="w-[180px] px-4 py-4 font-semibold text-[#2d3436]" scope="row">
                    {row.provider}
                  </th>
                  <td className="w-[220px] px-4 py-4 leading-relaxed text-[#2d3436]">
                    {row.service}
                  </td>
                  <td className="w-[260px] px-4 py-4 leading-relaxed text-[#736a58]">
                    {row.dataCategories}
                  </td>
                  <td className="w-[150px] px-4 py-4 leading-relaxed text-[#736a58]">
                    {row.region}
                  </td>
                  <td className="w-[150px] px-4 py-4 leading-relaxed text-[#2d3436]">
                    {row.training}
                  </td>
                  <td className="w-[230px] px-4 py-4 leading-relaxed text-[#736a58]">
                    {row.retention}
                  </td>
                  <td className="w-[160px] px-4 py-4 leading-relaxed text-[#736a58]">
                    {row.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-8 max-w-3xl text-sm leading-relaxed text-[#736a58]">
          <p>
            Connected services may also process data as independent providers
            under their own privacy policies when you choose to connect or share
            data with them. The Murph Privacy Policy explains those boundaries
            and how to exercise privacy rights.
          </p>
        </section>
      </div>
    </main>
  );
}
