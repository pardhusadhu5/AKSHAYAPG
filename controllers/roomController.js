const { getDb } = require('../config/db');

// Helper function to convert numeric index to alphabetical bed suffix (1 -> A, 2 -> B, 6 -> F)
function getBedLetter(index) {
  let letter = '';
  let i = parseInt(index);
  while (i > 0) {
    let rem = (i - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    i = Math.floor((i - 1) / 26);
  }
  return letter;
}

// Helper function to calculate room display status
function calculateRoomStatus(room, occupiedCount) {
  if (room.status === 'maintenance') return 'Maintenance';
  if (room.status === 'inactive') return 'Maintenance';
  const cap = parseInt(room.capacity || 0);
  const occ = parseInt(occupiedCount || 0);
  if (occ === 0) return 'Available';
  if (occ >= cap) return 'Full';
  return 'Partially Occupied';
}

// Fetch all rooms with dynamic capacity stats, bed lists, and current student lists
async function getAllRooms(req, res) {
  try {
    const db = await getDb();
    
    const query = `
      SELECT r.*,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupiedBeds,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'vacant') as vacantBeds,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'maintenance') as maintenanceBeds
      FROM rooms r
      ORDER BY r.roomNumber ASC
    `;
    
    const { rows: rooms } = await db.query(query);
    
    for (let room of rooms) {
      room.roomNumber = room.roomnumber || room.roomNumber;
      room.monthlyFee = parseFloat(room.monthlyfee || room.monthlyFee || 0);
      room.roomType = room.roomtype || room.roomType;
      room.capacity = parseInt(room.capacity || 0);
      room.floor = room.floor || 'Floor 1';
      room.block = room.block || 'Main Block';
      room.occupiedBeds = parseInt(room.occupiedbeds || room.occupiedBeds || 0);
      room.vacantBeds = parseInt(room.vacantbeds || room.vacantBeds || 0);
      room.maintenanceBeds = parseInt(room.maintenancebeds || room.maintenanceBeds || 0);
      room.displayStatus = calculateRoomStatus(room, room.occupiedBeds);
      
      // Get assigned students
      const { rows: occupants } = await db.query(`
        SELECT s.id, s.studentCustomId, s.studentName, s.phone, s.year, s.joinDate, b.bedNumber, b.bedLabel
        FROM students s 
        LEFT JOIN beds b ON s.bedId = b.id
        WHERE s.roomId = $1
        ORDER BY b.bedNumber ASC
      `, [room.id]);
      room.currentStudents = occupants;

      // Get beds summary
      const { rows: beds } = await db.query(`
        SELECT b.id, b.bedNumber, b.bedLabel, b.status, b.userId,
               s.id as studentId, s.studentCustomId, s.studentName, s.joinDate
        FROM beds b
        LEFT JOIN users u ON b.userId = u.id
        LEFT JOIN students s ON (s.bedId = b.id OR (b.userId IS NOT NULL AND s.userId = u.id))
        WHERE b.roomId = $1
        ORDER BY b.bedNumber ASC
      `, [room.id]);
      room.beds = beds;
    }

    res.status(200).json({ success: true, rooms });
  } catch (err) {
    console.error('Fetch Rooms Error:', err);
    res.status(500).json({ success: false, message: `Failed to fetch rooms: ${err.message}` });
  }
}

// Fetch single room details including all beds and assigned students
async function getRoomDetails(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows: roomRows } = await db.query(`
      SELECT r.*,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupiedBeds,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'vacant') as vacantBeds,
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'maintenance') as maintenanceBeds
      FROM rooms r
      WHERE r.id = $1
    `, [id]);

    const room = roomRows[0];
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    room.roomNumber = room.roomnumber || room.roomNumber;
    room.monthlyFee = parseFloat(room.monthlyfee || room.monthlyFee || 0);
    room.roomType = room.roomtype || room.roomType;
    room.capacity = parseInt(room.capacity || 0);
    room.floor = room.floor || 'Floor 1';
    room.block = room.block || 'Main Block';
    room.occupiedBeds = parseInt(room.occupiedbeds || room.occupiedBeds || 0);
    room.vacantBeds = parseInt(room.vacantbeds || room.vacantBeds || 0);
    room.maintenanceBeds = parseInt(room.maintenancebeds || room.maintenanceBeds || 0);
    room.displayStatus = calculateRoomStatus(room, room.occupiedBeds);

    // Get all beds in room
    const { rows: beds } = await db.query(`
      SELECT b.id, b.bedNumber, b.bedLabel, b.status, b.userId,
             s.id as studentId, s.studentCustomId, s.studentName, s.phone, s.joinDate
      FROM beds b
      LEFT JOIN users u ON b.userId = u.id
      LEFT JOIN students s ON (s.bedId = b.id OR (b.userId IS NOT NULL AND s.userId = u.id))
      WHERE b.roomId = $1
      ORDER BY b.bedNumber ASC
    `, [id]);

    // Get assigned students
    const { rows: students } = await db.query(`
      SELECT s.*, u.email, b.bedNumber, b.bedLabel
      FROM students s
      JOIN users u ON s.userId = u.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE s.roomId = $1
      ORDER BY b.bedNumber ASC
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

// Create a new room and auto-generate beds
async function createRoom(req, res) {
  try {
    const { roomNumber, capacity, numberOfBeds, monthlyFee, floor, block, roomType, status } = req.body;
    const totalBeds = parseInt(numberOfBeds || capacity);

    if (!roomNumber || !totalBeds || !monthlyFee) {
      return res.status(400).json({ success: false, message: 'Room number, number of beds, and monthly fee are required.' });
    }

    if (totalBeds < 1 || totalBeds > 10) {
      return res.status(400).json({ success: false, message: 'Bed capacity must be between 1 and 10 beds.' });
    }

    const db = await getDb();

    // Check unique room number
    const { rows: existing } = await db.query('SELECT * FROM rooms WHERE roomNumber = $1', [roomNumber.trim()]);
    if (existing[0]) {
      return res.status(400).json({ success: false, message: `Room number "${roomNumber}" already exists.` });
    }

    let calculatedType = roomType || `${totalBeds} Sharing`;

    await db.query('BEGIN');

    const { rows: roomResult } = await db.query(
      `INSERT INTO rooms (roomNumber, capacity, monthlyFee, floor, block, roomType, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        roomNumber.trim(),
        totalBeds,
        parseFloat(monthlyFee),
        floor || 'Floor 1',
        block || 'Main Block',
        calculatedType,
        status || 'active'
      ]
    );
    const roomId = roomResult[0].id;

    // Automatically generate beds with alphabetical labels (e.g. 101-A, 101-B)
    for (let b = 1; b <= totalBeds; b++) {
      const bedLabel = `${roomNumber.trim()}-${getBedLetter(b)}`;
      await db.query(
        `INSERT INTO beds (roomId, bedNumber, bedLabel, status) VALUES ($1, $2, $3, $4)`,
        [roomId, b, bedLabel, 'vacant']
      );
    }

    await db.query('COMMIT');

    res.status(201).json({
      success: true,
      message: `Room ${roomNumber} created with ${totalBeds} available beds successfully.`,
      roomId,
      room: { id: roomId, roomNumber: roomNumber.trim(), capacity: totalBeds }
    });
  } catch (err) {
    try {
      const db = await getDb();
      await db.query('ROLLBACK');
    } catch (_) {}
    console.error('Create Room Error:', err);
    res.status(500).json({ success: false, message: `Failed to create room: ${err.message}` });
  }
}

