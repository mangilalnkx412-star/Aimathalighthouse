
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
      `${url}/rest/v1/products?select=id,name,price&or=(${encodeURIComponent(query)})`,
      { headers }
    );

    if (!productResponse.ok) {
      return reply(502, { ok: false, message: 'Could not verify products' });
    }

    const products = await productResponse.json();

    if (products.length !== ids.length) {
      return reply(400, { ok: false, message: 'A product is unavailable' });
    }

    const productMap = new Map(products.map(p => [Number(p.id), p]));
    const savedItems = [];
    let total = 0;

    for (const [id, quantity] of quantities) {
      const product = productMap.get(id);
      if (!product) {
        return reply(400, { ok: false, message: 'Product not found' });
      }

      const price = Number(product.price);
      total += price * quantity;

      savedItems.push({
        productId: id,
        name: product.name,
        price,
        quantity
      });
    }

    // Delivery charge: ₹50 below ₹5,000; free at ₹5,000 or above.
    const delivery = total >= 5000 ? 0 : 50;
    total += delivery;

    const orderId = `ORD-${randomUUID().slice(0, 8).toUpperCase()}`;

    const order = {
      order_id: orderId,
      customer_name: name,
      customer_phone: phone,
      customer_address: address,
      payment_method: payment,
      items: savedItems,
      total,
      status: 'Pending',
      sms_status: 'Not sent'
    };

    const saveResponse = await fetch(`${url}/rest/v1/orders`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(order)
    });

    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();
      console.error('Order save failed:', errorText.slice(0, 300));
      return reply(500, { ok: false, message: 'Could not save order' });
    }

    return reply(201, {
      ok: true,
      orderId,
      status: 'Pending',
      total,
      deliveryCharge: delivery,
      message: 'Order received and is awaiting confirmation'
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
