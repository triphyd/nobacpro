/**
 * Worker A – nobacpro-create-order
 * Creates Stripe Checkout session and saves order to KV.
 *
 * Bindings required (set in Cloudflare dashboard):
 *   KV:      NOBACPRO_ORDERS
 *   Secrets: STRIPE_SECRET_KEY
 *   Vars:    SUCCESS_URL, CANCEL_URL
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // tighten to 'https://detergenti-eco.ro' in production
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    // Validate basic structure
    const { cart, customer, total } = body;
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return jsonResponse({ error: 'Cart is empty' }, 400);
    }
    if (!customer || !customer.name || !customer.phone || !customer.email) {
      return jsonResponse({ error: 'Missing customer data' }, 400);
    }

    // Generate order ID
    const orderId = 'NB-' + new Date().getFullYear() + '-' + String(Math.floor(10000 + Math.random() * 90000));

    // Save initial order to KV (pending, TTL 30 days)
    const order = {
      orderId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      cart,
      total,
      customer,
      awb: null,
      courier: null,
      trackingUrl: null,
    };

    try {
      await env.NOBACPRO_ORDERS.put(
        `order:${orderId}`,
        JSON.stringify(order),
        { expirationTtl: 60 * 60 * 24 * 30 } // 30 days
      );
    } catch (err) {
      console.error('KV write error:', err);
      return jsonResponse({ error: 'Storage error' }, 500);
    }

    // Build Stripe line_items
    const lineItems = cart.map(item => ({
      price_data: {
        currency: 'ron',
        unit_amount: item.price, // already in bani (RON cents)
        product_data: {
          name: item.name,
        },
      },
      quantity: item.qty,
    }));

    // Create Stripe Checkout Session
    let session;
    try {
      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: buildStripeParams({
          mode: 'payment',
          locale: 'ro',
          customer_email: customer.email,
          success_url: `${env.SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: env.CANCEL_URL,
          // Metadata (max 500 chars per value)
          'metadata[orderId]': orderId,
          'metadata[customerName]': customer.name,
          'metadata[phone]': customer.phone,
          'metadata[customerEmail]': customer.email,
          'metadata[address]': customer.address,
          'metadata[addressExtra]': customer.addressExtra || '',
          'metadata[city]': customer.city,
          'metadata[county]': customer.county,
          'metadata[postalCode]': customer.postalCode,
          'metadata[notes]': customer.notes || '',
          // Line items
          ...flattenLineItems(lineItems),
          // Shipping
          'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
          'shipping_options[0][shipping_rate_data][fixed_amount][amount]': '0',
          'shipping_options[0][shipping_rate_data][fixed_amount][currency]': 'ron',
          'shipping_options[0][shipping_rate_data][display_name]': 'Livrare inclusă',
        }),
      });

      if (!stripeRes.ok) {
        const errData = await stripeRes.json();
        console.error('Stripe error:', errData);
        return jsonResponse({ error: errData.error?.message || 'Stripe error' }, 502);
      }

      session = await stripeRes.json();
    } catch (err) {
      console.error('Stripe fetch error:', err);
      return jsonResponse({ error: 'Payment provider unavailable' }, 502);
    }

    return jsonResponse({ checkoutUrl: session.url, orderId }, 200);
  },
};

/* ---- helpers ---- */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function buildStripeParams(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function flattenLineItems(items) {
  const out = {};
  items.forEach((item, i) => {
    out[`line_items[${i}][price_data][currency]`] = item.price_data.currency;
    out[`line_items[${i}][price_data][unit_amount]`] = item.price_data.unit_amount;
    out[`line_items[${i}][price_data][product_data][name]`] = item.price_data.product_data.name;
    out[`line_items[${i}][quantity]`] = item.quantity;
  });
  return out;
}
