const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Access: Admin and Manager only
const adminAuth = [verifyToken, requireRole(['admin', 'manager'])];

// Analytics & Reports
router.get('/analytics', adminAuth, reportController.getReportAnalytics);
router.get('/download', adminAuth, reportController.downloadReport);
router.get('/pdf', adminAuth, reportController.downloadReportPdf);
router.get('/export-google-sheet', adminAuth, reportController.exportGoogleSheet);

// Expense Management
router.get('/expenses', adminAuth, reportController.getExpenses);
router.post('/expenses', adminAuth, reportController.recordExpense);
router.delete('/expenses/:id', adminAuth, reportController.deleteExpense);

// Visitor Management
router.get('/visitors', adminAuth, reportController.getVisitors);
router.post('/visitors', adminAuth, reportController.recordVisitor);
router.put('/visitors/:id/checkout', adminAuth, reportController.checkoutVisitor);

module.exports = router;
