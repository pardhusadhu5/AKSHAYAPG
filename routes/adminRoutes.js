const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Ensure uploads folder exists
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
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype || extname) {
      return cb(null, true);
    }
    cb(new Error('Only JPEG, JPG, PNG, and PDF files are allowed.'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Route Guards: admin or manager required
router.use(verifyToken);
router.use(requireRole(['admin', 'manager']));

router.get('/stats', dashboardController.getStats);
router.get('/students', dashboardController.getStudentsList);
router.get('/filters', dashboardController.getFilterOptions);
router.put('/students/:id/payment', dashboardController.updatePaymentStatus);

// Student CRUD Routes
router.get('/students/:id', dashboardController.getStudentDetails);
router.post('/students', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'idProof', maxCount: 1 }]), dashboardController.addStudent);
router.put('/students/:id', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'idProof', maxCount: 1 }]), dashboardController.editStudent);
router.delete('/students/:id', dashboardController.deleteStudent);

// Settings and database backup
router.get('/settings', dashboardController.getSettings);
router.put('/settings', dashboardController.updateSettings);
router.get('/backup-db', dashboardController.downloadDbBackup);

module.exports = router;
