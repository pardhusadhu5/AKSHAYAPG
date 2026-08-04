const { getDb } = require('../config/db');

// Fetch all rooms with dynamic capacity stats and current student lists
async function getAllRooms(req, res) {
  try {
    const db = await getDb();
    
    // Select rooms and calculate occupied/vacant beds dynamically
    const query = `
      SELECT r.*,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupiedBeds,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'vacant') as vacantBeds
      FROM rooms r
      ORDER BY r.roomNumber ASC
    `;
    
    const rooms = await db.all(query);
    
    // For each room, get simple occupants list
    for (let room of rooms) {
      const occupants = await db.all(`
        SELECT studentName, phone, year 
        FROM students 
        WHERE roomId = ?
      `, [room.id]);
      room.currentStudents = occupants;
    }

    res.status(200).json({ success: true, rooms });
  } catch (err) {
    console.error('Fetch Rooms Error:', err);
    res.status(500).json({ success: false, message: `Failed to fetch rooms: ${err.message}` });
  }
}

// Fetch single room details including all its beds and detailed occupant information
async function getRoomDetails(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const room = await db.get(`
      SELECT r.*,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupiedBeds,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'vacant') as vacantBeds
      FROM rooms r
      WHERE r.id = ?
    `, [id]);

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    // Get all beds details in this room
    const beds = await db.all(`
      SELECT b.id, b.bedNumber, b.status, b.userId, u.name as occupantName
      FROM beds b
      LEFT JOIN users u ON b.userId = u.id
      WHERE b.roomId = ?
      ORDER BY b.bedNumber ASC
    `, [id]);

    // Get detailed list of students currently in this room
    const students = await db.all(`
      SELECT s.*, u.email
      FROM students s
      JOIN users u ON s.userId = u.id
      WHERE s.roomId = ?
    `, [id]);

    res.status(200).json({
      success: true,
      room,
      beds,
      students
    });
  } catch (err) {
    console.error('Fetch Room Details Error:', err);
    res.status(500).json({ success: false, message: `Failed to fetch room details: ${err.message}` });
  }
}

// Create a new room and generate its beds
async function createRoom(req, res) {
  try {
    const { roomNumber, capacity, monthlyFee, floor, status } = req.body;

    if (!roomNumber || !capacity || !monthlyFee) {
      return res.status(400).json({ success: false, message: 'Room number, capacity, and monthly fee are required.' });
    }

    const cap = parseInt(capacity);
    if (cap < 1 || cap > 10) {
      return res.status(400).json({ success: false, message: 'Capacity must be between 1 and 10 beds.' });
    }

    const db = await getDb();

    // Check if room number is unique
    const existingRoom = await db.get('SELECT * FROM rooms WHERE roomNumber = ?', [roomNumber]);
    if (existingRoom) {
      return res.status(400).json({ success: false, message: 'Room number already exists.' });
    }

    await db.run('BEGIN TRANSACTION');

    const result = await db.run(
      `INSERT INTO rooms (roomNumber, capacity, monthlyFee, floor, status) VALUES (?, ?, ?, ?, ?)`,
      [roomNumber, cap, parseFloat(monthlyFee), floor || 'Ground Floor', status || 'active']
    );
    const roomId = result.lastID;

    // Automatically generate beds based on capacity
    for (let b = 1; b <= cap; b++) {
      await db.run(
        `INSERT INTO beds (roomId, bedNumber, status) VALUES (?, ?, ?)`,
        [roomId, b, 'vacant']
      );
    }

    await db.run('COMMIT');

    res.status(201).json({ success: true, message: `Room ${roomNumber} created with ${cap} beds on ${floor || 'Ground Floor'} successfully.` });
  } catch (err) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch (_) {}
    console.error('Create Room Error:', err);
    res.status(500).json({ success: false, message: `Failed to create room: ${err.message}` });
  }
}

