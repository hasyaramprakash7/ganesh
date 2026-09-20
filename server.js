require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const paymentRoutes = require('./routes/payment');

const app = express();

// ✅ Allowed origins — NO trailing slashes
const allowedOrigins = [
  'https://list-ganesh.onrender.com',
  'https://laddu-6i69.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow server-to-server / curl / Postman (no origin)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log('❌ CORS blocked origin:', origin);
      return callback(new Error('Not allowed by CORS: ' + origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ✅ Handle preflight for all routes
app.options('*', cors());

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