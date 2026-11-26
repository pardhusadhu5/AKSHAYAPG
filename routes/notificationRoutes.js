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

// General notifications (Access: All authenticated users)
router.get('/', verifyToken, notificationController.getNotifications);
router.put('/:id/read', verifyToken, notificationController.markAsRead);

// Complaints Ticket Desk (Backward Compatibility)
router.post('/complaints', verifyToken, uploadAttachment, complaintController.submitComplaint);
router.get('/complaints/my', verifyToken, complaintController.getMyComplaints);
router.get('/complaints', verifyToken, requireRole(['admin', 'manager']), complaintController.getAllComplaints);
router.put('/complaints/:id/resolve', verifyToken, requireRole(['admin', 'manager']), complaintController.updateComplaintStatus);

module.exports = router;