// Edit room details (supports capacity resizing)
async function editRoom(req, res) {
  try {
    const { id } = req.params;
    const { roomNumber, capacity, monthlyFee, floor, status } = req.body;

    if (!roomNumber || !capacity || !monthlyFee) {
      return res.status(400).json({ success: false, message: 'Room number, capacity, and monthly fee are required.' });
    }

    const cap = parseInt(capacity);
    const db = await getDb();

    const currentRoom = await db.get('SELECT * FROM rooms WHERE id = ?', [id]);
    if (!currentRoom) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    // Check roomNumber collision
    if (roomNumber !== currentRoom.roomNumber) {
      const collision = await db.get('SELECT * FROM rooms WHERE roomNumber = ? AND id != ?', [roomNumber, id]);
      if (collision) {
        return res.status(400).json({ success: false, message: 'Room number is already in use.' });
      }
    }

    await db.run('BEGIN TRANSACTION');

    // Handle Capacity Resizing
    if (cap !== currentRoom.capacity) {
      if (cap < currentRoom.capacity) {
        // Decreasing capacity: check if we are going to delete occupied beds!
        // We will be deleting beds with numbers > cap. Check if any are occupied.
        const occupiedCount = await db.get(
          `SELECT COUNT(*) as count FROM beds WHERE roomId = ? AND bedNumber > ? AND status != 'vacant'`,
          [id, cap]
        );
        
        if (occupiedCount.count > 0) {
          await db.run('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Cannot decrease capacity to ${cap}. Beds numbered higher than ${cap} are currently occupied. Deallocate students first.`
          });
        }

        // Safe to delete excess vacant beds
        await db.run(`DELETE FROM beds WHERE roomId = ? AND bedNumber > ?`, [id, cap]);
      } else {
        // Increasing capacity: insert new beds
        for (let b = currentRoom.capacity + 1; b <= cap; b++) {
          await db.run(
            `INSERT INTO beds (roomId, bedNumber, status) VALUES (?, ?, ?)`,
            [id, b, 'vacant']
          );
        }
      }
    }

    // Update Room record
    await db.run(
      `UPDATE rooms 
       SET roomNumber = ?, capacity = ?, monthlyFee = ?, floor = ?, status = ?, updatedAt = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [roomNumber, cap, parseFloat(monthlyFee), floor || 'Ground Floor', status, id]
    );

    // Update the student monthly Rent details for all students currently in this room to match the new room fee
    await db.run(
      `UPDATE students SET monthlyRent = ? WHERE roomId = ?`,
      [parseFloat(monthlyFee), id]
    );

    await db.run('COMMIT');

    res.status(200).json({ success: true, message: 'Room updated successfully.' });
  } catch (err) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch (_) {}
    console.error('Edit Room Error:', err);
    res.status(500).json({ success: false, message: `Failed to update room: ${err.message}` });
  }
}



// Delete room (verifying it is empty first)
async function deleteRoom(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const room = await db.get('SELECT * FROM rooms WHERE id = ?', [id]);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    // Check if room has any occupied beds
    const occupiedCheck = await db.get(`SELECT COUNT(*) as count FROM beds WHERE roomId = ? AND status != 'vacant'`, [id]);
    if (occupiedCheck.count > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Room ${room.roomNumber} because it still has active students allocated. Deallocate them first.`
      });
    }

    // Safe to delete
    await db.run('DELETE FROM rooms WHERE id = ?', [id]);

    res.status(200).json({ success: true, message: `Room ${room.roomNumber} deleted successfully.` });
  } catch (err) {
    console.error('Delete Room Error:', err);
    res.status(500).json({ success: false, message: `Failed to delete room: ${err.message}` });
  }
}

