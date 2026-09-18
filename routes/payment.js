const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Pass = require('../models/Pass');

const router = express.Router();

// --------------------------------------------------
// Razorpay init
// --------------------------------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --------------------------------------------------
// Helper: build WhatsApp confirmation link
// --------------------------------------------------
function buildWhatsappUrl(pass) {
  let cleanPhone = String(pass.phone).replace(/\D/g, '');
  if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  const text =
    `🪔 *Ganesh Chaturthi Laddu Prasad Booking Confirmation* 🪔\n\n` +
    `*Name:* ${pass.name}\n` +
    `*Booking No:* ${pass.passNo}\n` +
    `*Phone:* ${pass.phone}\n` +
    `*Amount Paid:* ₹20 (Confirmed)\n` +
    `*Payment ID:* ${pass.paymentId}\n\n` +
    `Please show this confirmation at the Vinayak Chaturthi Pandal counter to collect your Laddu Prasad.\n\n` +
    `Blessings to you and your family! 🙏`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

// =====================================================
// POST /api/pass/create
// =====================================================
router.post('/pass/create', async (req, res) => {
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

    const passNo = 'LADDU-' + Math.floor(100000 + Math.random() * 900000);

    const options = {
      amount: 2000, // ₹20 in paise
      currency: 'INR',
      receipt: passNo,
      notes: {
        customerName: name,
        customerPhone: cleanPhone,
        description: 'Laddu Prasad Booking',
      },
    };

    const order = await razorpay.orders.create(options);

    const newPass = new Pass({
      name,
      phone: cleanPhone,
      passNo,
      orderId: order.id,
      status: 'PENDING',
    });
    await newPass.save();

    return res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      passNo,
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
// POST /api/pass/verify
// =====================================================
router.post('/pass/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      passNo,
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !passNo
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
      await Pass.findOneAndUpdate({ passNo }, { status: 'FAILED' });
      return res
        .status(400)
        .json({ success: false, message: 'Invalid payment signature' });
    }

    const updatedPass = await Pass.findOneAndUpdate(
      { passNo },
      { status: 'SUCCESS', paymentId: razorpay_payment_id },
      { new: true }
    );

    if (!updatedPass) {
      return res
        .status(404)
        .json({ success: false, message: 'Pass not found' });
    }

    return res.json({
      success: true,
      whatsappUrl: buildWhatsappUrl(updatedPass),
      passDetails: updatedPass,
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
// ADMIN APIs (no key — same style as user APIs)
// =====================================================

// GET /api/admin/passes  → list all passes (optional ?status=SUCCESS)
router.get('/admin/passes', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status.toUpperCase();

    const passes = await Pass.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, count: passes.length, passes });
  } catch (err) {
    console.error('Admin passes error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/stats  → summary counts + amount
router.get('/admin/stats', async (req, res) => {
  try {
    const total = await Pass.countDocuments();
    const success = await Pass.countDocuments({ status: 'SUCCESS' });
    const pending = await Pass.countDocuments({ status: 'PENDING' });
    const failed = await Pass.countDocuments({ status: 'FAILED' });
    const totalAmount = success * 20;

    res.json({
      success: true,
      stats: { total, success, pending, failed, totalAmount },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/pass/:passNo  → single pass lookup
router.get('/admin/pass/:passNo', async (req, res) => {
  try {
    const pass = await Pass.findOne({ passNo: req.params.passNo }).lean();
    if (!pass) {
      return res
        .status(404)
        .json({ success: false, error: 'Pass not found' });
    }
    res.json({ success: true, pass });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/pass/:passNo  → delete a pass
router.delete('/admin/pass/:passNo', async (req, res) => {
  try {
    const deleted = await Pass.findOneAndDelete({
      passNo: req.params.passNo,
    });
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, error: 'Pass not found' });
    }
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;