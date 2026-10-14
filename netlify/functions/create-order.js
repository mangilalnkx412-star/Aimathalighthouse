const { randomUUID } = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { ok: false, message: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return reply(503, { ok: false, message: 'Order service is not configured' });
  }

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, { ok: false, message: 'Invalid JSON' });
  }

  const name = clean(input.name, 70);
  const phone = clean(input.phone, 20);
  const address = clean(input.address, 180);
  const payment = input.paymentMethod;
  const rawItems = input.items;

  if (!name || !/^[0-9+\-\s()]{10,20}$/.test(phone) ||
      !address || !['COD', 'ONLINE'].includes(payment)) {
    return reply(400, { ok: false, message: 'Check customer and payment details' });
  }
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 50) {
    return reply(400, { ok: false, message: 'Invalid order items' });
  }

  const quantities = new Map();
  for (const item of rawItems) {
    const id = Number(item.productId);
    const qty = Number(item.quantity);
    if (!Number.isSafeInteger(id) || id <= 0 ||
        !Number.isSafeInteger(qty) || qty < 1 || qty > 100) {
      return reply(400, { ok: false, message: 'Invalid product or quantity' });
    }
    quantities.set(id, (quantities.get(id) || 0) + qty);
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };

  try {
    const ids = [...quantities.keys()];
    const query = ids.map(id => `id.eq.${id}`).join(',');
    const productResponse = await fetch(
      `${url}/rest/v1/products?select=id,name,price,image_url&or=(${encodeURIComponent(query)})`,
      { headers }
    );
    if (!productResponse.ok) {
      console.error('Product lookup failed:', (await productResponse.text()).slice(0, 300));
      return reply(502, { ok: false, message: 'Could not verify products' });
    }

    const products = await productResponse.json();
    if (products.length !== ids.length) {
      return reply(400, { ok: false, message: 'A product is unavailable' });
    }

    const productMap = new Map(products.map(p => [Number(p.id), p]));
    const savedItems = [];
    let subtotal = 0;

    for (const [id, quantity] of quantities) {
      const product = productMap.get(id);
      if (!product) return reply(400, { ok: false, message: 'Product not found' });
      const price = Number(product.price);
      if (!Number.isFinite(price) || price < 0) {
        return reply(502, { ok: false, message: 'Invalid product price' });
      }
      subtotal += price * quantity;
      savedItems.push({
        productId: id,
        name: clean(product.name, 120),
        price,
        quantity,
        image_url: isHttpsUrl(product.image_url) ? product.image_url : null
      });
    }

    // Delivery: ₹50 below ₹5,000; free at ₹5,000 or above.
    const delivery = subtotal >= 5000 ? 0 : 50;
    const total = subtotal + delivery;
    const orderId = `ORD-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Automatically mark the order Confirmed, as requested.
    // For ONLINE payments, this means the order is accepted, NOT that payment is verified.
    const order = {
      order_id: orderId,
      customer_name: name,
      customer_phone: phone,
      customer_address: address,
      payment_method: payment,
      items: savedItems,
      total,
      status: 'Confirmed',
      sms_status: 'Not sent'
    };

    const saveResponse = await fetch(`${url}/rest/v1/orders`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(order)
    });
    if (!saveResponse.ok) {
      console.error('Order save failed:', (await saveResponse.text()).slice(0, 300));
      return reply(500, { ok: false, message: 'Could not save order' });
    }

    // WhatsApp is optional until the Meta Cloud API credentials and approved template
    // are configured as Netlify environment variables. A notification failure never
    // deletes or reverses the saved order.
    let whatsapp = { sent: false, reason: 'WhatsApp is not configured' };
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_TO && process.env.WHATSAPP_TEMPLATE_NAME) {
      try {
        const firstImage = savedItems.find(item => item.image_url)?.image_url;
        const bodyText = [
          orderId,
          name,
          phone,
          savedItems.map(item => `${item.name} x${item.quantity} @ ₹${item.price}`).join(', ').slice(0, 900),
          `₹${total} (delivery ₹${delivery})`,
          address
        ];
        const components = [];
        if (firstImage) {
          components.push({
            type: 'header',
            parameters: [{ type: 'image', image: { link: firstImage } }]
          });
        }
        components.push({
          type: 'body',
          parameters: bodyText.map(text => ({ type: 'text', text: String(text).slice(0, 1024) }))
        });

        const waResponse = await fetch(
          `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v23.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: process.env.WHATSAPP_TO.replace(/\D/g, ''),
              type: 'template',
              template: {
                name: process.env.WHATSAPP_TEMPLATE_NAME,
                language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' },
                components
              }
            })
          }
        );
        const waData = await waResponse.json().catch(() => ({}));
        if (!waResponse.ok) {
          console.error('WhatsApp send failed:', JSON.stringify(waData).slice(0, 500));
          whatsapp = { sent: false, reason: 'WhatsApp provider rejected the message; check template configuration' };
        } else {
          whatsapp = { sent: true };
        }
      } catch (err) {
        console.error('WhatsApp send error:', err.message);
        whatsapp = { sent: false, reason: 'WhatsApp notification failed; order was saved' };
      }
    }

    return reply(201, {
      ok: true,
      orderId,
      status: 'Confirmed',
      total,
      deliveryCharge: delivery,
      whatsapp,
      message: whatsapp.sent
        ? 'Order confirmed and WhatsApp notification sent'
        : 'Order confirmed and saved; WhatsApp notification is not yet configured or could not be sent'
    });
  } catch (error) {
    console.error('Create order failed:', error.message);
    return reply(500, { ok: false, message: 'Order service temporarily unavailable' });
  }
};

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\r\n<>]/g, ' ')
    .trim()
    .slice(0, max);
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

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

