/**
 * Worker B – nobacpro-webhook
 * Handles Stripe webhook: checkout.session.completed
 * - Updates KV order status
 * - Generates AWB via Colete Online API
 * - Sends Twilio SMS to uncle
 * - Sends Resend confirmation email to customer
 *
 * Bindings required (set in Cloudflare dashboard):
 *   KV:      NOBACPRO_ORDERS
 *   Secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY (for session retrieval),
 *            COLETE_CLIENT_ID, COLETE_CLIENT_SECRET,
 *            TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, RESEND_API_KEY
 *   Vars:    TWILIO_FROM, TWILIO_TO,
 *            COLETE_SENDER_NAME, COLETE_SENDER_PHONE, COLETE_SENDER_ADDRESS,
 *            COLETE_SENDER_CITY, COLETE_SENDER_COUNTY, COLETE_SENDER_POSTAL,
 *            FROM_EMAIL
 */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Read raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');

    // Verify Stripe webhook signature
    const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) {
      console.error('Invalid Stripe webhook signature');
      return new Response('Unauthorized', { status: 401 });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (event.type !== 'checkout.session.completed') {
      return new Response('OK', { status: 200 });
    }

    const session = event.data.object;
    const meta = session.metadata || {};

    const orderId = meta.orderId;
    if (!orderId) {
      console.error('No orderId in metadata');
      return new Response('OK', { status: 200 });
    }

    // Load order from KV
    let order;
    try {
      const raw = await env.NOBACPRO_ORDERS.get(`order:${orderId}`);
      order = raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error('KV read error:', err);
    }

    if (!order) {
      console.error('Order not found:', orderId);
      // Still attempt to notify uncle with metadata
      order = {
        orderId,
        cart: [],
        total: session.amount_total || 0,
        customer: {
          name: meta.customerName || '',
          phone: meta.phone || '',
          email: meta.customerEmail || '',
          address: meta.address || '',
          addressExtra: meta.addressExtra || '',
          city: meta.city || '',
          county: meta.county || '',
          postalCode: meta.postalCode || '',
          notes: meta.notes || '',
        },
      };
    }

    // Update order status to paid
    try {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      await env.NOBACPRO_ORDERS.put(`order:${orderId}`, JSON.stringify(order), {
        expirationTtl: 60 * 60 * 24 * 30,
      });
    } catch (err) {
      console.error('KV update error (paid):', err);
    }

    // Generate AWB via Colete Online
    let awbResult = null;
    try {
      awbResult = await generateAWB(env, order);
      if (awbResult) {
        order.awb = awbResult.awb;
        order.courier = awbResult.courier;
        order.trackingUrl = awbResult.trackingUrl;
        order.status = 'shipped';
        await env.NOBACPRO_ORDERS.put(`order:${orderId}`, JSON.stringify(order), {
          expirationTtl: 60 * 60 * 24 * 30,
        });
      }
    } catch (err) {
      console.error('AWB generation error:', err);
      awbResult = null;
    }

    // Send SMS to uncle
    try {
      await sendSmsToUncle(env, order, awbResult);
    } catch (err) {
      console.error('SMS error:', err);
    }

    // Send confirmation email to customer
    try {
      await sendConfirmationEmail(env, order, awbResult);
    } catch (err) {
      console.error('Email error:', err);
    }

    return new Response('OK', { status: 200 });
  },
};

/* ============================================================
   STRIPE SIGNATURE VERIFICATION (HMAC-SHA256)
   ============================================================ */
async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  try {
    // Parse timestamp and signatures from header
    // Format: "t=1234567890,v1=abc123,v1=def456"
    const parts = {};
    sigHeader.split(',').forEach(part => {
      const [k, v] = part.split('=');
      if (!parts[k]) parts[k] = [];
      parts[k].push(v);
    });

    const timestamp = parts['t']?.[0];
    const signatures = parts['v1'] || [];
    if (!timestamp || signatures.length === 0) return false;

    // Check timestamp tolerance (5 minutes)
    const tolerance = 300;
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > tolerance) {
      console.error('Stripe webhook timestamp too old');
      return false;
    }

    const signedPayload = `${timestamp}.${payload}`;

    const keyData = new TextEncoder().encode(secret);
    const msgData = new TextEncoder().encode(signedPayload);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );

    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const hexSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return signatures.some(s => timingSafeEqual(s, hexSig));
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* ============================================================
   COLETE ONLINE AWB GENERATION
   ============================================================ */
