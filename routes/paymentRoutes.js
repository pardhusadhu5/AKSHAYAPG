const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Public Razorpay Webhook Endpoint
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.handleWebhook);

// Student Online Payment Gateway Routes
router.post('/create-order', verifyToken, requireRole(['student']), paymentController.createOrder);
router.post('/verify', verifyToken, requireRole(['student']), paymentController.verifyPayment);
router.get('/student/fees', verifyToken, requireRole(['student']), paymentController.getStudentFees);

// PDF Receipt Download Route (Student / Admin)
router.get('/receipt/:receiptNumber/pdf', verifyToken, paymentController.downloadReceiptPdf);
router.get('/:id/receipt', verifyToken, paymentController.getPaymentReceipt);

// Admin / Manager Payment Management Routes
router.get('/admin/all', verifyToken, requireRole(['admin', 'manager']), paymentController.getAllPayments);
router.get('/admin/stats', verifyToken, requireRole(['admin', 'manager']), paymentController.getPaymentStats);
router.post('/admin/generate-monthly', verifyToken, requireRole(['admin', 'manager']), paymentController.generateMonthlyFee);
router.post('/:id/record', verifyToken, requireRole(['admin', 'manager']), paymentController.recordPayment);

// Legacy routes for compatibility
router.get('/', verifyToken, requireRole(['admin', 'manager']), paymentController.getAllPayments);
router.get('/stats', verifyToken, requireRole(['admin', 'manager']), paymentController.getPaymentStats);
router.get('/my-payments', verifyToken, paymentController.getStudentFees);

module.exports = router;
