require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files directly from the root of the project
app.use(express.static(__dirname));

// Serve admin dashboard from the admin folder
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Serve uploaded profile photos statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const roomRoutes = require('./routes/roomRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const reportRoutes = require('./routes/reportRoutes');
const reminderRoutes = require('./routes/reminderRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/notifications', notificationRoutes);

// Fallback HTML router for single page application routing if requested
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start DB and Express Server
async function startServer() {
  try {
    console.log('Connecting to database...');
    await getDb();
    console.log('Database initialized successfully.');

    const server = app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`Akshaya Deluxe Hostel Management Server Active`);
      console.log(`URL: http://localhost:${PORT}`);
      console.log(`====================================================`);
    });

    // Keep process active
    setInterval(() => {}, 30000);
  } catch (err) {
    console.error('Fatal: Server Failed to Start:', err);
    process.exit(1);
  }
}

startServer();
