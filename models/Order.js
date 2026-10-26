const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  orderNo: { type: String, required: true, unique: true },
  razorpayOrderId: { type: String, required: true },
  paymentId: { type: String },
  projectId: { type: String, required: true },
  projectName: { type: String, required: true },
  githubLink: { type: String, required: true },
  amount: { type: Number, default: 1 },
  status: { type: String, default: 'PENDING' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);