const express = require('express');
const router = express.Router();
const { upload } = require('../services/uploadService');
const dashboardController = require('../controllers/dashboardController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
// Route Guards: admin or manager required
router.use(verifyToken);
router.use(requireRole(['admin', 'manager']));

router.get('/stats', dashboardController.getStats);
router.get('/events', dashboardController.subscribeAdminEvents);
router.get('/students', dashboardController.getStudentsList);
router.get('/applications', dashboardController.getApplications);
router.post('/applications/:id/review', dashboardController.reviewApplication);
router.get('/students/:id/documents', dashboardController.getStudentDocuments);
router.put('/documents/:id/verify', dashboardController.verifyDocument);
router.post('/students/:id/allocate-room', dashboardController.allocateRoomToStudent);

// Student Check-In & Check-Out (Phase 2)
router.post('/students/:id/check-in', dashboardController.checkInStudent);
router.get('/students/:id/checkout-preview', dashboardController.getCheckoutPreview);
router.post('/students/:id/checkout', dashboardController.checkOutStudent);
router.get('/students/:id/stay-history', dashboardController.getStudentStayHistory);
router.get('/password-reset-requests', dashboardController.getPasswordResetRequests);
router.post('/students/:id/reset-password', dashboardController.adminResetPassword);
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
