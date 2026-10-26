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

// =====================================================
// PROJECT CONFIGURATION
// 🔴 CHANGE THESE GITHUB LINKS TO YOUR ACTUAL REPOSITORIES
// =====================================================
const PROJECTS = {
  'ai-chat': { 
    name: 'Full Stack AI Chatbot', 
    github: 'https://github.com/yourname/ai-chatbot' 
  },
  'data-viz': { 
    name: 'Data Science Dashboard', 
    github: 'https://github.com/yourname/data-dashboard' 
  },
  'gen-ai': { 
    name: 'Generative AI Image App', 
    github: 'https://github.com/yourname/gen-ai-app' 
  },
  'java-spring': { 
    name: 'Java Spring Boot AI API', 
    github: 'https://github.com/yourname/java-ai-api' 
  },
  'auto-agent': { 
    name: 'Autonomous AI Agent', 
    github: 'https://github.com/yourname/auto-agent' 
  }
};

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
// Creates a Razorpay order for the selected AI Project
// =====================================================
router.post('/order/create', async (req, res) => {
  try {
    const { name, phone, projectId } = req.body;

    if (!name || !phone || !projectId) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, phone, and projectId required' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return res
        .status(400)
        .json({ success: false, error: 'Enter a valid 10-digit phone number' });
    }

    const project = PROJECTS[projectId];
    if (!project) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid project selected' });
    }

    const orderNo = 'PRJ-' + Math.floor(100000 + Math.random() * 900000);

    const options = {
      amount: 100, // ₹1 in paise
      currency: 'INR',
      receipt: orderNo,
      notes: {
        projectId,
        projectName: project.name,
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
      projectId: projectId,
      projectName: project.name,
      githubLink: project.github, // Stored securely in DB, only sent after payment
      amount: 1,
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
// Called by frontend after Razorpay checkout success.
// Returns the GitHub link ONLY if payment is verified.
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

    // Success! Send back the specific GitHub link
    return res.json({
      success: true,
      projectName: updatedOrder.projectName,
      githubLink: updatedOrder.githubLink,
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
// =====================================================
router.post('/razorpay', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      return res.status(400).send('Missing signature');
    }

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
    
    // Calculate total revenue (₹1 per successful order)
    const totalAmount = success * 1; 

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