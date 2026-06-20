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
   it after starting, resuming, or any action with an uncertain result.
3. `murph.computer_act` runs Playwright code against the current `page`.
4. `murph.computer_finish_run` closes the run when the task is complete, failed,
   or canceled.

## Act Primitive

`computer_act` is the only browser action primitive. Pass Playwright code:

```json
{
  "runId": "hcr_...",
  "timeoutMs": 15000,
  "code": "await page.getByRole('button', { name: /add to cart/i }).click();"
}
```

The code runs inside an async function with `page` available. The tool returns
service-collected URL, title, and visible text after the action. Use normal
Playwright APIs:

- Navigate with `await page.goto("https://example.com", { waitUntil:
  "domcontentloaded" })`.
- Click with `page.getByRole(...).click()`.
- Fill forms with `page.getByLabel(...).fill(...)` or
  `page.getByPlaceholder(...).fill(...)`.
- Select options with `locator.selectOption(...)`.
- Check boxes with `locator.check()` and uncheck with `locator.uncheck()`.
- Use keyboard input with `page.keyboard.press(...)` or `locator.press(...)`.
- Scroll or wait with Playwright methods when the page needs it.

Prefer user-facing locators in this order: role/name, label, placeholder, text,
alt/title, test id, then CSS only when the page gives no semantic handle. Do
not read or return cookies, local storage, passwords, card numbers, raw tokens,
or other secrets.

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

After actions that might have navigated, submitted, or changed state, observe or
use the page state returned by `computer_act` to know what happened before
continuing. If a transport or browser error leaves the outcome unknown, observe
before retrying.

Stop when the task is verified complete, a material blocker needs the user, or a
site failure makes progress impossible. Do not keep searching or clicking once
the core browser outcome is established.
