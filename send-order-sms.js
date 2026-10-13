// Netlify Function: sends an order notification SMS to the shop owner.
// Keep all Exotel credentials in Netlify environment variables, never in index.html.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return response(405, { ok: false, message: 'Method not allowed' });
  }

  let order;
  try {
    order = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { ok: false, message: 'Invalid JSON' });
  }

  const name = clean(order.name, 70);
  const phone = clean(order.phone, 20);
  const address = clean(order.address, 180);
  const payment = clean(order.paymentMethod, 30);
  const orderId = clean(order.orderId, 30);
  const items = clean(order.items, 350);
  const total = clean(order.total, 30);

  if (!name || !phone || !address || !payment || !orderId || !items || !total) {
    return response(400, { ok: false, message: 'Missing required order details' });
  }

  const required = [
    'EXOTEL_API_KEY', 'EXOTEL_API_TOKEN', 'EXOTEL_ACCOUNT_SID',
    'EXOTEL_FROM', 'EXOTEL_DLT_ENTITY_ID', 'EXOTEL_DLT_TEMPLATE_ID'
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error('Missing environment variables:', missing.join(', '));
    return response(503, { ok: false, message: 'SMS service is not configured yet' });
  }

  // Register/approve a matching DLT template with your provider before sending.
  const body = `New order ${orderId}. Name: ${name}. Phone: ${phone}. Address: ${address}. Payment: ${payment}. Items: ${items}. Total: Rs ${total}. Check payment status before dispatch.`;
  const url = `https://api.exotel.com/v1/Accounts/${encodeURIComponent(process.env.EXOTEL_ACCOUNT_SID)}/Sms/send`;
  const form = new URLSearchParams({
    From: process.env.EXOTEL_FROM,
    To: '+918106393073',
    Body: body.slice(0, 1900),
    DltEntityId: process.env.EXOTEL_DLT_ENTITY_ID,
    DltTemplateId: process.env.EXOTEL_DLT_TEMPLATE_ID,
    SmsType: 'transactional',
    CustomField: orderId
  });

  const auth = Buffer.from(`${process.env.EXOTEL_API_KEY}:${process.env.EXOTEL_API_TOKEN}`).toString('base64');
  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
  } catch (error) {
    console.error('Exotel request failed:', error.message);
    return response(502, { ok: false, message: 'Could not contact SMS provider' });
  }

  const resultText = await providerResponse.text();
  if (!providerResponse.ok) {
    console.error('Exotel error:', providerResponse.status, resultText.slice(0, 500));
    return response(502, { ok: false, message: 'SMS provider rejected the request' });
  }

  // A successful API response means accepted/queued, not necessarily delivered.
  return response(200, { ok: true, message: 'SMS request accepted', providerStatus: 'queued' });
};

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, max);
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload)
  };
}
