const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const complaintController = require('../controllers/complaintController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { upload } = require('../services/uploadService');

const uploadAttachment = (req, res, next) => {
  const singleUpload = upload.single('image');
  singleUpload(req, res, (err) => {
    if (err) {
      const fallbackUpload = upload.single('attachment');
      return fallbackUpload(req, res, (fallbackErr) => {
        if (fallbackErr) {
          return res.status(400).json({ success: false, message: fallbackErr.message });
        }
        next();
      });
    }
    next();
  });
};

// ==================== IN-APP NOTIFICATIONS ==================== //
// Student personal notifications
router.get('/my', verifyToken, notificationController.getMyNotifications);

// Mark all notifications read
router.put('/read-all', verifyToken, notificationController.markAllAsRead);

// Mark single notification read
router.put('/:id/read', verifyToken, notificationController.markAsRead);

// Delete single notification
router.delete('/:id', verifyToken, notificationController.deleteNotification);

// Admin general notifications
router.get('/', verifyToken, notificationController.getNotifications);

// ==================== ANNOUNCEMENTS ==================== //
// Active announcements for residents & public
router.get('/announcements', notificationController.getActiveAnnouncements);

// Admin announcement management
router.get('/admin/announcements', verifyToken, requireRole(['admin', 'manager']), notificationController.getAllAdminAnnouncements);
router.post('/admin/announcements', verifyToken, requireRole(['admin', 'manager']), notificationController.createAnnouncement);
router.put('/admin/announcements/:id', verifyToken, requireRole(['admin', 'manager']), notificationController.updateAnnouncement);
router.put('/admin/announcements/:id/toggle', verifyToken, requireRole(['admin', 'manager']), notificationController.toggleAnnouncement);
router.delete('/admin/announcements/:id', verifyToken, requireRole(['admin', 'manager']), notificationController.deleteAnnouncement);

// ==================== COMPLAINTS (BACKWARD COMPATIBILITY) ==================== //
router.post('/complaints', verifyToken, uploadAttachment, complaintController.submitComplaint);
router.get('/complaints/my', verifyToken, complaintController.getMyComplaints);
router.get('/complaints', verifyToken, requireRole(['admin', 'manager']), complaintController.getAllComplaints);
router.put('/complaints/:id/resolve', verifyToken, requireRole(['admin', 'manager']), complaintController.updateComplaintStatus);

module.exports = router;
