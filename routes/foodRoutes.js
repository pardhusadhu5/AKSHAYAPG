const express = require('express');
const router = express.Router();
const foodController = require('../controllers/foodController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Public / Resident Menu Views
router.get('/weekly', foodController.getWeeklyMenu);
router.get('/today', foodController.getTodayMenu);
router.get('/config', foodController.getMessConfig);

// Student Preferences
router.get('/preferences', verifyToken, foodController.getStudentPreferences);
router.put('/preferences', verifyToken, foodController.updateStudentPreferences);

// Admin & Staff Food Management Endpoints
router.get('/admin/menu', verifyToken, requireRole(['admin', 'manager']), foodController.getAdminWeeklyMenu);
router.put('/admin/menu', verifyToken, requireRole(['admin', 'manager']), foodController.updateMealMenu);
router.post('/admin/publish-week', verifyToken, requireRole(['admin', 'manager']), foodController.publishWeeklyMenu);
router.get('/admin/preferences', verifyToken, requireRole(['admin', 'manager']), foodController.getAdminDietaryRoster);
router.get('/admin/complaints', verifyToken, requireRole(['admin', 'manager']), foodController.getFoodComplaints);
router.put('/admin/config', verifyToken, requireRole(['admin', 'manager']), foodController.updateMessConfig);

module.exports = router;
