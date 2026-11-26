const express = require('express');
const router = express.Router();
const complaintController = require('../controllers/complaintController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { upload } = require('../services/uploadService');

// Multer middleware handling single file upload with field name 'image' or 'attachment'
const uploadAttachment = (req, res, next) => {
  const singleUpload = upload.single('image');
  singleUpload(req, res, (err) => {
    if (err) {
      // If error was about field name, try 'attachment'
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

// Student Endpoints
router.post('/', verifyToken, uploadAttachment, complaintController.submitComplaint);
router.get('/my', verifyToken, complaintController.getMyComplaints);

// Admin / Manager Endpoints
router.get('/admin/stats', verifyToken, requireRole(['admin', 'manager']), complaintController.getComplaintStats);
router.get('/admin/all', verifyToken, requireRole(['admin', 'manager']), complaintController.getAllComplaints);
router.get('/:id', verifyToken, complaintController.getComplaintDetails);
router.put('/:id/assign', verifyToken, requireRole(['admin', 'manager']), complaintController.assignComplaint);
router.put('/:id/status', verifyToken, requireRole(['admin', 'manager']), complaintController.updateComplaintStatus);

module.exports = router;
