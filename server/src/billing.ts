import Stripe from "stripe";
import {
  findByStripeCustomer,
  patchUser,
  type SubStatus,
  type User,
} from "./auth.ts";

/**
 * Real Stripe subscriptions via hosted Checkout — no card data ever touches
 * this server (Stripe's page collects it), which keeps us out of PCI scope.
 *
 * Switches on when STRIPE_SECRET_KEY + STRIPE_PRICE_ID are set. Until then the
 * endpoints report themselves unavailable rather than pretending. The webhook
 * (STRIPE_WEBHOOK_SECRET) is what actually grants/revokes Pro — we never trust
 * the client's word that a payment happened.
 */

const SECRET = process.env.STRIPE_SECRET_KEY ?? "";
const PRICE_ID = process.env.STRIPE_PRICE_ID ?? ""; // monthly
const PRICE_ID_ANNUAL = process.env.STRIPE_PRICE_ID_ANNUAL ?? ""; // yearly (optional)
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const TRIAL_DAYS = 3; // free trial length

export type BillingPlan = "monthly" | "annual";

const stripe = SECRET ? new Stripe(SECRET) : null;

export function stripeConfigured(): boolean {
  return Boolean(stripe && PRICE_ID);
}

export class BillingError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BillingError";
    this.status = status;
  }
}

function client(): Stripe {
  if (!stripe || !PRICE_ID) {
    throw new BillingError("Billing isn't configured on this server.", 503);
  }
  return stripe;
}

/** Reuse the user's Stripe customer, or make one and remember its id. */
async function customerFor(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await client().customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id },
  });
  await patchUser(user.id, { stripeCustomerId: customer.id });
  return customer.id;
}

/** Hosted Checkout for the Pro subscription (with the free trial). */
export async function createCheckoutUrl(
  user: User,
  plan: BillingPlan = "monthly",
): Promise<string> {
  const stripeClient = client();
  const price = plan === "annual" ? PRICE_ID_ANNUAL : PRICE_ID;
  if (!price) {
    throw new BillingError(
      plan === "annual"
        ? "The annual plan isn't configured on this server."
        : "Billing isn't configured on this server.",
      503,
    );
  }
  const customer = await customerFor(user);
  const session = await stripeClient.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { trial_period_days: TRIAL_DAYS },
    client_reference_id: user.id,
    allow_promotion_codes: true,
    success_url: `${APP_URL}/app/pricing?upgrade=success`,
    cancel_url: `${APP_URL}/app/pricing?upgrade=cancelled`,
  });
  if (!session.url) throw new BillingError("Couldn't start checkout.", 502);
  return session.url;
}

/** Stripe Billing Portal, so Pro users can manage or cancel. */
export async function createPortalUrl(user: User): Promise<string> {
  if (!user.stripeCustomerId) {
    throw new BillingError("No subscription to manage yet.", 400);
  }
  const session = await client().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${APP_URL}/app/pricing`,
  });
  return session.url;
}

function mapStatus(status: Stripe.Subscription.Status): SubStatus {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "incomplete":
      return status;
    default:
      return "none";
  }
}

/**
 * Verify and apply a Stripe webhook. Subscription lifecycle events move the
 * user's plan; this is the only writer of billing state.
 */
export async function handleWebhook(
  rawBody: Buffer,
  signature: string | undefined,
): Promise<void> {
  if (!stripe || !WEBHOOK_SECRET) {
    throw new BillingError("Webhook not configured.", 503);
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", WEBHOOK_SECRET);
  } catch {
    throw new BillingError("Invalid webhook signature.", 400);
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const user = await findByStripeCustomer(customerId);
    if (user) {
      await patchUser(user.id, {
        subStatus:
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : mapStatus(sub.status),
        currentPeriodEnd: sub.current_period_end
          ? sub.current_period_end * 1000
          : undefined,
      });
    }
  }
}
