const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const depositController = require('../controllers/depositController');
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
router.get('/admin/settings', verifyToken, requireRole(['admin', 'manager']), paymentController.getBillingSettings);
router.put('/admin/settings', verifyToken, requireRole(['admin', 'manager']), paymentController.updateBillingSettings);
router.get('/admin/student/:studentId', verifyToken, requireRole(['admin', 'manager']), paymentController.getStudentRentHistory);
router.post('/admin/send-reminders', verifyToken, requireRole(['admin', 'manager']), paymentController.sendDueReminders);

// Phase 4: Security Deposit Management Routes
router.get('/deposits/stats', verifyToken, requireRole(['admin', 'manager']), depositController.getDepositStats);
router.get('/deposits/ledger', verifyToken, requireRole(['admin', 'manager']), depositController.getDepositLedger);
router.post('/deposits/collect', verifyToken, requireRole(['admin', 'manager']), depositController.recordDepositCollection);
router.post('/deposits/deduct', verifyToken, requireRole(['admin', 'manager']), depositController.recordDepositDeduction);
router.post('/deposits/refund', verifyToken, requireRole(['admin', 'manager']), depositController.processDepositRefund);
router.get('/deposits/pending-refunds', verifyToken, requireRole(['admin', 'manager']), depositController.getPendingRefunds);
router.get('/deposits/config', verifyToken, requireRole(['admin', 'manager']), depositController.getDepositConfig);
router.put('/deposits/config', verifyToken, requireRole(['admin', 'manager']), depositController.updateDepositConfig);
router.get('/deposits/student/:studentId', verifyToken, depositController.getStudentDepositHistory);

// Legacy routes for compatibility
router.get('/', verifyToken, requireRole(['admin', 'manager']), paymentController.getAllPayments);
router.get('/stats', verifyToken, requireRole(['admin', 'manager']), paymentController.getPaymentStats);
router.get('/my-payments', verifyToken, paymentController.getStudentFees);

module.exports = router;
