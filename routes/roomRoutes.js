const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Route Guards: admin or manager required
router.use(verifyToken);
router.use(requireRole(['admin', 'manager']));

router.get('/', roomController.getAllRooms);
router.get('/:id', roomController.getRoomDetails);
router.post('/', roomController.createRoom);
router.put('/:id', roomController.editRoom);
router.delete('/:id', roomController.deleteRoom);

router.get('/:roomId/vacant', roomController.getVacantBeds);
router.post('/allocate', roomController.allocateStudent);
router.post('/deallocate', roomController.deallocateStudent);
router.post('/transfer', roomController.transferStudent);
router.put('/beds/:id/status', roomController.updateBedStatus);

module.exports = router;
