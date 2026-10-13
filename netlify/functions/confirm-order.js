
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { ok: false, message: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    return reply(503, { ok: false, message: 'Backend configuration incomplete' });
  }

  const auth = event.headers.authorization || event.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return reply(401, { ok: false, message: 'Admin login required' });
  }

  const token = auth.slice(7);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return reply(401, { ok: false, message: 'Invalid admin session' });
  }

  const adminDb = createClient(url, serviceKey);

  const { data: admin, error: adminError } = await adminDb
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (adminError || !admin) {
    return reply(403, { ok: false, message: 'Not an authorized admin' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, { ok: false, message: 'Invalid JSON' });
  }

  const orderId = String(body.orderId || '').trim();
  if (!orderId) {
    return reply(400, { ok: false, message: 'Order ID is required' });
  }

  const { data: order, error: orderError } = await adminDb
    .from('orders')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  if (orderError || !order) {
    return reply(404, { ok: false, message: 'Order not found' });
  }

  if (order.status !== 'Pending') {
    return reply(409, { ok: false, message: 'Order is not pending' });
  }

  const { data: updated, error: updateError } = await adminDb
    .from('orders')
    .update({ status: 'Confirmed', confirmed_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('status', 'Pending')
    .select('*')
    .maybeSingle();

  if (updateError || !updated) {
    return reply(409, { ok: false, message: 'Order confirmation failed or already processed' });
  }

  // SMS is triggered only after the database confirms the status update.
  const smsUrl = process.env.URL
    ? `${process.env.URL}/.netlify/functions/send-order-sms`
    : '';

  if (!smsUrl) {
    return reply(200, {
      ok: true,
      status: 'Confirmed',
      sms: 'Not sent: Netlify site URL is not configured'
    });
  }

  try {
    const sms = await fetch(smsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-order-id': orderId
      },
      body: JSON.stringify({
        orderId: updated.order_id,
        name: updated.customer_name,
        phone: updated.customer_phone,
        address: updated.customer_address,
        paymentMethod: updated.payment_method,
        items: JSON.stringify(updated.items),
        total: String(updated.total)
      })
    });

    const smsResult = await sms.json().catch(() => ({}));

    await adminDb.from('orders').update({
      sms_status: sms.ok && smsResult.ok ? 'Queued' : 'Failed'
    }).eq('order_id', orderId);

    return reply(200, {
      ok: true,
      status: 'Confirmed',
      sms: sms.ok && smsResult.ok ? 'Queued' : 'Failed'
    });
  } catch {
    await adminDb.from('orders').update({
      sms_status: 'Failed'
    }).eq('order_id', orderId);

    return reply(200, {
      ok: true,
      status: 'Confirmed',
      sms: 'Failed'
    });
  }
};

function reply(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(data)
  };
}
