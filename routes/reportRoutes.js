const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Download reports & Google Sheets (Access: Admin, Manager only)
router.get('/download', verifyToken, requireRole(['admin', 'manager']), reportController.downloadReport);
router.get('/export-google-sheet', verifyToken, requireRole(['admin', 'manager']), reportController.exportGoogleSheet);

module.exports = router;
