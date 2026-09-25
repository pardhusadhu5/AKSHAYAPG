const { getDb } = require('../config/db');
const bcrypt = require('bcryptjs');
const path = require('path');

async function getStats(req, res) {
  try {
    const db = await getDb();
    
    // 1. Total Students
    const { rows: totalStudRows } = await db.query("SELECT COUNT(*) as count FROM students");
    const totalStudents = parseInt(totalStudRows[0]?.count || 0);

    // 2. Active Students
    const { rows: activeStudRows } = await db.query("SELECT COUNT(*) as count FROM students WHERE status = 'active'");
    const activeStudents = parseInt(activeStudRows[0]?.count || 0);

    // 3. Total Rooms
    const { rows: totalRoomsRows } = await db.query("SELECT COUNT(*) as count FROM rooms");
    const totalRooms = parseInt(totalRoomsRows[0]?.count || 0);

    // 4. Total Beds
    const { rows: totalBedsRows } = await db.query("SELECT COUNT(*) as count FROM beds");
    const totalBeds = parseInt(totalBedsRows[0]?.count || 0);

    // 5. Occupied Beds
    const { rows: occBedsRows } = await db.query("SELECT COUNT(*) as count FROM beds WHERE status = 'occupied'");
    const occupiedBeds = parseInt(occBedsRows[0]?.count || 0);

    // 6. Available Beds (Vacant)
    const { rows: vacantBedsRows } = await db.query("SELECT COUNT(*) as count FROM beds WHERE status = 'vacant'");
    const vacantBeds = parseInt(vacantBedsRows[0]?.count || 0);

    // 7. Maintenance Beds
    const { rows: maintBedsRows } = await db.query("SELECT COUNT(*) as count FROM beds WHERE status = 'maintenance'");
    const maintenanceBeds = parseInt(maintBedsRows[0]?.count || 0);

    // 8. Monthly Collections
    const { rows: incomeRows } = await db.query("SELECT SUM(monthlyRent) as sum FROM students WHERE status = 'active' AND paymentStatus = 'paid'");
    const monthlyIncome = parseFloat(incomeRows[0]?.sum || 0);

    // 9. Pending Payments
    const { rows: pendingRows } = await db.query("SELECT SUM(monthlyRent) as sum FROM students WHERE status = 'active' AND paymentStatus = 'unpaid'");
    const pendingPayments = parseFloat(pendingRows[0]?.sum || 0);

    // 10. New Registrations
    const { rows: newRegRows } = await db.query("SELECT COUNT(*) as count FROM students");
    const newRegistrations = parseInt(newRegRows[0]?.count || 0);

    // 11. Recent Admissions
    const { rows: recentStudents } = await db.query(`
      SELECT s.*, r.roomNumber, b.bedNumber, b.bedLabel
      FROM students s 
      LEFT JOIN rooms r ON s.roomId = r.id 
      LEFT JOIN beds b ON s.bedId = b.id 
      ORDER BY s.id DESC 
      LIMIT 5
    `);

    // 12. Pending Payments List
    const { rows: pendingPaymentsList } = await db.query(`
      SELECT s.*, r.roomNumber, b.bedNumber, b.bedLabel
      FROM students s 
      LEFT JOIN rooms r ON s.roomId = r.id 
      LEFT JOIN beds b ON s.bedId = b.id 
      WHERE s.paymentStatus = 'unpaid' 
      ORDER BY s.id DESC
    `);

    // 13. Room-wise Bed Occupancy Progress rates
    const { rows: roomOccupancy } = await db.query(`
      SELECT r.id, r.roomNumber, r.capacity, 
        (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupied
      FROM rooms r 
      ORDER BY r.roomNumber ASC
    `);

    // 14. Chart Data Counts
    const { rows: paidCountRows } = await db.query("SELECT COUNT(*) as count FROM students WHERE paymentStatus = 'paid'");
    const { rows: unpaidCountRows } = await db.query("SELECT COUNT(*) as count FROM students WHERE paymentStatus = 'unpaid'");
    const paidCount = parseInt(paidCountRows[0]?.count || 0);
    const unpaidCount = parseInt(unpaidCountRows[0]?.count || 0);

    // Dynamic Activity Logs
    const dynamicActivities = [];
    const { rows: recentAdms } = await db.query("SELECT studentName, studentCustomId, joinDate, roomId FROM students ORDER BY id DESC LIMIT 5");
    recentAdms.forEach((adm, idx) => {
      const roomStr = adm.roomId ? `assigned to room` : `registered`;
      dynamicActivities.push({
        id: idx + 1,
        type: 'admission',
        desc: `${adm.studentName} (${adm.studentCustomId || 'Student'}) ${roomStr} on ${adm.joinDate}.`,
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
        totalBeds,
        occupiedBeds,
        vacantBeds,
        maintenanceBeds,
        monthlyIncome,
        pendingPayments,
        newRegistrations,
        recentActivity: dynamicActivities
      },
      recentStudents,
      pendingPayments: pendingPaymentsList,
      roomOccupancy,
      chartData: {
        occupancy: { occupied: occupiedBeds, vacant: vacantBeds, maintenance: maintenanceBeds },
        payment: { paid: paidCount, unpaid: unpaidCount },
        revenue: {
          labels: ['Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026'],
          data: [10500, 10500, 19000, 19000, 26000, 45000, monthlyIncome]
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
      SELECT s.*, u.email, r.roomNumber, r.floor, r.block, b.bedNumber, b.bedLabel
      FROM students s
      JOIN users u ON s.userId = u.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE 1=1
    `;
    const params = [];
    
    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      query += ` AND (
        s.studentName ILIKE $${idx} OR 
        s.studentCustomId ILIKE $${idx} OR 
        s.phone ILIKE $${idx} OR 
        s.aadhaarNumber ILIKE $${idx} OR 
        s.collegeName ILIKE $${idx} OR 
        r.roomNumber ILIKE $${idx} OR
        u.email ILIKE $${idx} OR
        CAST(s.id AS TEXT) ILIKE $${idx}
      )`;
    }

    if (paymentStatus && paymentStatus !== 'all') {
      params.push(paymentStatus);
      query += ` AND s.paymentStatus = $${params.length}`;
    }

    if (roomId && roomId !== 'all') {
      params.push(parseInt(roomId));
      query += ` AND s.roomId = $${params.length}`;
    }

    if (collegeName && collegeName !== 'all') {
      params.push(collegeName);
      query += ` AND s.collegeName = $${params.length}`;
    }

    if (year && year !== 'all') {
      params.push(year);
      query += ` AND s.year = $${params.length}`;
    }

    query += ` ORDER BY s.id ASC`;
    
    const { rows: list } = await db.query(query, params);
    res.status(200).json({ success: true, students: list });
  } catch (err) {
    console.error('Students List Fetch Error:', err);
    res.status(500).json({ success: false, message: `Failed to fetch students list: ${err.message}` });
  }
}

async function getStudentDetails(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows: students } = await db.query(`
      SELECT s.*, u.email, r.roomNumber, r.floor, r.block, r.roomType, b.bedNumber, b.bedLabel
      FROM students s
      JOIN users u ON s.userId = u.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE s.id = $1 OR s.studentCustomId = $1
    `, [id]);

    const student = students[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    // Get payment history
    const { rows: payments } = await db.query(`
      SELECT p.*, ph.paymentDate, ph.paymentMode, ph.referenceNumber, ph.notes
      FROM payments p
      LEFT JOIN paymentHistory ph ON ph.paymentId = p.id
      WHERE p.studentId = $1
      ORDER BY p.id DESC
    `, [student.id]);

    res.status(200).json({ success: true, student, payments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
    const { rowCount } = await db.query(
      'UPDATE students SET paymentStatus = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2',
      [paymentStatus, id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    res.status(200).json({ success: true, message: 'Payment status updated successfully.' });
  } catch (err) {
    console.error('Update Payment Error:', err);
    res.status(500).json({ success: false, message: `Failed to update payment status: ${err.message}` });
  }
}

// Fetch helper list of colleges and rooms for search filter options
async function getFilterOptions(req, res) {
  try {
    const db = await getDb();
    const { rows: colleges } = await db.query("SELECT DISTINCT collegeName FROM students WHERE collegeName IS NOT NULL AND collegeName != ''");
    const { rows: rooms } = await db.query("SELECT id, roomNumber, floor, block, capacity, monthlyFee FROM rooms ORDER BY roomNumber ASC");
    res.status(200).json({
      success: true,
      colleges: colleges.map(c => c.collegename || c.collegeName),
      rooms
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function addStudent(req, res) {
  try {
    const {
      studentName, studentCustomId, email, phone, parentName, parentPhone, emergencyContact,
      aadhaarNumber, dateOfBirth, gender, collegeName, course, year, address, joinDate,
      monthlyRent, depositAmount, password, roomId, bedId
    } = req.body;

    const studentPhone = phone || req.body.studentMobile;
    const studentPassword = password || 'Akshaya@123';

    if (!studentName || !studentPhone) {
      return res.status(400).json({ success: false, message: 'Student name and phone number are required.' });
    }

    const db = await getDb();

    // Check duplicate studentCustomId if provided
    let customId = studentCustomId;
    if (customId && customId.trim() !== '') {
      const { rows: dupId } = await db.query('SELECT * FROM students WHERE studentCustomId = $1', [customId.trim()]);
      if (dupId[0]) {
        return res.status(400).json({ success: false, message: `Student ID "${customId}" is already registered. Must be unique.` });
      }
    } else {
      // Auto-generate AKS...
      const { rows: maxRows } = await db.query("SELECT MAX(id) as maxid FROM students");
      const nextNum = (parseInt(maxRows[0]?.maxid || 0) + 1).toString().padStart(3, '0');
      customId = `AKS2026${nextNum}`;
    }

    // Check duplicate phone
    const { rows: dupPhone } = await db.query('SELECT * FROM users WHERE phone = $1', [studentPhone.trim()]);
    if (dupPhone[0]) {
      return res.status(400).json({ success: false, message: `Mobile number "${studentPhone}" is already registered. Must be unique.` });
    }

    // Check duplicate email if provided
    let userEmail = email ? email.trim() : `${customId.toLowerCase()}@akshayapg.local`;
    if (email && email.trim() !== '') {
      const { rows: dupEmail } = await db.query('SELECT * FROM users WHERE email = $1', [email.trim()]);
      if (dupEmail[0]) {
        return res.status(400).json({ success: false, message: `Email "${email}" is already registered. Must be unique.` });
      }
    }

    // Check duplicate Aadhaar if provided
    if (aadhaarNumber && aadhaarNumber.trim() !== '') {
      const { rows: dupAadhaar } = await db.query('SELECT * FROM students WHERE aadhaarNumber = $1', [aadhaarNumber.trim()]);
      if (dupAadhaar[0]) {
        return res.status(400).json({ success: false, message: `Aadhaar number "${aadhaarNumber}" is already registered. Must be unique.` });
      }
    }

    // If room & bed provided, check bed status
    let targetRoomId = roomId ? parseInt(roomId) : null;
    let targetBedId = bedId ? parseInt(bedId) : null;
    let rentFee = monthlyRent ? parseFloat(monthlyRent) : 8500;

    if (targetRoomId && targetBedId) {
      const { rows: bedCheck } = await db.query('SELECT status FROM beds WHERE id = $1 AND roomId = $2', [targetBedId, targetRoomId]);
      if (!bedCheck[0]) {
        return res.status(400).json({ success: false, message: 'Selected bed does not exist in the room.' });
      }
      if (bedCheck[0].status !== 'vacant') {
        return res.status(400).json({ success: false, message: 'Selected bed is already occupied or under maintenance.' });
      }
      
      const { rows: roomCheck } = await db.query('SELECT monthlyFee FROM rooms WHERE id = $1', [targetRoomId]);
      if (roomCheck[0]) {
        rentFee = parseFloat(roomCheck[0].monthlyFee);
      }
    }

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

    const hashedPassword = await bcrypt.hash(studentPassword, 10);

    await db.query('BEGIN');
    try {
      // 1. Insert User
      const { rows: userResult } = await db.query(
        `INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [studentName.trim(), userEmail, studentPhone.trim(), hashedPassword, 'student']
      );
      const userId = userResult[0].id;

      // 2. Insert Student
      const { rows: studentResult } = await db.query(
        `INSERT INTO students (
          userId, studentCustomId, studentName, phone, parentName, parentPhone, emergencyContact,
          aadhaarNumber, dateOfBirth, gender, collegeName, course, year, address, joinDate,
          monthlyRent, depositAmount, photo, idProof, roomId, bedId, status, paymentStatus
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 'active', 'unpaid') RETURNING id`,
        [
          userId,
          customId,
          studentName.trim(),
          studentPhone.trim(),
          parentName ? parentName.trim() : '',
          parentPhone ? parentPhone.trim() : '',
          emergencyContact ? emergencyContact.trim() : (parentPhone ? parentPhone.trim() : ''),
          aadhaarNumber ? aadhaarNumber.trim() : null,
          dateOfBirth || null,
          gender || 'Male',
          collegeName ? collegeName.trim() : 'Aurora Deemed University',
          course ? course.trim() : 'B.Tech',
          year ? year.trim() : '1st Year',
          address ? address.trim() : 'Hyderabad, Telangana',
          joinDate || new Date().toISOString().split('T')[0],
          rentFee,
          depositAmount ? parseFloat(depositAmount) : 8500,
          photoPath,
          idProofPath,
          targetRoomId,
          targetBedId
        ]
      );
      const studentId = studentResult[0].id;

      // 3. Occupy Bed if assigned
      if (targetRoomId && targetBedId) {
        await db.query(`UPDATE beds SET status = 'occupied', userId = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2`, [userId, targetBedId]);
        await db.query(`INSERT INTO allocations (studentId, roomId, bedId, status) VALUES ($1, $2, $3, $4)`, [studentId, targetRoomId, targetBedId, 'active']);
      }

      // 4. Create Notification
      await db.query(`INSERT INTO notifications (type, message) VALUES ($1, $2)`, ['new_student', `New student registered: ${studentName} (${customId}).`]);

      await db.query('COMMIT');
      res.status(201).json({
        success: true,
        message: `Student ${studentName} (${customId}) registered successfully.`,
        studentId,
        student: { id: studentId, studentCustomId: customId, name: studentName }
      });
    } catch (txErr) {
      await db.query('ROLLBACK');
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
      studentName, studentCustomId, email, phone, parentName, parentPhone, emergencyContact,
      aadhaarNumber, dateOfBirth, gender, collegeName, course, year, address, joinDate,
      monthlyRent, depositAmount, status
    } = req.body;

    const db = await getDb();

    const { rows: studentRows } = await db.query('SELECT * FROM students WHERE id = $1', [id]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Verify custom ID collision if changed
    if (studentCustomId && studentCustomId.trim() !== student.studentCustomId) {
      const { rows: dupId } = await db.query('SELECT * FROM students WHERE studentCustomId = $1 AND id != $2', [studentCustomId.trim(), id]);
      if (dupId[0]) {
        return res.status(400).json({ success: false, message: `Student ID "${studentCustomId}" is already in use by another student.` });
      }
    }

    // Verify phone collision if changed
    if (phone && phone.trim() !== student.phone) {
      const { rows: dupPhone } = await db.query('SELECT * FROM users WHERE phone = $1 AND id != $2', [phone.trim(), student.userId]);
      if (dupPhone[0]) {
        return res.status(400).json({ success: false, message: `Phone number "${phone}" is already registered by another account.` });
      }
    }

    // Verify email collision if changed
    if (email && email.trim() !== '') {
      const { rows: dupEmail } = await db.query('SELECT * FROM users WHERE email = $1 AND id != $2', [email.trim(), student.userId]);
      if (dupEmail[0]) {
        return res.status(400).json({ success: false, message: `Email "${email}" is already registered by another account.` });
      }
    }

    // Verify Aadhaar collision if changed
    if (aadhaarNumber && aadhaarNumber.trim() !== '' && aadhaarNumber.trim() !== student.aadhaarNumber) {
      const { rows: dupAadhaar } = await db.query('SELECT * FROM students WHERE aadhaarNumber = $1 AND id != $2', [aadhaarNumber.trim(), id]);
      if (dupAadhaar[0]) {
        return res.status(400).json({ success: false, message: `Aadhaar number "${aadhaarNumber}" is already registered.` });
      }
    }

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

    await db.query('BEGIN');
    try {
      // Update User
      await db.query(
        `UPDATE users SET name = $1, email = $2, phone = $3, updatedAt = CURRENT_TIMESTAMP WHERE id = $4`,
        [studentName.trim(), email ? email.trim() : student.email, phone ? phone.trim() : student.phone, student.userId]
      );

      // Update Student
      await db.query(
        `UPDATE students 
         SET studentCustomId = $1, studentName = $2, phone = $3, parentName = $4, parentPhone = $5,
             emergencyContact = $6, aadhaarNumber = $7, dateOfBirth = $8, gender = $9,
             collegeName = $10, course = $11, year = $12, address = $13, joinDate = $14, 
             monthlyRent = $15, depositAmount = $16, photo = $17, idProof = $18, status = $19,
             updatedAt = CURRENT_TIMESTAMP 
         WHERE id = $20`,
        [
          studentCustomId ? studentCustomId.trim() : student.studentCustomId,
          studentName.trim(),
          phone ? phone.trim() : student.phone,
          parentName ? parentName.trim() : student.parentName,
          parentPhone ? parentPhone.trim() : student.parentPhone,
          emergencyContact ? emergencyContact.trim() : student.emergencyContact,
          aadhaarNumber ? aadhaarNumber.trim() : student.aadhaarNumber,
          dateOfBirth || student.dateOfBirth,
          gender || student.gender,
          collegeName ? collegeName.trim() : student.collegeName,
          course ? course.trim() : student.course,
          year ? year.trim() : student.year,
          address ? address.trim() : student.address,
          joinDate || student.joinDate,
          monthlyRent ? parseFloat(monthlyRent) : student.monthlyRent,
          depositAmount ? parseFloat(depositAmount) : student.depositAmount,
          photoPath,
          idProofPath,
          status || student.status,
          id
        ]
      );

      await db.query('COMMIT');
      res.status(200).json({ success: true, message: 'Student details updated successfully.' });
    } catch (txErr) {
      await db.query('ROLLBACK');
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

    const { rows: studentRows } = await db.query('SELECT * FROM students WHERE id = $1', [id]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    await db.query('BEGIN');
    try {
      // 1. Vacate Bed if assigned
      if (student.bedId) {
        await db.query(`UPDATE beds SET status = 'vacant', userId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = $1`, [student.bedId]);
        await db.query(`UPDATE allocations SET vacatedAt = CURRENT_TIMESTAMP, status = 'vacated' WHERE studentId = $1 AND status = 'active'`, [id]);
      }

      // 2. Delete Student record
      await db.query('DELETE FROM students WHERE id = $1', [id]);

      // 3. Delete corresponding User record
      await db.query('DELETE FROM users WHERE id = $1', [student.userId]);

      await db.query('COMMIT');
      res.status(200).json({ success: true, message: `Student ${student.studentName} deleted successfully.` });
    } catch (txErr) {
      await db.query('ROLLBACK');
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
    const { rows } = await db.query('SELECT * FROM hostelSettings');
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

    await db.query('BEGIN');
    try {
      for (const [key, value] of Object.entries(settings)) {
        await db.query(
          `INSERT INTO hostelSettings (key, value) VALUES ($1, $2) 
           ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value]
        );
      }
      await db.query('COMMIT');
      res.status(200).json({ success: true, message: 'Settings updated successfully.' });
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Download database backup file
async function downloadDbBackup(req, res) {
  try {
    const dbPath = path.join(__dirname, '..', 'database.db');
    res.download(dbPath, `AkshayaHostel_Backup_${new Date().toISOString().split('T')[0]}.db`);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getApplications(req, res) {
  try {
    const { status } = req.query;
    const db = await getDb();
    
    let query = `
      SELECT s.*, u.email, r.roomNumber, b.bedNumber, b.bedLabel
      FROM students s
      JOIN users u ON s.userId = u.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      params.push(status.toUpperCase());
      query += ` AND UPPER(s.applicationStatus) = $${params.length}`;
    }

    query += ` ORDER BY s.id ASC`;

    const { rows: applications } = await db.query(query, params);
    const normalizedApps = applications.map(app => ({
      ...app,
      applicationStatus: app.applicationstatus || app.applicationStatus,
      applicationId: app.applicationid || app.applicationId,
      studentName: app.studentname || app.studentName,
      studentCustomId: app.studentcustomid || app.studentCustomId,
      parentName: app.parentname || app.parentName,
      parentPhone: app.parentphone || app.parentPhone,
      collegeName: app.collegename || app.collegeName,
      preferredRoomType: app.preferredroomtype || app.preferredRoomType,
      stayDuration: app.stayduration || app.stayDuration,
      monthlyRent: app.monthlyrent || app.monthlyRent,
      depositAmount: app.depositamount || app.depositAmount,
      rejectionReason: app.rejectionreason || app.rejectionReason,
      correctionReason: app.correctionreason || app.correctionReason,
      aadhaarNumber: app.aadhaarnumber || app.aadhaarNumber,
      dateOfBirth: app.dateofbirth || app.dateOfBirth,
      emergencyContact: app.emergencycontact || app.emergencyContact,
      rollNumber: app.rollnumber || app.rollNumber,
      roomNumber: app.roomnumber || app.roomNumber,
      bedNumber: app.bednumber || app.bedNumber,
      bedLabel: app.bedlabel || app.bedLabel
    }));
    res.status(200).json({ success: true, applications: normalizedApps });
  } catch (err) {
    console.error('Get Applications Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function reviewApplication(req, res) {
  try {
    const { id } = req.params;
    const { action, reason, admissionFee } = req.body;

    if (!['APPROVE', 'REJECT', 'REQUEST_CORRECTION'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be APPROVE, REJECT, or REQUEST_CORRECTION.' });
    }

    const db = await getDb();
    const { rows: students } = await db.query('SELECT * FROM students WHERE id = $1', [id]);
    const student = students[0];

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student application record not found.' });
    }

    let targetAppStatus = 'PENDING';
    let rejectionReason = null;
    let correctionReason = null;

    if (action === 'APPROVE') {
      targetAppStatus = 'APPROVED';
      const feeAmount = admissionFee ? parseFloat(admissionFee) : (parseFloat(student.monthlyRent) || 8500);

      // Check if admission invoice already generated in payments table
      const { rows: existingFee } = await db.query(
        "SELECT id FROM payments WHERE studentId = $1 AND billingMonth = 'ADMISSION'",
        [id]
      );

      if (existingFee.length === 0) {
        await db.query(
          `INSERT INTO payments (studentId, billingMonth, amountDue, amountPaid, status) VALUES ($1, $2, $3, 0, 'pending')`,
          [id, 'ADMISSION', feeAmount]
        );
      }

      await db.query(
        `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
        ['application_approved', `Application ${student.applicationId || student.id} approved for ${student.studentName}. Initial fee invoice generated.`]
      );
    } else if (action === 'REJECT') {
      targetAppStatus = 'REJECTED';
      rejectionReason = reason || 'Application rejected by hostel administration.';
      await db.query(
        `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
        ['application_rejected', `Application ${student.applicationId || student.id} rejected for ${student.studentName}.`]
      );
    } else if (action === 'REQUEST_CORRECTION') {
      targetAppStatus = 'CORRECTION_REQUIRED';
      correctionReason = reason || 'Please review and update your application details.';
      await db.query(
        `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
        ['application_correction', `Correction requested for application ${student.applicationId || student.id} (${student.studentName}).`]
      );
    }

    await db.query(
      `UPDATE students 
       SET applicationStatus = $1, rejectionReason = $2, correctionReason = $3, updatedAt = CURRENT_TIMESTAMP 
       WHERE id = $4`,
      [targetAppStatus, rejectionReason, correctionReason, id]
    );

    res.status(200).json({
      success: true,
      message: `Application status updated to ${targetAppStatus}.`,
      applicationStatus: targetAppStatus
    });
  } catch (err) {
    console.error('Review Application Error:', err);
    res.status(500).json({ success: false, message: `Failed to review application: ${err.message}` });
  }
}

module.exports = {
  getStats,
  getStudentsList,
  getStudentDetails,
  updatePaymentStatus,
  getFilterOptions,
  addStudent,
  editStudent,
  deleteStudent,
  getSettings,
  updateSettings,
  downloadDbBackup,
  getApplications,
  reviewApplication
};
