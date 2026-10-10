const express = require('express');
const router = express.Router();
const multer = require('multer');
const { upload, uploadApplicationFields } = require('../services/uploadService');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

const handleUploadApplication = (req, res, next) => {
  uploadApplicationFields(req, res, (err) => {
    if (err) {
      console.error('Upload Error during Student Application:', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: 'File size exceeds 5MB limit. Please upload a smaller photo.' });
        }
        return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ success: false, message: err.message || 'Error processing uploaded file.' });
    }
    next();
  });
};

// Routes
router.post('/login', authController.login);
router.post('/register-student-application', handleUploadApplication, authController.registerStudentApplication);
router.get('/application-status', authController.getApplicationStatus);
router.post('/forgot-password-request', authController.forgotPasswordRequest);

router.put('/update-profile-picture', verifyToken, upload.single('photo'), authController.updateProfilePicture);
router.put('/update-application', verifyToken, authController.updateStudentApplication);
router.put('/change-password', verifyToken, authController.changePassword);

// Student Documents
router.post('/documents', verifyToken, upload.single('document'), authController.uploadDocument);
router.get('/documents', verifyToken, authController.getMyDocuments);
router.delete('/documents/:id', verifyToken, authController.deleteDocument);

router.get('/me', verifyToken, authController.getMe);

module.exports = router;
