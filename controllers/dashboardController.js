const { getDb } = require('../config/db');
const bcrypt = require('bcryptjs');
const path = require('path');

async function getStats(req, res) {
  try {
    const db = await getDb();
    
    // 1. Total Students
    const totalStudentsResult = (await (async () => { let args = ["SELECT COUNT(*) as count FROM users WHERE role = 'student'"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const totalStudents = totalStudentsResult ? totalStudentsResult.count : 0;

    // 2. Active Students
    const activeStudentsResult = (await (async () => { let args = ["SELECT COUNT(*) as count FROM students WHERE status = 'active'"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const activeStudents = activeStudentsResult ? activeStudentsResult.count : 0;

    // 3. Total Rooms
    const totalRoomsResult = (await (async () => { let args = ["SELECT COUNT(*) as count FROM rooms"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const totalRooms = totalRoomsResult ? totalRoomsResult.count : 0;

    // 4. Occupied Beds
    const occupiedBedsResult = (await (async () => { let args = ["SELECT COUNT(*) as count FROM beds WHERE status = 'occupied'"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const occupiedBeds = occupiedBedsResult ? occupiedBedsResult.count : 0;

    // 5. Available Beds (Vacant)
    const vacantBedsResult = (await (async () => { let args = ["SELECT COUNT(*) as count FROM beds WHERE status = 'vacant'"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const vacantBeds = vacantBedsResult ? vacantBedsResult.count : 0;

    // 6. Monthly Collections (sum of monthly rent for active students who have paid)
    const monthlyRentSumResult = (await (async () => { let args = ["SELECT SUM(monthlyRent) as sum FROM students WHERE status = 'active' AND paymentStatus = 'paid'"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const monthlyIncome = (monthlyRentSumResult && monthlyRentSumResult.sum) ? monthlyRentSumResult.sum : 0;

    // 7. Pending Payments (sum of monthly rent for active students who are unpaid)
    const pendingRentSumResult = (await (async () => { let args = ["SELECT SUM(monthlyRent) as sum FROM students WHERE status = 'active' AND paymentStatus = 'unpaid'"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const pendingPayments = (pendingRentSumResult && pendingRentSumResult.sum) ? pendingRentSumResult.sum : 0;

    // 8. New Registrations (registered in last 7 days)
    const newRegistrationsResult = (await (async () => { let args = ["SELECT COUNT(*) as count FROM students WHERE joinDate >= date('now', '-7 days')"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const newRegistrations = newRegistrationsResult ? newRegistrationsResult.count : 0;

    // 9. Recent Admissions (last 5)
    const recentStudents = (await (async () => { let args = [`
      SELECT s.*, r.roomNumber, b.bedNumber 
      FROM students s 
      LEFT JOIN rooms r ON s.roomId = r.id 
      LEFT JOIN beds b ON s.bedId = b.id 
      ORDER BY s.id DESC 
      LIMIT 5
    `]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());

    // 10. Pending Payments List
    const pendingPaymentsList = (await (async () => { let args = [`
      SELECT s.*, r.roomNumber, b.bedNumber 
      FROM students s 
      LEFT JOIN rooms r ON s.roomId = r.id 
      LEFT JOIN beds b ON s.bedId = b.id 
      WHERE s.paymentStatus = 'unpaid' 
      ORDER BY s.id DESC
    `]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());

    // 11. Room-wise Bed Occupancy Progress rates
    const roomOccupancy = (await (async () => { let args = [`
      SELECT r.id, r.roomNumber, r.capacity, 
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupied
      FROM rooms r 
      ORDER BY r.roomNumber ASC
    `]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());

    // 12. Chart Data Counts
    const paidCountResult = (await (async () => { let args = ["SELECT COUNT(*) as count FROM students WHERE paymentStatus = 'paid'"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const unpaidCountResult = (await (async () => { let args = ["SELECT COUNT(*) as count FROM students WHERE paymentStatus = 'unpaid'"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const paidCount = paidCountResult ? paidCountResult.count : 0;
    const unpaidCount = unpaidCountResult ? unpaidCountResult.count : 0;

    // Dynamic Activity Logs based on actual database data
    const dynamicActivities = [];
    const recentAdms = (await (async () => { let args = ["SELECT studentName, joinDate, roomId FROM students ORDER BY id DESC LIMIT 3"]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    recentAdms.forEach((adm, idx) => {
      const roomStr = adm.roomId ? `allocated Room` : `registered`;
      dynamicActivities.push({
        id: idx + 1,
        type: 'admission',
        desc: `${adm.studentName} successfully ${roomStr} on ${adm.joinDate}.`,
        time: idx === 0 ? 'Just Now' : `${idx + 1} hours ago`
      });
    });

    if (dynamicActivities.length === 0) {
      dynamicActivities.push({ id: 1, type: 'maintenance', desc: 'No system activity logs found.', time: 'Realtime' });
    }

    res.status(200).json({
      success: true,
      stats: {
        totalStudents,
        activeStudents,
        totalRooms,
        occupiedBeds,
        vacantBeds,
        monthlyIncome,
        pendingPayments,
        newRegistrations,
        recentActivity: dynamicActivities
      },
      recentStudents,
      pendingPayments: pendingPaymentsList,
      roomOccupancy,
      chartData: {
        occupancy: { occupied: occupiedBeds, vacant: vacantBeds },
        payment: { paid: paidCount, unpaid: unpaidCount },
        revenue: {
          labels: ['Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026'],
          data: [10500, 10500, 19000, 19000, 26000, monthlyIncome]
        }
      }
    });
  } catch (err) {
    console.error('Stats Fetch Error:', err);
    res.status(500).json({ success: false, message: `Failed to load stats: ${err.message}` });
  }
}

async function getStudentsList(req, res) {
  try {
    const { search, paymentStatus, roomId, collegeName, year } = req.query;
    const db = await getDb();
    
    let query = `
      SELECT s.*, u.email, r.roomNumber, b.bedNumber
      FROM students s
      JOIN users u ON s.userId = u.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE 1=1
    `;
    const params = [];
    
    if (search && search.trim() !== '') {
      query += ` AND (
        s.studentName LIKE ? OR 
        s.phone LIKE ? OR 
        s.aadhaarNumber LIKE ? OR 
        s.collegeName LIKE ? OR 
        r.roomNumber LIKE ? OR
        u.email LIKE ? OR
        CAST(s.id AS TEXT) LIKE ?
      )`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term, term, term);
    }

    if (paymentStatus && paymentStatus !== 'all') {
      query += ` AND s.paymentStatus = ?`;
      params.push(paymentStatus);
    }

    if (roomId && roomId !== 'all') {
      query += ` AND s.roomId = ?`;
      params.push(parseInt(roomId));
    }

    if (collegeName && collegeName !== 'all') {
      query += ` AND s.collegeName = ?`;
      params.push(collegeName);
    }

    if (year && year !== 'all') {
      query += ` AND s.year = ?`;
      params.push(year);
    }

    query += ` ORDER BY s.id DESC`;
    
    const list = (await (async () => { let args = [query, params]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    res.status(200).json({ success: true, students: list });
  } catch (err) {
    console.error('Students List Fetch Error:', err);
    res.status(500).json({ success: false, message: `Failed to fetch students list: ${err.message}` });
  }
}

async function updatePaymentStatus(req, res) {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    if (!['paid', 'unpaid'].includes(paymentStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid payment status (must be paid or unpaid).' });
    }

    const db = await getDb();
    const result = (await (async () => {
         let args = [
      'UPDATE students SET paymentStatus = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2',
      [paymentStatus, id]
    ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    res.status(200).json({ success: true, message: 'Payment status updated successfully.' });
  } catch (err) {
    console.error('Update Payment Error:', err);
    res.status(500).json({ success: false, message: `Failed to update payment status: ${err.message}` });
  }
}

// Fetch helper list of colleges for search filter options
async function getFilterOptions(req, res) {
  try {
    const db = await getDb();
    const colleges = (await (async () => { let args = ['SELECT DISTINCT collegeName FROM students WHERE collegeName != ""']; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    const rooms = (await (async () => { let args = ['SELECT id, roomNumber FROM rooms ORDER BY roomNumber ASC']; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    res.status(200).json({
      success: true,
      colleges: colleges.map(c => c.collegeName),
      rooms
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function addStudent(req, res) {
  try {
    const {
      studentName, email, phone, parentName, parentPhone, aadhaarNumber,
      collegeName, course, year, address, joinDate, monthlyRent, depositAmount, password
    } = req.body;

    if (!studentName || !email || !phone || !aadhaarNumber || !password) {
      return res.status(400).json({ success: false, message: 'Required fields: Name, Email, Phone, Aadhaar, and Password.' });
    }

    const db = await getDb();

    // Check duplicate check on users (email, phone) and students (Aadhaar)
    const duplicateEmail = (await (async () => { let args = ['SELECT * FROM users WHERE email = $1', [email]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (duplicateEmail) return res.status(400).json({ success: false, message: 'Email already registered.' });

    const duplicatePhone = (await (async () => { let args = ['SELECT * FROM users WHERE phone = $1', [phone]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (duplicatePhone) return res.status(400).json({ success: false, message: 'Phone number already registered.' });

    const duplicateAadhaar = (await (async () => { let args = ['SELECT * FROM students WHERE aadhaarNumber = $1', [aadhaarNumber]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (duplicateAadhaar) return res.status(400).json({ success: false, message: 'Aadhaar Number already registered.' });

    // File Upload handling
    let photoPath = '/assets/avatar-placeholder.png';
    let idProofPath = null;

    if (req.files) {
      if (req.files.photo && req.files.photo[0]) {
        photoPath = '/uploads/' + req.files.photo[0].filename;
      }
      if (req.files.idProof && req.files.idProof[0]) {
        idProofPath = '/uploads/' + req.files.idProof[0].filename;
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    (await (async () => {
         let args = ['BEGIN TRANSACTION'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
    try {
      // 1. Insert User
      const userResult = (await (async () => {
         let args = [
        `INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5)`,
        [studentName, email, phone, hashedPassword, 'student']
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      const userId = userResult.lastID;

      // 2. Insert Student
      (await (async () => {
         let args = [
        `INSERT INTO students (
          userId, studentName, phone, parentName, parentPhone, aadhaarNumber,
          collegeName, course, year, address, joinDate, monthlyRent, depositAmount,
          photo, idProof, status, paymentStatus
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'active', 'unpaid')`,
        [
          userId, studentName, phone, parentName || '', parentPhone || '', aadhaarNumber,
          collegeName || '', course || '', year || '', address || '', joinDate || new Date().toISOString().split('T')[0],
          parseFloat(monthlyRent || 0), parseFloat(depositAmount || 0), photoPath, idProofPath
        ]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // 3. Create Notification
      (await (async () => {
         let args = [
        `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
        ['new_student', `New student admission: ${studentName} registered.`]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      (await (async () => {
         let args = ['COMMIT'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      res.status(201).json({ success: true, message: `Student ${studentName} added successfully.` });
    } catch (txErr) {
      (await (async () => {
         let args = ['ROLLBACK'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      throw txErr;
    }
  } catch (err) {
    console.error('Add Student Error:', err);
    res.status(500).json({ success: false, message: `Failed to add student: ${err.message}` });
  }
}

async function editStudent(req, res) {
  try {
    const { id } = req.params;
    const {
      studentName, email, phone, parentName, parentPhone, aadhaarNumber,
      collegeName, course, year, address, joinDate, monthlyRent, depositAmount, status
    } = req.body;

    const db = await getDb();

    // Verify Student
    const student = (await (async () => { let args = ['SELECT * FROM students WHERE id = $1', [id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Verify collisions
    const duplicateEmail = (await (async () => { let args = ['SELECT * FROM users WHERE email = $1 AND id != $2', [email, student.userId]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (duplicateEmail) return res.status(400).json({ success: false, message: 'Email already registered by another account.' });

    const duplicatePhone = (await (async () => { let args = ['SELECT * FROM users WHERE phone = $1 AND id != $2', [phone, student.userId]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (duplicatePhone) return res.status(400).json({ success: false, message: 'Phone already registered by another account.' });

    const duplicateAadhaar = (await (async () => { let args = ['SELECT * FROM students WHERE aadhaarNumber = $1 AND id != $2', [aadhaarNumber, id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (duplicateAadhaar) return res.status(400).json({ success: false, message: 'Aadhaar Number already registered.' });

    // File Upload handling
    let photoPath = student.photo;
    let idProofPath = student.idProof;

    if (req.files) {
      if (req.files.photo && req.files.photo[0]) {
        photoPath = '/uploads/' + req.files.photo[0].filename;
      }
      if (req.files.idProof && req.files.idProof[0]) {
        idProofPath = '/uploads/' + req.files.idProof[0].filename;
      }
    }

    (await (async () => {
         let args = ['BEGIN TRANSACTION'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
    try {
      // 1. Update User
      (await (async () => {
         let args = [
        `UPDATE users SET name = $1, email = $2, phone = $3, updatedAt = CURRENT_TIMESTAMP WHERE id = $4`,
        [studentName, email, phone, student.userId]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // 2. Update Student
      (await (async () => {
         let args = [
        `UPDATE students 
         SET studentName = $1, phone = $2, parentName = $3, parentPhone = $4, aadhaarNumber = $5,
             collegeName = $6, course = $7, year = $8, address = $9, joinDate = $10, 
             monthlyRent = $11, depositAmount = $12, photo = $13, idProof = $14, status = $15,
             updatedAt = CURRENT_TIMESTAMP 
         WHERE id = $16`,
        [
          studentName, phone, parentName, parentPhone, aadhaarNumber,
          collegeName, course, year, address, joinDate,
          parseFloat(monthlyRent), parseFloat(depositAmount), photoPath, idProofPath, status || 'active',
          id
        ]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      (await (async () => {
         let args = ['COMMIT'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      res.status(200).json({ success: true, message: 'Student updated successfully.' });
    } catch (txErr) {
      (await (async () => {
         let args = ['ROLLBACK'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      throw txErr;
    }
  } catch (err) {
    console.error('Edit Student Error:', err);
    res.status(500).json({ success: false, message: `Failed to update student: ${err.message}` });
  }
}

async function deleteStudent(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    // Verify Student
    const student = (await (async () => { let args = ['SELECT * FROM students WHERE id = $1', [id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    (await (async () => {
         let args = ['BEGIN TRANSACTION'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
    try {
      // 1. Vacate Bed if assigned
      if (student.bedId) {
        (await (async () => {
         let args = [
          `UPDATE beds SET status = 'vacant', userId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
          [student.bedId]
        ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      }

      // 2. Delete Student
      (await (async () => {
         let args = ['DELETE FROM students WHERE id = $1', [id]];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // 3. Delete corresponding User
      (await (async () => {
         let args = ['DELETE FROM users WHERE id = $1', [student.userId]];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      (await (async () => {
         let args = ['COMMIT'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      res.status(200).json({ success: true, message: `Student ${student.studentName} deleted successfully.` });
    } catch (txErr) {
      (await (async () => {
         let args = ['ROLLBACK'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      throw txErr;
    }
  } catch (err) {
    console.error('Delete Student Error:', err);
    res.status(500).json({ success: false, message: `Failed to delete student: ${err.message}` });
  }
}

// Get hostel settings
async function getSettings(req, res) {
  try {
    const db = await getDb();
    const rows = (await (async () => { let args = ['SELECT * FROM hostelSettings']; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    const settings = {};
    rows.forEach(r => {
      settings[r.key] = r.value;
    });
    res.status(200).json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Update hostel settings
async function updateSettings(req, res) {
  try {
    const settings = req.body;
    const db = await getDb();

    (await (async () => {
         let args = ['BEGIN TRANSACTION'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
    try {
      for (const [key, value] of Object.entries(settings)) {
        (await (async () => {
         let args = [
          `INSERT INTO hostelSettings (key, value) VALUES ($1, $2) 
           ON CONFLICT(key) DO UPDATE SET value = $3`,
          [key, value, value]
        ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      }
      (await (async () => {
         let args = ['COMMIT'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      res.status(200).json({ success: true, message: 'Settings updated successfully.' });
    } catch (txErr) {
      (await (async () => {
         let args = ['ROLLBACK'];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      throw txErr;
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Download SQLite database backup file
async function downloadDbBackup(req, res) {
  try {
    const dbPath = path.join(__dirname, '..', 'database.db');
    res.download(dbPath, `AkshayaHostel_Backup_${new Date().toISOString().split('T')[0]}.db`);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getStats,
  getStudentsList,
  updatePaymentStatus,
  getFilterOptions,
  addStudent,
  editStudent,
  deleteStudent,
  getSettings,
  updateSettings,
  downloadDbBackup
};
