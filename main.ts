import { Stripe } from "stripe";

type Env = {
  STRIPE_WEBHOOK_SIGNING_SECRET: string;
  STRIPE_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_PAYMENT_LINK_ID: string;
};

const streamToBuffer = async (
  readableStream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  const reader = readableStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Calculate the total length
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);

  // Create a new Uint8Array with the total length
  const result = new Uint8Array(totalLength);

  // Copy each chunk into the result array
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }

  return result;
};

/**
 * This is where payment updates come in
 *
 * Set your stripe webhook to:
 *
 * `https://domain.com/stripe-webhook`
 *
 */
export default {
  fetch: async (request: Request, env: Env) => {
    const url = new URL(request.url);
    if (url.pathname !== "/stripe-webhook") {
      return new Response("Not a stripe webhook", { status: 404 });
    }

    if (!request.body) {
      return new Response(
        JSON.stringify({ isSuccessful: false, message: "No body" }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const rawBody = await streamToBuffer(request.body);
    // Convert Uint8Array to string using TextDecoder
    const rawBodyString = new TextDecoder().decode(rawBody);

    // console.log({ rawBody, rawBodyString });
    const stripeWebhookSigningSecret = env.STRIPE_WEBHOOK_SIGNING_SECRET;
    const stripeSecret = env.STRIPE_SECRET;
    const stripePublishableKey = env.STRIPE_PUBLISHABLE_KEY;
    const paymentLinkId = env.STRIPE_PAYMENT_LINK_ID;

    if (
      !stripeWebhookSigningSecret ||
      !stripeSecret ||
      !stripePublishableKey ||
      !paymentLinkId
    ) {
      console.log("NO STRIPE CREDENTIALS", {
        stripePublishableKey,
        stripeSecret,
        stripeWebhookSigningSecret,
      });
      return new Response(
        JSON.stringify({ isSuccessful: false, message: "No stripe creds" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeSecret, {
      apiVersion: "2025-03-31.basil",
    });

    const stripeSignature = request.headers.get("stripe-signature");

    if (!stripeSignature) {
      console.log("NO stripe signature");
      return new Response(
        JSON.stringify({ isSuccessful: false, message: "No signature" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    let event: Stripe.Event | undefined = undefined;

    const isDebugInput = false;

    if (isDebugInput) {
      console.log("Received a webhook with data:", {
        rawBodyString,
        stripeSignature,
        stripeWebhookSigningSecret,
      });
    }

    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBodyString,
        stripeSignature,
        stripeWebhookSigningSecret,
      );
    } catch (err) {
      console.warn(`Error web hook`, err);

      return new Response(`webhook error ${String(err)}`, { status: 400 });
    }

    if (event.type === "checkout.session.completed") {
      const {
        payment_status,
        mode,
        amount_total,
        payment_link,
        customer_details,
        currency,
        // the reference to the client provided through ?client_reference_id
        client_reference_id,
      } = event.data.object;

      if (payment_link !== env.STRIPE_PAYMENT_LINK_ID) {
        // You can remove this if you don't want to check it
        return new Response("No payment link found", { status: 400 });
      }

      if (payment_status !== "paid" || !amount_total) {
        return new Response("Payment not paid yet", { status: 400 });
      }

      if (!customer_details) {
        return new Response("No customer details provided", { status: 400 });
      }

      if (mode === "subscription" || mode === "setup") {
        return new Response("Not supported yet", { status: 400 });
      }

      if (amount_total < 50) {
        // NB: Could also check currency here
        return new Response("Paid less than $0.50", { status: 400 });
      }

      const { email, name } = customer_details;

      console.log(
        event.data.object,
        `Not implemented yet, but ${name} <${email}> paid ${amount_total} cents`,
      );

      // Do something here in your KV or DO or whatever, or even just sent an email..
      return new Response(
        `Not implemented yet, but ${name} <${email}> paid ${amount_total} cents`,
      );
    }

    // subscription type events
    if (
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.paused"
    ) {
      const subscription = event.data.object;

      const shouldRemoveSubscription =
        subscription.status === "unpaid" || subscription.status === "canceled";

      if (!shouldRemoveSubscription) {
        return new Response("OK. No action required");
      }

      // Do something here to handle the subscription cancellation
      return new Response("Deleted, cancelled, or paused", {
        headers: { "Content-Type": "application/json" },
      });
    }
    // Not interested in all other events...
    if (isDebugInput) {
      console.log("UNHANLDED EVENT", event.type);
    }

    return new Response(
      JSON.stringify({ isSuccessful: false, message: "Invalid event" }),
      { status: 404 },
    );
  },
};
