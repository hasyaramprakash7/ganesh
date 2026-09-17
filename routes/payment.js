const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Token = require('../models/Token');

const router = express.Router();

// Razorpay Instance Setup
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// =====================================================
// STEP 1 & 2: Generate Token and Razorpay Order
// =====================================================
router.post('/token/create', async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'Name and phone required' });
    }

    // Generate unique Token ID
    const tokenNo = 'GANESH-' + Math.floor(100000 + Math.random() * 900000);

    // Create ₹20 Order in Razorpay (Amount in Paise: 20 * 100 = 2000)
    const options = {
      amount: 2000,
      currency: 'INR',
      receipt: `receipt_${tokenNo}`,
    };
    const order = await razorpay.orders.create(options);

    // Save pending entry to DB
    const newToken = new Token({
      name,
      phone,
      tokenNo,
      orderId: order.id,
      status: 'PENDING'
    });
    await newToken.save();

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      tokenNo,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =====================================================
// STEP 5 & 6: Verify Payment Authenticity
// =====================================================
router.post('/payment/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      tokenNo
    } = req.body;

    // Cryptographic Signature Verification
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // Payment Verified! Update Database
      const updatedToken = await Token.findOneAndUpdate(
        { tokenNo },
        { status: 'SUCCESS', paymentId: razorpay_payment_id },
        { new: true }
      );

      if (!updatedToken) {
        return res.status(404).json({ success: false, message: 'Token not found' });
      }

      // Clean phone number format for WhatsApp (e.g., 919876543210)
      let cleanPhone = updatedToken.phone.replace(/\D/g, '');
      if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone;
      }

      // Generate WhatsApp Text
      const text =
        `🪔 *Ganesh Chaturthi Token Confirmation* 🪔\n\n` +
        `*Name:* ${updatedToken.name}\n` +
        `*Token No:* ${updatedToken.tokenNo}\n` +
        `*Phone:* ${updatedToken.phone}\n` +
        `*Payment Paid:* ₹20 (Confirmed)\n` +
        `*Payment ID:* ${updatedToken.paymentId}\n\n` +
        `Blessings to you and your family! 🙏`;

      const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;

      return res.json({
        success: true,
        whatsappUrl,
        tokenDetails: updatedToken
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid Payment Signature' });
    }
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;