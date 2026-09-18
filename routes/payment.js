const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Pass = require('../models/Pass');

const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Helper: build WhatsApp confirmation link
function buildWhatsappUrl(pass) {
  let cleanPhone = String(pass.phone).replace(/\D/g, '');
  if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  const text =
    `🪔 *Ganesh Chaturthi Laddu Prasad Pass Confirmation* 🪔\n\n` +
    `*Name:* ${pass.name}\n` +
    `*Pass No:* ${pass.passNo}\n` +
    `*Phone:* ${pass.phone}\n` +
    `*Amount Paid:* ₹20 (Confirmed)\n` +
    `*Payment ID:* ${pass.paymentId}\n\n` +
    `This pass entitles you to collect one Laddu Prasad at the Vinayak Chaturthi Pandal counter.\n\n` +
    `Blessings to you and your family! 🙏`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

// =====================================================
// POST /api/pass/create
// Creates a Razorpay order and saves a pending Pass
// =====================================================
router.post('/pass/create', async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'Name and phone required' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, error: 'Enter a valid 10-digit phone number' });
    }

    // Generate unique pass number
    const passNo = 'LADDU-' + Math.floor(100000 + Math.random() * 900000);

    // Create Razorpay order
    const options = {
      amount: 2000, // ₹20 in paise
      currency: 'INR',
      receipt: passNo,
      notes: {
        customerName: name,
        customerPhone: cleanPhone,
        description: 'Laddu Prasad Pass',
      },
    };

    const order = await razorpay.orders.create(options);

    // Save pending Pass to DB
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
// Verifies Razorpay signature and updates Pass to SUCCESS
// =====================================================
router.post('/pass/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, passNo } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !passNo) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      await Pass.findOneAndUpdate({ passNo }, { status: 'FAILED' });
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    // Signature is valid – update Pass
    const updatedPass = await Pass.findOneAndUpdate(
      { passNo },
      { status: 'SUCCESS', paymentId: razorpay_payment_id },
      { new: true }
    );

    if (!updatedPass) {
      return res.status(404).json({ success: false, message: 'Pass not found' });
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

module.exports = router;