async function getColeteToken(env) {
  const TOKEN_KEY = 'colete_token';

  // Try cache
  try {
    const cached = await env.NOBACPRO_ORDERS.get(TOKEN_KEY, { type: 'json' });
    if (cached?.access_token) return cached.access_token;
  } catch (_) {}

  // Fetch new token
  const resp = await fetch('https://api.colete-online.ro/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.COLETE_CLIENT_ID,
      client_secret: env.COLETE_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Colete auth failed: ${resp.status} ${err}`);
  }

  const data = await resp.json();

  // Cache token with 7000s TTL
  await env.NOBACPRO_ORDERS.put(TOKEN_KEY, JSON.stringify(data), {
    expirationTtl: 7000,
  });

  return data.access_token;
}

async function generateAWB(env, order) {
  const token = await getColeteToken(env);
  const { customer } = order;

  const payload = {
    sender: {
      contact: {
        name: env.COLETE_SENDER_NAME,
        phone: env.COLETE_SENDER_PHONE,
      },
      address: {
        countryCode: 'RO',
        postalCode: env.COLETE_SENDER_POSTAL,
        city: env.COLETE_SENDER_CITY,
        county: env.COLETE_SENDER_COUNTY,
        street: env.COLETE_SENDER_ADDRESS,
      },
    },
    recipient: {
      contact: {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
      },
      address: {
        countryCode: 'RO',
        postalCode: customer.postalCode,
        city: customer.city,
        county: customer.county,
        street: customer.address,
        additionalInfo: customer.addressExtra || '',
      },
    },
    packages: {
      type: 'Box',
      content: 'Produse ecologice',
      items: [
        {
          weight: 0.5,
          height: 15,
          width: 20,
          length: 10,
        },
      ],
    },
    service: {
      selectionType: 'BestPrice',
    },
  };

  const resp = await fetch('https://api.colete-online.ro/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Colete order failed: ${resp.status} ${err}`);
  }

  const data = await resp.json();

  return {
    awb: data.awb || data.id,
    courier: data.courier || 'N/A',
    trackingUrl: data.trackingUrl || '',
  };
}

/* ============================================================
   TWILIO SMS TO UNCLE
   ============================================================ */
