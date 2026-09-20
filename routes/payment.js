const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/Order');

const router = express.Router();

// --------------------------------------------------
// Razorpay init
// --------------------------------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --------------------------------------------------
// Helper: build WhatsApp order confirmation link
// --------------------------------------------------
function buildWhatsappUrl(order) {
  let cleanPhone = String(order.phone).replace(/\D/g, '');
  if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  const text =
    `🛒 *Laddu – Order Confirmation* 🛒\n\n` +
    `*Customer Name:* ${order.name}\n` +
    `*Order ID:* ${order.orderNo}\n` +
    `*Phone:* ${order.phone}\n` +
    `*Amount Paid:* ₹21 (Confirmed)\n` +
    `*Payment ID:* ${order.paymentId}\n\n` +
    `Please show this Order Receipt at our pickup counter to collect your Laddu.\n\n` +
    `Thank you for your order!`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

// =====================================================
// DIAGNOSTIC — list all routes registered on this router
// GET /api/_routes
// =====================================================
router.get('/_routes', (req, res) => {
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      method: Object.keys(layer.route.methods)[0].toUpperCase(),
      path: '/api' + layer.route.path,
    }));
  res.json({ success: true, count: routes.length, routes });
});

// =====================================================
// POST /api/order/create
// Creates a Razorpay order for the food product
// =====================================================
router.post('/order/create', async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res
        .status(400)
        .json({ success: false, error: 'Name and phone required' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return res
        .status(400)
        .json({ success: false, error: 'Enter a valid 10-digit phone number' });
    }

    const orderNo = 'LD-' + Math.floor(100000 + Math.random() * 900000);

    const options = {
      amount: 2100, // ₹21 in paise
      currency: 'INR',
      receipt: orderNo,
      notes: {
        product: 'Laddu',
        category: 'Food & Beverage',
        order_ref: orderNo,
        pickup: 'Counter Pickup',
        customer_name: name,
        customer_phone: cleanPhone,
      },
    };

    const razorpayOrder = await razorpay.orders.create(options);

    const newOrder = new Order({
      name,
      phone: cleanPhone,
      orderNo,
      razorpayOrderId: razorpayOrder.id,
      status: 'PENDING',
    });
    await newOrder.save();

    return res.json({
      success: true,
      order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      orderNo,
    });
  } catch (err) {
    console.error('Order creation error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Order creation failed',
    });
  }
});

// =====================================================
// POST /api/order/verify
// Called by frontend after Razorpay checkout success
// =====================================================
router.post('/order/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderNo,
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !orderNo
    ) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing required parameters' });
    }

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      await Order.findOneAndUpdate({ orderNo }, { status: 'FAILED' });
      return res
        .status(400)
        .json({ success: false, message: 'Invalid payment signature' });
    }

    const updatedOrder = await Order.findOneAndUpdate(
      { orderNo },
      { status: 'SUCCESS', paymentId: razorpay_payment_id },
      { new: true }
    );

    if (!updatedOrder) {
      return res
        .status(404)
        .json({ success: false, message: 'Order not found' });
    }

    return res.json({
      success: true,
      whatsappUrl: buildWhatsappUrl(updatedOrder),
      orderDetails: updatedOrder,
    });
  } catch (err) {
    console.error('Verification error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Verification failed',
    });
  }
});

// =====================================================
// POST /api/webhook/razorpay
// Razorpay server → your server. Works even if the
// browser died before /order/verify was called.
// NOTE: mounted in server.js with express.raw() so
// req.body is a Buffer.
// =====================================================
router.post('/razorpay', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).send('Missing signature');
    }

    // req.body is a raw Buffer here (see server.js mount)
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body));

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (signature !== expected) {
      console.warn('⚠️ Webhook signature mismatch');
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(rawBody.toString());
    console.log('🔔 Razorpay webhook:', event.event);

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const payment = event.payload.payment.entity;
      const rzpOrderId = payment.order_id;
      const paymentId = payment.id;

      const updated = await Order.findOneAndUpdate(
        { razorpayOrderId: rzpOrderId },
        { status: 'SUCCESS', paymentId },
        { new: true }
      );
      console.log(
        updated
          ? `✅ Webhook: Order ${updated.orderNo} → SUCCESS`
          : `⚠️ Webhook: No order found for ${rzpOrderId}`
      );
    }

    if (event.event === 'payment.failed') {
      const payment = event.payload.payment.entity;
      await Order.findOneAndUpdate(
        { razorpayOrderId: payment.order_id, status: 'PENDING' },
        { status: 'FAILED' }
      );
      console.log(`❌ Webhook: Order for ${payment.order_id} → FAILED`);
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ADMIN ENDPOINTS
// =====================================================

// GET /api/admin/orders?status=SUCCESS
router.get('/admin/orders', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status.toUpperCase();

    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error('Admin orders error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/stats
router.get('/admin/stats', async (req, res) => {
  try {
    const total = await Order.countDocuments();
    const success = await Order.countDocuments({ status: 'SUCCESS' });
    const pending = await Order.countDocuments({ status: 'PENDING' });
    const failed = await Order.countDocuments({ status: 'FAILED' });
    const totalAmount = success * 21;

    res.json({
      success: true,
      stats: { total, success, pending, failed, totalAmount },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/sync-pending
// Asks Razorpay for each PENDING order's real status
// and flips it to SUCCESS if it was actually captured.
router.get('/admin/sync-pending', async (req, res) => {
  try {
    const pending = await Order.find({ status: 'PENDING' });
    let fixed = 0;
    const details = [];

    for (const o of pending) {
      try {
        const payments = await razorpay.orders.fetchPayments(
          o.razorpayOrderId
        );
        const paid = (payments.items || []).find(
          (p) => p.status === 'captured'
        );
        if (paid) {
          o.status = 'SUCCESS';
          o.paymentId = paid.id;
          await o.save();
          fixed++;
          details.push({ orderNo: o.orderNo, paymentId: paid.id });
        }
      } catch (e) {
        console.warn('sync fail for', o.orderNo, e.message);
      }
    }

    res.json({
      success: true,
      checked: pending.length,
      fixed,
      details,
    });
  } catch (err) {
    console.error('Sync pending error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/order/:orderNo
router.get('/admin/order/:orderNo', async (req, res) => {
  try {
    const order = await Order.findOne({ orderNo: req.params.orderNo }).lean();
    if (!order) {
      return res
        .status(404)
        .json({ success: false, error: 'Order not found' });
    }
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/order/:orderNo
router.delete('/admin/order/:orderNo', async (req, res) => {
  try {
    const deleted = await Order.findOneAndDelete({
      orderNo: req.params.orderNo,
    });
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, error: 'Order not found' });
    }
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;