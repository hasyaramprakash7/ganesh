require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const paymentRoutes = require('./routes/payment');

const app = express();

// Middleware
app.use(cors({
  origin: [
    'https://ganesh-frontend-1.onrender.com',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Backend running ✅' });
});

// Routes
app.use('/api', paymentRoutes);

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.error('❌ MongoDB Error:', err));

// Start Server — bind to 0.0.0.0 so Render can detect the port
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});