// Edit room details (supports capacity resizing with occupied safety check)
async function editRoom(req, res) {
  try {
    const { id } = req.params;
    const { roomNumber, capacity, numberOfBeds, monthlyFee, floor, block, roomType, status } = req.body;
    const totalBeds = parseInt(numberOfBeds || capacity);

    if (!roomNumber || !totalBeds || !monthlyFee) {
      return res.status(400).json({ success: false, message: 'Room number, number of beds, and monthly fee are required.' });
    }

    const db = await getDb();

    const { rows: roomRows } = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
    const currentRoom = roomRows[0];
    if (!currentRoom) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    // Check collision if roomNumber is changed
    if (roomNumber.trim() !== currentRoom.roomNumber) {
      const { rows: collision } = await db.query('SELECT * FROM rooms WHERE roomNumber = $1 AND id != $2', [roomNumber.trim(), id]);
      if (collision[0]) {
        return res.status(400).json({ success: false, message: 'Room number is already in use by another room.' });
      }
    }

    // Handle capacity resizing
    let bedsToDelete = [];
    if (totalBeds !== currentRoom.capacity) {
      if (totalBeds < currentRoom.capacity) {
        // Count occupied beds
        const { rows: occCheck } = await db.query(
          `SELECT COUNT(*) as count FROM beds WHERE roomId = $1 AND status = 'occupied'`,
          [id]
        );
        const occupiedCount = parseInt(occCheck[0].count);

        if (totalBeds < occupiedCount) {
          return res.status(400).json({
            success: false,
            message: `Cannot reduce this room to ${totalBeds} sharing because ${occupiedCount} beds are currently occupied.`
          });
        }

        const bedsToRemoveCount = currentRoom.capacity - totalBeds;
        const { rows: vacantBeds } = await db.query(
          `SELECT id FROM beds WHERE roomId = $1 AND status = 'vacant' ORDER BY bedNumber DESC LIMIT $2`,
          [id, bedsToRemoveCount]
        );

        if (vacantBeds.length < bedsToRemoveCount) {
          return res.status(400).json({
            success: false,
            message: `Cannot reduce capacity: room requires ${bedsToRemoveCount} vacant beds to remove, but only found ${vacantBeds.length}.`
          });
        }

        bedsToDelete = vacantBeds.map(b => b.id);
      }
    }

    await db.query('BEGIN');

    // Delete vacant beds if reducing capacity
    if (bedsToDelete.length > 0) {
      for (const bedId of bedsToDelete) {
        await db.query(`DELETE FROM beds WHERE id = $1`, [bedId]);
      }
    }

    // Insert new beds if increasing capacity
    if (totalBeds > currentRoom.capacity) {
      for (let b = currentRoom.capacity + 1; b <= totalBeds; b++) {
        const bedLabel = `${roomNumber.trim()}-${getBedLetter(b)}`;
        await db.query(
          `INSERT INTO beds (roomId, bedNumber, bedLabel, status) VALUES ($1, $2, $3, $4)`,
          [id, b, bedLabel, 'vacant']
        );
      }
    }

    // Update bed labels if room number changed
    if (roomNumber.trim() !== currentRoom.roomNumber) {
      const { rows: existingBeds } = await db.query('SELECT id, bedNumber FROM beds WHERE roomId = $1', [id]);
      for (const bed of existingBeds) {
        await db.query('UPDATE beds SET bedLabel = $1 WHERE id = $2', [`${roomNumber.trim()}-${getBedLetter(bed.bedNumber)}`, bed.id]);
      }
    }

    // Update Room
    let calculatedType = roomType || `${totalBeds} Sharing`;
    await db.query(
      `UPDATE rooms 
       SET roomNumber = $1, capacity = $2, monthlyFee = $3, floor = $4, block = $5, roomType = $6, status = $7, updatedAt = CURRENT_TIMESTAMP 
       WHERE id = $8`,
      [roomNumber.trim(), totalBeds, parseFloat(monthlyFee), floor || 'Floor 1', block || 'Main Block', calculatedType, status || 'active', id]
    );

    // Update monthly rent for assigned students
    await db.query(`UPDATE students SET monthlyRent = $1 WHERE roomId = $2`, [parseFloat(monthlyFee), id]);

    await db.query('COMMIT');

    res.status(200).json({ success: true, message: 'Room updated successfully.' });
  } catch (err) {
    try {
      const db = await getDb();
      await db.query('ROLLBACK');
    } catch (_) {}
    console.error('Edit Room Error:', err);
    res.status(500).json({ success: false, message: `Failed to update room: ${err.message}` });
  }
}

