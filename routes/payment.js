const express = require('express');
const { Cashfree, CFEnvironment } = require('cashfree-pg');
const Token = require('../models/Token');

const router = express.Router();

// =====================================================
// Cashfree Instance Setup
// =====================================================
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment =
  process.env.CASHFREE_ENV === 'production'
    ? CFEnvironment.PRODUCTION
    : CFEnvironment.SANDBOX;

const CF_API_VERSION = '2023-08-01';
const FRONTEND_URL =
  process.env.FRONTEND_URL || 'https://ganesh-frontend-1.onrender.com';

// =====================================================
// Helper: build the WhatsApp confirmation link
// =====================================================
function buildWhatsappUrl(token) {
  let cleanPhone = String(token.phone).replace(/\D/g, '');
  if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  const text =
    `🪔 *Ganesh Chaturthi Token Confirmation* 🪔\n\n` +
    `*Name:* ${token.name}\n` +
    `*Token No:* ${token.tokenNo}\n` +
    `*Phone:* ${token.phone}\n` +
    `*Payment Paid:* ₹20 (Confirmed)\n` +
    `*Payment ID:* ${token.paymentId}\n\n` +
    `Blessings to you and your family! 🙏`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

// =====================================================
// STEP 1 & 2: Generate Token + Create Cashfree Order
// =====================================================
router.post('/token/create', async (req, res) => {
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

    // Unique token number
    const tokenNo = 'GANESH-' + Math.floor(100000 + Math.random() * 900000);

    // Unique Cashfree order id (max 50 chars, alphanumeric + - _ )
    const orderId = `${tokenNo}-${Date.now()}`;

    const request = {
      order_amount: 20.0, // ⚠️ Cashfree uses RUPEES, not paise
      order_currency: 'INR',
      order_id: orderId,
      customer_details: {
        customer_id: `cust_${cleanPhone}_${Date.now()}`,
        customer_name: name,
        customer_phone: cleanPhone,
      },
      order_meta: {
        return_url: `${FRONTEND_URL}/?order_id={order_id}`,
      },
      order_note: 'Ganesh Chaturthi Token Fee ₹20',
    };

    const response = await Cashfree.PGCreateOrder(CF_API_VERSION, request);
    const orderData = response.data;

    // Save pending entry to DB
    const newToken = new Token({
      name,
      phone: cleanPhone,
      tokenNo,
      orderId: orderData.order_id,
      status: 'PENDING',
    });
    await newToken.save();

    return res.json({
      success: true,
      orderId: orderData.order_id,
      paymentSessionId: orderData.payment_session_id,
      amount: 20,
      tokenNo,
      appId: process.env.CASHFREE_APP_ID,
      mode: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox',
    });
  } catch (err) {
    console.error(
      'Order creation error:',
      err?.response?.data || err.message || err
    );
    return res.status(500).json({
      success: false,
      error:
        err?.response?.data?.message || err.message || 'Order creation failed',
    });
  }
});

// =====================================================
// STEP 5 & 6: Verify Payment Authenticity
// (Server-side fetch of the order status from Cashfree)
// =====================================================
router.post('/payment/verify', async (req, res) => {
  try {
    const { orderId, tokenNo } = req.body;

    if (!orderId || !tokenNo) {
      return res
        .status(400)
        .json({ success: false, message: 'orderId and tokenNo required' });
    }

    // Fetch live order status from Cashfree
    const response = await Cashfree.PGFetchOrder(CF_API_VERSION, orderId);
    const order = response.data;
    const status = String(order.order_status || '').toUpperCase();

    // ---------- PAID ----------
    if (status === 'PAID') {
      // Try to get the real Cashfree payment id
      let paymentId = String(order.cf_order_id || orderId);
      try {
        const payRes = await Cashfree.PGOrderFetchPayments(
          CF_API_VERSION,
          orderId
        );
        const payments = Array.isArray(payRes.data) ? payRes.data : [];
        const successPayment = payments.find(
          (p) => String(p.payment_status || '').toUpperCase() === 'SUCCESS'
        );
        if (successPayment && successPayment.cf_payment_id) {
          paymentId = String(successPayment.cf_payment_id);
        }
      } catch (payErr) {
        console.warn(
          'Could not fetch payment list, using order id:',
          payErr?.response?.data || payErr.message
        );
      }

      const updatedToken = await Token.findOneAndUpdate(
        { tokenNo },
        { status: 'SUCCESS', paymentId },
        { new: true }
      );

      if (!updatedToken) {
        return res
          .status(404)
          .json({ success: false, message: 'Token not found' });
      }

      return res.json({
        success: true,
        whatsappUrl: buildWhatsappUrl(updatedToken),
        tokenDetails: updatedToken,
      });
    }

    // ---------- STILL PENDING ----------
    if (status === 'ACTIVE') {
      return res.status(202).json({
        success: false,
        pending: true,
        message: 'Payment not completed yet',
      });
    }

    // ---------- FAILED / EXPIRED / TERMINATED ----------
    await Token.findOneAndUpdate({ tokenNo }, { status: 'FAILED' });

    return res.status(400).json({
      success: false,
      pending: false,
      message: `Payment ${status.toLowerCase() || 'failed'}`,
    });
  } catch (err) {
    console.error(
      'Verification error:',
      err?.response?.data || err.message || err
    );
    return res.status(500).json({
      success: false,
      error:
        err?.response?.data?.message || err.message || 'Verification failed',
    });
  }
});

module.exports = router;