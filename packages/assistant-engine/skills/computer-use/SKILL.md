---
name: computer-use
description: Use when Murph is operating a live website through hosted computer-use tools, including shopping, checkout, appointment booking, forms, authenticated websites, browser inspection, or other Playwright-driven external browser actions.
---

# Computer Use

Murph's browser is a hosted Kernel session. Use the Murph computer tools as the
browser lifecycle.

## Goal

Operate the website end-to-end when the user asked Murph to do it and the needed
information is available. Success means the requested browser-side result is
verified on the site, or the run is paused/finished with a clear blocker.

## Tools

1. `murph.computer_start_run` starts or resumes a run. Pick `profileKey:
   "commerce"` for shopping, `profileKey: "appointments"` for booking, and
   `profileKey: "default"` when neither applies. `startUrl` is only a first-page
   convenience.
2. `murph.computer_observe` reads the current URL, title, and visible text. Use
   it after starting, resuming, or any action where page state is needed.
3. `murph.computer_act` runs one bounded browser action against the current page.
4. `murph.computer_finish_run` closes the run when the task is complete, failed,
   or canceled.

## Act Primitive

`computer_act` is the only browser action primitive. Pass one action per call:

```json
{
  "runId": "hcr_...",
  "timeoutMs": 15000,
  "action": "click",
  "locator": {
    "by": "role",
    "role": "button",
    "name": "Add to cart"
  }
}
```

Use `computer_observe` between actions when you need to inspect the resulting
page. For example:

```json
{
  "runId": "hcr_...",
  "action": "fill",
  "locator": {
    "by": "label",
    "text": "Email"
  },
  "value": "user@example.com"
}
```

The service runs the action with server-owned Playwright code, then returns the
current URL and title. Available actions: `goto`, `click`, `fill`, `type`,
`select`, `check`, `uncheck`, `press`, `scroll`, `wait`, and `waitFor`.

Prefer user-facing locators in this order: role/name, label, placeholder, text,
alt/title, test id, then CSS only when the page gives no semantic handle. Do
not ask for or expose cookies, local storage, passwords, card numbers, raw
tokens, or other secrets.

Common action shapes:

```json
{
  "runId": "hcr_...",
  "action": "goto",
  "url": "https://example.com"
}
```

```json
{
  "runId": "hcr_...",
  "action": "select",
  "locator": {
    "by": "label",
    "text": "Appointment time"
  },
  "value": "9:30 AM"
}
```

```json
{
  "runId": "hcr_...",
  "action": "press",
  "key": "Enter"
}
```

```json
{
  "runId": "hcr_...",
  "action": "scroll",
  "deltaY": 900
}
```

```json
{
  "runId": "hcr_...",
  "action": "waitFor",
  "locator": {
    "by": "text",
    "text": "Order confirmed"
  },
  "state": "visible"
}
```

## Operating Rules

This includes adding products to carts, choosing appointment slots, submitting
ordinary forms, placing orders, or booking appointments when the current user
message has authorized the exact final terms shown on the site.

Before an irreversible purchase, booking, payment authorization, insurance or
health submission, or order placement, continue only if the current user message
already authorized the exact provider/product, time, quantity, price, payment
method, and other material final terms shown on the page. Otherwise pause with
`reason: "final_confirmation"` for in-chat confirmation or direct takeover.

Pause only when Murph is actually blocked: expired login, CAPTCHA, missing
payment or identity details, a choice the user has not authorized, or a page
that needs direct user takeover. When pausing, use `computer_pause_for_user`;
after the user replies, resume the same run through `computer_start_run` with
`resumeRunId`, then observe before acting.

After actions that might have navigated, submitted, or changed state, use
`computer_observe` to inspect the result before continuing. If a transport or
browser error leaves the outcome unknown, observe before retrying.

Stop when the task is verified complete, a material blocker needs the user, or a
site failure makes progress impossible. Do not keep searching or clicking once
the core browser outcome is established.
