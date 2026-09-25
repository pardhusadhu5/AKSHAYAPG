const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// Ensure uploads folder exists in root
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|pdf/;
    const mimetype = filetypes.test(file.mimetype) || file.mimetype === 'application/pdf';
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only JPEG, JPG, PNG, and PDF files are allowed.'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Routes
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
