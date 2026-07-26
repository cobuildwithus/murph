from __future__ import annotations

import subprocess
import textwrap

WORKFLOW_REF = (
    "origin/agent/saved-card-funding-verify-runner:"
    ".github/workflows/harden-saved-card-group-funding.yml"
)

workflow = subprocess.check_output(
    ["git", "show", WORKFLOW_REF],
    text=True,
)
start_marker = "          python - <<'PY'\n"
end_marker = "\n          PY\n"
start = workflow.index(start_marker) + len(start_marker)
end = workflow.index(end_marker, start)
script = textwrap.dedent(workflow[start:end])

old = '''              2,
          )
          replace_once(
              test_path,
              ''' + "'''  mocks.stripePaymentIntentCancel.mockReset();"

second_surface = '''              1,
          )
          replace_once(
              test_path,
              """  mocks.requireHostedStripeApiMode.mockReturnValue({
    stripe: {
      checkout: {
        sessions: {
          create: mocks.stripeCheckoutCreate,
          expire: mocks.stripeCheckoutExpire,
          list: mocks.stripeCheckoutList,
          retrieve: mocks.stripeCheckoutRetrieve,
        },
      },
      prices: { retrieve: mocks.stripePriceRetrieve },
    },
    stripeLiveMode: false,
  });
""",
              """  mocks.requireHostedStripeApiMode.mockReturnValue({
    stripe: {
      checkout: {
        sessions: {
          create: mocks.stripeCheckoutCreate,
          expire: mocks.stripeCheckoutExpire,
          list: mocks.stripeCheckoutList,
          retrieve: mocks.stripeCheckoutRetrieve,
        },
      },
      customers: { retrieve: mocks.stripeCustomerRetrieve },
      paymentIntents: {
        cancel: mocks.stripePaymentIntentCancel,
        confirm: mocks.stripePaymentIntentConfirm,
        create: mocks.stripePaymentIntentCreate,
        retrieve: mocks.stripePaymentIntentRetrieve,
      },
      paymentMethods: { list: mocks.stripePaymentMethodsList },
      prices: { retrieve: mocks.stripePriceRetrieve },
      subscriptions: { list: mocks.stripeSubscriptionsList },
    },
    stripeLiveMode: false,
  });
""",
          )
          replace_once(
              test_path,
              ''' + "'''  mocks.stripePaymentIntentCancel.mockReset();"

if script.count(old) != 1:
    raise SystemExit("Could not locate the hardening script's Stripe surface assertion.")
script = script.replace(old, second_surface)
exec(compile(script, "<harden-saved-card>", "exec"), {"__name__": "__main__"})
