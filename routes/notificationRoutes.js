const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// General notifications (Access: All authenticated users)
router.get('/', verifyToken, notificationController.getNotifications);
router.put('/:id/read', verifyToken, notificationController.markAsRead);

// Complaints Ticket Desk (Access: Students raise, list their own)
router.post('/complaints', verifyToken, notificationController.submitComplaint);
router.get('/complaints/my', verifyToken, notificationController.getMyComplaints);

// Admin Complaints management (Access: Admin, Manager only)
router.get('/complaints', verifyToken, requireRole(['admin', 'manager']), notificationController.getAllComplaints);
router.put('/complaints/:id/resolve', verifyToken, requireRole(['admin', 'manager']), notificationController.resolveComplaint);

module.exports = router;
