const express = require('express');
const router = express.Router();
const reminderController = require('../controllers/reminderController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Reminder Actions (Access: Admin, Manager only)
router.post('/send', verifyToken, requireRole(['admin', 'manager']), reminderController.sendIndividualReminder);
router.post('/send-bulk', verifyToken, requireRole(['admin', 'manager']), reminderController.sendBulkReminders);
router.get('/logs', verifyToken, requireRole(['admin', 'manager']), reminderController.getReminderLogs);

module.exports = router;
