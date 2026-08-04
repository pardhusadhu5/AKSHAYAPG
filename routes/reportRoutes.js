const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Download reports (Access: Admin, Manager only)
router.get('/download', verifyToken, requireRole(['admin', 'manager']), reportController.downloadReport);

module.exports = router;
