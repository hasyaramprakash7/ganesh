require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const paymentRoutes = require('./routes/payment');

const app = express();

app.use(
  cors({
    origin: [
      'https://list-ganesh.onrender.com/',
      'https://laddu-6i69.onrender.com',
      'http://localhost:3000',
      'http://localhost:5173',
    ],
    credentials: true,
  })
);
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'Backend running ✅' });
});

app.use('/api', paymentRoutes);

app.use((req, res) => {
  console.log('❌ 404 —', req.method, req.originalUrl);
  res.status(404).json({
    success: false,
    error: 'Route not found',
    method: req.method,
    url: req.originalUrl,
  });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.error('❌ MongoDB Error:', err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});