// Get vacant beds for a room
async function getVacantBeds(req, res) {
  try {
    const { roomId } = req.params;
    const db = await getDb();
    const vacantBeds = await db.all(
      'SELECT id, bedNumber, status FROM beds WHERE roomId = ? AND status = "vacant" ORDER BY bedNumber ASC',
      [roomId]
    );
    res.status(200).json({ success: true, beds: vacantBeds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Allocate a student to a room and bed
async function allocateStudent(req, res) {
  try {
    const { studentId, roomId, bedId } = req.body;

    if (!studentId || !roomId || !bedId) {
      return res.status(400).json({ success: false, message: 'Student ID, Room ID, and Bed ID are required.' });
    }

    const db = await getDb();

    // 1. Verify Student
    const student = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Prevent double allocation check
    if (student.roomId || student.bedId) {
      return res.status(400).json({ success: false, message: 'Student is already assigned to a room/bed. Deallocate first.' });
    }

    // 2. Verify Room Fee & Status
    const room = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }
    if (room.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Cannot allocate to an inactive room.' });
    }

    // 3. Verify Bed
    const bed = await db.get('SELECT * FROM beds WHERE id = ? AND roomId = ?', [bedId, roomId]);
    if (!bed) {
      return res.status(404).json({ success: false, message: 'Bed not found in the selected room.' });
    }
    if (bed.status !== 'vacant') {
      return res.status(400).json({ success: false, message: 'This bed is already occupied or reserved.' });
    }

    // 4. Perform transaction
    await db.run('BEGIN TRANSACTION');

    // Update student coordinates (match rent with room's monthly fee)
    await db.run(
      `UPDATE students 
       SET roomId = ?, bedId = ?, monthlyRent = ?, updatedAt = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [roomId, bedId, room.monthlyFee, studentId]
    );

    // Update bed occupier
    await db.run(
      `UPDATE beds SET status = 'occupied', userId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [student.userId, bedId]
    );

    await db.run('COMMIT');

    res.status(200).json({
      success: true,
      message: `Allocated ${student.studentName} successfully to Room ${room.roomNumber} - Bed ${bed.bedNumber}.`
    });
  } catch (err) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch (_) {}
    console.error('Allocation Error:', err);
    res.status(500).json({ success: false, message: `Allocation failed: ${err.message}` });
  }
}

// Deallocate a student from their room and bed
async function deallocateStudent(req, res) {
  try {
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({ success: false, message: 'Student ID is required.' });
    }

    const db = await getDb();

    // Verify Student Stay
    const student = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    if (!student.roomId && !student.bedId) {
      return res.status(400).json({ success: false, message: 'Student is not currently allocated to any room.' });
    }

    await db.run('BEGIN TRANSACTION');

    // Reset bed occupant parameters
    if (student.bedId) {
      await db.run(
        `UPDATE beds SET status = 'vacant', userId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [student.bedId]
      );
    }

    // Reset student fields
    await db.run(
      `UPDATE students SET roomId = NULL, bedId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [studentId]
    );

    await db.run('COMMIT');

    res.status(200).json({ success: true, message: `Deallocated ${student.studentName} successfully.` });
  } catch (err) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch (_) {}
    console.error('Deallocation Error:', err);
    res.status(500).json({ success: false, message: `Deallocation failed: ${err.message}` });
  }
}

// Transfer a student from one room/bed to another room/bed
async function transferStudent(req, res) {
  try {
    const { studentId, targetRoomId, targetBedId } = req.body;

    if (!studentId || !targetRoomId || !targetBedId) {
      return res.status(400).json({ success: false, message: 'Student ID, target Room ID, and target Bed ID are required.' });
    }

    const db = await getDb();

    // 1. Verify Student
    const student = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const oldBedId = student.bedId;

    // 2. Verify target Room
    const room = await db.get('SELECT * FROM rooms WHERE id = ?', [targetRoomId]);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Target room not found.' });
    }
    if (room.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Target room is not active.' });
    }

    // 3. Verify target Bed
    const bed = await db.get('SELECT * FROM beds WHERE id = ? AND roomId = ?', [targetBedId, targetRoomId]);
    if (!bed) {
      return res.status(404).json({ success: false, message: 'Target bed not found in the selected room.' });
    }
    if (bed.status !== 'vacant' && bed.userId !== student.userId) {
      return res.status(400).json({ success: false, message: 'Target bed is already occupied.' });
    }

    // 4. Perform transaction
    await db.run('BEGIN TRANSACTION');

    // Vacate old bed
    if (oldBedId) {
      await db.run(
        `UPDATE beds SET status = 'vacant', userId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [oldBedId]
      );
    }

    // Allocate target bed
    await db.run(
      `UPDATE beds SET status = 'occupied', userId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [student.userId, targetBedId]
    );

    // Update student coordinates
    await db.run(
      `UPDATE students 
       SET roomId = ?, bedId = ?, monthlyRent = ?, updatedAt = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [targetRoomId, targetBedId, room.monthlyFee, studentId]
    );

    await db.run('COMMIT');

    res.status(200).json({
      success: true,
      message: `Transferred ${student.studentName} successfully to Room ${room.roomNumber} - Bed ${bed.bedNumber}.`
    });
  } catch (err) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch (_) {}
    console.error('Transfer Error:', err);
    res.status(500).json({ success: false, message: `Transfer failed: ${err.message}` });
  }
}

// Update a bed's status (allowing toggle to maintenance)
async function updateBedStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'vacant', 'maintenance', 'reserved'

    if (!['vacant', 'maintenance', 'reserved'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid bed status.' });
    }

    const db = await getDb();
    const bed = await db.get('SELECT * FROM beds WHERE id = ?', [id]);
    if (!bed) {
      return res.status(404).json({ success: false, message: 'Bed record not found.' });
    }

    if (bed.status === 'occupied') {
      return res.status(400).json({ success: false, message: 'Cannot modify status of an occupied bed.' });
    }

    await db.run(
      `UPDATE beds SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );

    res.status(200).json({ success: true, message: `Bed status updated to ${status} successfully.` });
  } catch (err) {
    console.error('Update Bed Status Error:', err);
    res.status(500).json({ success: false, message: `Failed to update bed status: ${err.message}` });
  }
}

module.exports = {
  getAllRooms,
  getRoomDetails,
  createRoom,
  editRoom,
  deleteRoom,
  getVacantBeds,
  allocateStudent,
  deallocateStudent,
  transferStudent,
  updateBedStatus
};
