const express = require('express');
const router = express.Router();
const { upload } = require('../services/uploadService');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// Routes
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register-with-otp', upload.single('photo'), authController.registerWithOtp);
router.post('/register', upload.single('photo'), authController.register);
router.post('/login', authController.login);
router.put('/update-profile-picture', verifyToken, upload.single('photo'), authController.updateProfilePicture);
router.put('/update-application', verifyToken, authController.updateStudentApplication);
router.put('/change-password', verifyToken, authController.changePassword);

// Student Documents
router.post('/documents', verifyToken, upload.single('document'), authController.uploadDocument);
router.get('/documents', verifyToken, authController.getMyDocuments);
router.delete('/documents/:id', verifyToken, authController.deleteDocument);

router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/me', verifyToken, authController.getMe);

module.exports = router;
