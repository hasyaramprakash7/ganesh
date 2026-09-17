const mongoose = require('mongoose');

const TokenSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  tokenNo: { type: String, required: true, unique: true },
  orderId: { type: String, required: true },
  paymentId: { type: String, default: null },
  status: { type: String, default: 'PENDING' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Token', TokenSchema);