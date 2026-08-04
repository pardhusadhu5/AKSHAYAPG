const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// General stats (Admin/Manager only)
router.get('/', verifyToken, requireRole(['admin', 'manager']), paymentController.getAllPayments);
router.get('/stats', verifyToken, requireRole(['admin', 'manager']), paymentController.getPaymentStats);

// Monthly Invoicing runs (Admin/Manager only)
router.post('/generate-monthly', verifyToken, requireRole(['admin', 'manager']), paymentController.generateMonthlyFee);

// Cash/UPI collections (Admin/Manager only)
router.post('/:id/record', verifyToken, requireRole(['admin', 'manager']), paymentController.recordPayment);

// Razorpay checkout online simulation (Access: Admin, Manager, Student)
router.post('/:id/simulate-online', verifyToken, paymentController.simulateOnlinePayment);

// Receipts generation (Access: Admin, Manager, Student)
router.get('/my-payments', verifyToken, paymentController.getMyPayments);
router.get('/:id/receipt', verifyToken, paymentController.getPaymentReceipt);

module.exports = router;