// Delete room (verifies 0 occupied beds first)
async function deleteRoom(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows: roomRows } = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
    const room = roomRows[0];
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    // Check if room has occupied beds
    const { rows: occCheck } = await db.query(`SELECT COUNT(*) as count FROM beds WHERE roomId = $1 AND status = 'occupied'`, [id]);
    if (parseInt(occCheck[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Room ${room.roomNumber} because it currently has ${occCheck[0].count} active occupied bed(s). Deallocate or transfer students first.`
      });
    }

    await db.query('DELETE FROM rooms WHERE id = $1', [id]);

    res.status(200).json({ success: true, message: `Room ${room.roomNumber} deleted successfully.` });
  } catch (err) {
    console.error('Delete Room Error:', err);
    res.status(500).json({ success: false, message: `Failed to delete room: ${err.message}` });
  }
}

// Get all beds or beds for a room
async function getBeds(req, res) {
  try {
    const { roomId } = req.params;
    const db = await getDb();

    let sql = `
      SELECT b.*, r.roomNumber, r.floor, r.block,
             s.id as studentId, s.studentCustomId, s.studentName, s.phone, s.joinDate
      FROM beds b
      JOIN rooms r ON b.roomId = r.id
      LEFT JOIN users u ON b.userId = u.id
      LEFT JOIN students s ON s.userId = u.id
    `;
    const params = [];

    if (roomId) {
      sql += ` WHERE b.roomId = $1`;
      params.push(roomId);
    }
    sql += ` ORDER BY r.roomNumber ASC, b.bedNumber ASC`;

    const { rows: beds } = await db.query(sql, params);
    res.status(200).json({ success: true, beds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Get vacant beds for a room
async function getVacantBeds(req, res) {
  try {
    const { roomId } = req.params;
    const db = await getDb();
    const { rows: beds } = await db.query(
      `SELECT id, bedNumber, bedLabel, status FROM beds WHERE roomId = $1 AND status = 'vacant' ORDER BY bedNumber ASC`,
      [roomId]
    );
    res.status(200).json({ success: true, beds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Update bed status (e.g. toggle maintenance / vacant)
async function updateBedStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    let targetStatus = (status || '').toLowerCase();
    if (targetStatus === 'available') targetStatus = 'vacant';

    if (!['vacant', 'maintenance'].includes(targetStatus)) {
      return res.status(400).json({ success: false, message: 'Status must be vacant or maintenance.' });
    }

    const db = await getDb();
    const { rows: bedRows } = await db.query('SELECT * FROM beds WHERE id = $1', [id]);
    const bed = bedRows[0];
    if (!bed) {
      return res.status(404).json({ success: false, message: 'Bed record not found.' });
    }

    if (bed.status === 'occupied') {
      return res.status(400).json({ success: false, message: 'Cannot change status of an occupied bed. Deallocate student first.' });
    }

    await db.query('UPDATE beds SET status = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2', [targetStatus, id]);

    res.status(200).json({ success: true, message: `Bed status updated to ${targetStatus === 'vacant' ? 'Available' : 'Maintenance'}.` });
  } catch (err) {
    console.error('Update Bed Status Error:', err);
    res.status(500).json({ success: false, message: `Failed to update bed status: ${err.message}` });
  }
}

// Allocate a student to a room and bed (with race-condition double-booking safety)
async function allocateStudent(req, res) {
  try {
    const { studentId, roomId, bedId } = req.body;

    if (!studentId || !roomId || !bedId) {
      return res.status(400).json({ success: false, message: 'Student ID, Room ID, and Bed ID are required.' });
    }

    const db = await getDb();

    await db.query('BEGIN');

    // 1. Verify Student inside transaction
    const { rows: studentRows } = await db.query('SELECT * FROM students WHERE id = $1 FOR UPDATE', [studentId]);
    const student = studentRows[0];
    if (!student) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    if (student.roomId || student.bedId) {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `${student.studentName} is already allocated to a room. Deallocate or transfer first.` });
    }

    // 2. Verify Room
    const { rows: roomRows } = await db.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
    const room = roomRows[0];
    if (!room) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Selected room not found.' });
    }
    if (room.status === 'inactive' || room.status === 'maintenance') {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Cannot allocate to an inactive or maintenance room.' });
    }

    // 3. Verify & Lock Bed (Double-Booking Prevention)
    const { rows: bedRows } = await db.query('SELECT * FROM beds WHERE id = $1 AND roomId = $2 FOR UPDATE', [bedId, roomId]);
    const bed = bedRows[0];
    if (!bed) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Selected bed not found in target room.' });
    }
    if (bed.status !== 'vacant') {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Selected bed is no longer available (occupied or maintenance).' });
    }

    const studentNameVal = student.studentName || student.studentname;
    const studentUserIdVal = student.userId || student.userid;
    const roomNumberVal = room.roomNumber || room.roomnumber;
    const bedLabelVal = bed.bedLabel || bed.bedlabel || `Bed ${bed.bedNumber || bed.bednumber}`;
    const monthlyRentFee = room.monthlyfee || room.monthlyFee || student.monthlyRent || student.monthlyrent || 8500;

    // Update Student to active resident
    await db.query(
      `UPDATE students 
       SET roomId = $1, bedId = $2, monthlyRent = $3, status = 'active', applicationStatus = 'ADMISSION_CONFIRMED', updatedAt = CURRENT_TIMESTAMP 
       WHERE id = $4`,
      [roomId, bedId, parseFloat(monthlyRentFee), studentId]
    );

    // Update Bed to occupied
    await db.query(
      `UPDATE beds SET status = 'occupied', userId = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2`,
      [studentUserIdVal, bedId]
    );

    // Record Allocation
    await db.query(
      `INSERT INTO allocations (studentId, roomId, bedId, status) VALUES ($1, $2, $3, $4)`,
      [studentId, roomId, bedId, 'active']
    );

    // Add Notification
    await db.query(
      `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
      ['bed_allocated', `Allocated ${studentNameVal} to Room ${roomNumberVal} (${bedLabelVal}).`]
    );

    await db.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Allocated ${studentNameVal} successfully to Room ${roomNumberVal} (${bedLabelVal}).`
    });
  } catch (err) {
    try {
      const db = await getDb();
      await db.query('ROLLBACK');
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

    const { rows: studentRows } = await db.query('SELECT * FROM students WHERE id = $1', [studentId]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const studentRoomId = student.roomid || student.roomId;
    const studentBedId = student.bedid || student.bedId;

    if (!studentRoomId && !studentBedId) {
      return res.status(400).json({ success: false, message: 'Student is not currently allocated to any room.' });
    }

    await db.query('BEGIN');

    // Vacate bed
    if (studentBedId) {
      await db.query(
        `UPDATE beds SET status = 'vacant', userId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
        [studentBedId]
      );
    }

    // Reset student room/bed
    await db.query(
      `UPDATE students SET roomId = NULL, bedId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
      [studentId]
    );

    // Update allocation record
    await db.query(
      `UPDATE allocations SET vacatedAt = CURRENT_TIMESTAMP, status = 'vacated' WHERE studentId = $1 AND status = 'active'`,
      [studentId]
    );

    await db.query('COMMIT');

    res.status(200).json({ success: true, message: `Deallocated ${student.studentName} successfully.` });
  } catch (err) {
    try {
      const db = await getDb();
      await db.query('ROLLBACK');
    } catch (_) {}
    console.error('Deallocation Error:', err);
    res.status(500).json({ success: false, message: `Deallocation failed: ${err.message}` });
  }
}

// Transfer a student from one room/bed to another
async function transferStudent(req, res) {
  try {
    const studentId = req.body.studentId;
    const targetRoomId = req.body.targetRoomId || req.body.newRoomId || req.body.roomId;
    const targetBedId = req.body.targetBedId || req.body.newBedId || req.body.bedId;

    if (!studentId || !targetRoomId || !targetBedId) {
      return res.status(400).json({ success: false, message: 'Student ID, target Room ID, and target Bed ID are required.' });
    }

    const db = await getDb();

    // 1. Verify Student
    const { rows: studentRows } = await db.query('SELECT * FROM students WHERE id = $1', [studentId]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const oldBedId = student.bedid || student.bedId;
    const studentUserId = student.userid || student.userId;

    // 2. Verify target Room
    const { rows: roomRows } = await db.query('SELECT * FROM rooms WHERE id = $1', [targetRoomId]);
    const room = roomRows[0];
    if (!room) {
      return res.status(404).json({ success: false, message: 'Target room not found.' });
    }
    if (room.status === 'inactive' || room.status === 'maintenance') {
      return res.status(400).json({ success: false, message: 'Target room is not active.' });
    }

    // 3. Verify target Bed
    const { rows: bedRows } = await db.query('SELECT * FROM beds WHERE id = $1 AND roomId = $2', [targetBedId, targetRoomId]);
    const bed = bedRows[0];
    if (!bed) {
      return res.status(404).json({ success: false, message: 'Target bed not found in selected room.' });
    }
    if (bed.status !== 'vacant') {
      return res.status(400).json({ success: false, message: 'Target bed is not available (occupied or maintenance).' });
    }

    await db.query('BEGIN');

    // Vacate old bed & update old allocation
    if (oldBedId) {
      await db.query(`UPDATE beds SET status = 'vacant', userId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = $1`, [oldBedId]);
      await db.query(`UPDATE allocations SET vacatedAt = CURRENT_TIMESTAMP, status = 'transferred' WHERE studentId = $1 AND status = 'active'`, [studentId]);
    }

    // Occupy target bed
    await db.query(`UPDATE beds SET status = 'occupied', userId = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2`, [studentUserId, targetBedId]);

    // Update Student
    const newRent = room.monthlyfee || room.monthlyFee || student.monthlyrent || student.monthlyRent || 8500;
    await db.query(`UPDATE students SET roomId = $1, bedId = $2, monthlyRent = $3, updatedAt = CURRENT_TIMESTAMP WHERE id = $4`, [targetRoomId, targetBedId, newRent, studentId]);

    // Record new allocation
    await db.query(`INSERT INTO allocations (studentId, roomId, bedId, status) VALUES ($1, $2, $3, $4)`, [studentId, targetRoomId, targetBedId, 'active']);

    await db.query('COMMIT');

    const bedName = bed.bedLabel || `Bed ${bed.bedNumber}`;
    res.status(200).json({
      success: true,
      message: `Transferred ${student.studentName} successfully to Room ${room.roomNumber} (${bedName}).`
    });
  } catch (err) {
    try {
      const db = await getDb();
      await db.query('ROLLBACK');
    } catch (_) {}
    console.error('Transfer Error:', err);
    res.status(500).json({ success: false, message: `Transfer failed: ${err.message}` });
  }
}

module.exports = {
  getAllRooms,
  getRoomDetails,
  createRoom,
  editRoom,
  deleteRoom,
  getBeds,
  getVacantBeds,
  updateBedStatus,
  allocateStudent,
  deallocateStudent,
  transferStudent
};
