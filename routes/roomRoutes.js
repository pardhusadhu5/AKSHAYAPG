const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Route Guards: admin or manager required
router.use(verifyToken);
router.use(requireRole(['admin', 'manager']));

// Meta & History endpoints (must be defined BEFORE /:id)
router.get('/meta/buildings-floors', roomController.getBuildingsAndFloors);
router.get('/allocations/history', roomController.getAllocationHistory);

// Core Room CRUD
router.get('/', roomController.getAllRooms);
router.get('/beds', roomController.getBeds);
router.get('/:id', roomController.getRoomDetails);
router.post('/', roomController.createRoom);
router.put('/:id', roomController.editRoom);
router.delete('/:id', roomController.deleteRoom);
router.put('/:id/maintenance', roomController.toggleRoomMaintenance);

// Bed routes
router.get('/:roomId/beds', roomController.getBeds);
router.get('/:roomId/vacant', roomController.getVacantBeds);
router.put('/beds/:id/status', roomController.updateBedStatus);

// Student allocation & transfers
router.post('/allocate', roomController.allocateStudent);
router.post('/deallocate', roomController.deallocateStudent);
router.post('/transfer', roomController.transferStudent);

module.exports = router;
