const express = require('express');
const router = express.Router();
const { upload } = require('../services/uploadService');
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
// Route Guards: admin or manager required
router.use(verifyToken);
router.use(requireRole(['admin', 'manager']));

router.get('/stats', dashboardController.getStats);
router.get('/students', dashboardController.getStudentsList);
router.get('/applications', dashboardController.getApplications);
router.post('/applications/:id/review', dashboardController.reviewApplication);
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
