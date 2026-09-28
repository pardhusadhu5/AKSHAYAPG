const express = require('express');
const router = express.Router();
const { upload, uploadApplicationFields } = require('../services/uploadService');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// Routes
router.post('/login', authController.login);
router.post('/register-student-application', uploadApplicationFields, authController.registerStudentApplication);
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