async function sendSmsToUncle(env, order, awbResult) {
  const { customer, cart, total, orderId } = order;

  const productLines = (cart || [])
    .map(i => `  ${i.qty} x ${i.name} = ${formatPrice(i.price * i.qty)}`)
    .join('\n');

  const awbLine = awbResult
    ? `AWB: ${awbResult.awb} (${awbResult.courier})`
    : 'AWB negenerat – generează manual';

  const msg = [
    `Comandă nouă ${orderId}`,
    productLines,
    `Total: ${formatPrice(total)}`,
    `Client: ${customer.name}, ${customer.phone}`,
    `Adresă: ${customer.address}${customer.addressExtra ? ', ' + customer.addressExtra : ''}, ${customer.city}, ${customer.county}, CP ${customer.postalCode}`,
    awbLine,
  ].join('\n');

  const authHeader = 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: env.TWILIO_FROM,
        To: env.TWILIO_TO,
        Body: msg,
      }).toString(),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Twilio error: ${resp.status} ${err}`);
  }
}

/* ============================================================
   RESEND EMAIL TO CUSTOMER
   ============================================================ */
async function sendConfirmationEmail(env, order, awbResult) {
  const { customer, cart, total, orderId } = order;

  const productRows = (cart || [])
    .map(
      i => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;color:#1A1A2E;">${escHtml(i.name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;text-align:center;color:#6B7280;">×${i.qty}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;text-align:right;color:#1A1A2E;font-weight:600;">${formatPrice(i.price * i.qty)}</td>
      </tr>`
    )
    .join('');

  const trackingSection = awbResult
    ? `<p style="margin:0 0 12px;">Număr AWB: <strong>${escHtml(awbResult.awb)}</strong> (${escHtml(awbResult.courier)})</p>
       ${awbResult.trackingUrl ? `<p style="margin:0 0 12px;">Urmărești coletul pe: <a href="${escHtml(awbResult.trackingUrl)}" style="color:#1A56DB;">${escHtml(awbResult.trackingUrl)}</a></p>` : ''}`
    : `<p style="margin:0 0 12px;">AWB-ul va fi generat în curând și vei fi notificat prin SMS.</p>`;

  const html = `<!DOCTYPE html>
<html lang="ro">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Confirmare comandă ${orderId}</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Inter,Arial,sans-serif;font-size:15px;color:#6B7280;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#1A56DB;padding:28px 40px;text-align:center;">
          <span style="font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.5px;">nobacpro</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <h1 style="margin:0 0 8px;font-size:22px;color:#1A1A2E;">Comanda ta a fost plasată cu succes!</h1>
          <p style="margin:0 0 24px;color:#6B7280;">Număr comandă: <strong style="color:#1A56DB;">${escHtml(orderId)}</strong></p>

          <!-- Products -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <thead>
              <tr>
                <th style="text-align:left;font-size:13px;color:#6B7280;font-weight:600;padding-bottom:8px;border-bottom:2px solid #F3F4F6;">Produs</th>
                <th style="text-align:center;font-size:13px;color:#6B7280;font-weight:600;padding-bottom:8px;border-bottom:2px solid #F3F4F6;">Cant.</th>
                <th style="text-align:right;font-size:13px;color:#6B7280;font-weight:600;padding-bottom:8px;border-bottom:2px solid #F3F4F6;">Preț</th>
              </tr>
            </thead>
            <tbody>${productRows}</tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding:12px 0 0;font-weight:700;color:#1A1A2E;font-size:16px;">Total</td>
                <td style="padding:12px 0 0;text-align:right;font-weight:700;color:#1A56DB;font-size:16px;">${formatPrice(total)}</td>
              </tr>
            </tfoot>
          </table>

          <!-- Delivery info -->
          <div style="background:#EBF3FF;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
            <h2 style="margin:0 0 12px;font-size:16px;color:#1A1A2E;">Informații livrare</h2>
            <p style="margin:0 0 6px;">Comanda ta va fi expediată în <strong>1–2 zile lucrătoare</strong>.</p>
            ${trackingSection}
            <p style="margin:0;font-size:13px;color:#6B7280;">Adresă: ${escHtml(customer.address)}${customer.addressExtra ? ', ' + escHtml(customer.addressExtra) : ''}, ${escHtml(customer.city)}, ${escHtml(customer.county)}</p>
          </div>

          <!-- Return policy -->
          <p style="font-size:13px;color:#6B7280;margin:0 0 8px;">Politică retur: poți returna produsele neutilizate în 14 zile conform OG 34/2014.</p>
          <p style="font-size:13px;color:#6B7280;margin:0;">Întrebări? Scrie-ne la <a href="mailto:contact@detergenti-eco.ro" style="color:#1A56DB;">contact@detergenti-eco.ro</a></p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#F3F4F6;padding:20px 40px;text-align:center;font-size:12px;color:#9CA3AF;">
          © 2026 detergenti-eco.ro · Toate drepturile rezervate<br>
          <a href="https://detergenti-eco.ro/confidentialitate.html" style="color:#9CA3AF;">Politică confidențialitate</a> ·
          <a href="https://detergenti-eco.ro/termeni.html" style="color:#9CA3AF;">Termeni și condiții</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [customer.email],
      subject: `Comanda ta #${orderId} a fost plasată cu succes`,
      html,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend error: ${resp.status} ${err}`);
  }
}

/* ---- helpers ---- */
function formatPrice(bani) {
  return (bani / 100).toFixed(2).replace('.', ',') + ' Lei';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
