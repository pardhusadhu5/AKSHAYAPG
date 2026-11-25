const { getDb } = require('../config/db');
const bcrypt = require('bcryptjs');
const path = require('path');
const { addAdminClient, broadcastAdminEvent } = require('../services/realtimeService');
const { sendWelcomeWhatsApp } = require('../services/whatsappService');

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
      LEFT JOIN users u ON s.userId = u.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE 1=1
    `;
    const params = [];
    
    if (search && search.trim() !== '') {
      const cleanTerm = search.trim();
      params.push(`%${cleanTerm}%`);
      const idx = params.length;
      query += ` AND (
        s.studentName ILIKE $${idx} OR 
        s.studentCustomId ILIKE $${idx} OR 
        s.phone ILIKE $${idx} OR 
        s.aadhaarNumber ILIKE $${idx} OR 
        s.collegeName ILIKE $${idx} OR 
        s.applicationId ILIKE $${idx} OR
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

    query += ` ORDER BY COALESCE(s.submittedAt, s.createdAt) DESC, s.id DESC`;
    
    const { rows: list } = await db.query(query, params);
    const normalizedStudents = list.map(s => {
      const bNum = s.bednumber || s.bedNumber;
      const bLabel = s.bedlabel || s.bedLabel || (bNum ? `Bed ${bNum}` : null);
      const rNum = s.roomnumber || s.roomNumber;
      return {
        ...s,
        id: s.id,
        userId: s.userid || s.userId,
        studentName: s.studentname || s.studentName || `Student #${s.id}`,
        studentCustomId: s.studentcustomid || s.studentCustomId || `AKS${String(s.id).padStart(6, '0')}`,
        phone: s.phone || '',
        email: s.email || '',
        parentName: s.parentname || s.parentName || '',
        parentPhone: s.parentphone || s.parentPhone || '',
        aadhaarNumber: s.aadhaarnumber || s.aadhaarNumber || '',
        collegeName: s.collegename || s.collegeName || '',
        course: s.course || '',
        year: s.year || '',
        branch: s.branch || '',
        roomId: s.roomid || s.roomId || null,
        bedId: s.bedid || s.bedId || null,
        roomNumber: rNum || null,
        floor: s.floor || null,
        block: s.block || null,
        bedNumber: bNum || null,
        bedLabel: bLabel,
        monthlyRent: parseFloat(s.monthlyrent || s.monthlyRent || 0),
        depositAmount: parseFloat(s.depositamount || s.depositAmount || 0),
        paymentStatus: s.paymentstatus || s.paymentStatus || 'unpaid',
        status: s.status || 'active',
        applicationStatus: s.applicationstatus || s.applicationStatus || 'PENDING',
        stayStatus: s.staystatus || s.stayStatus || (s.roomid || s.roomId ? 'CHECKED_IN' : 'NOT_CHECKED_IN'),
        checkInDate: s.checkindate ? (typeof s.checkindate === 'string' ? s.checkindate.split('T')[0] : new Date(s.checkindate).toISOString().split('T')[0]) : null,
        checkOutDate: s.checkoutdate ? (typeof s.checkoutdate === 'string' ? s.checkoutdate.split('T')[0] : new Date(s.checkoutdate).toISOString().split('T')[0]) : null,
        expectedCheckOutDate: s.expectedcheckoutdate ? (typeof s.expectedcheckoutdate === 'string' ? s.expectedcheckoutdate.split('T')[0] : new Date(s.expectedcheckoutdate).toISOString().split('T')[0]) : null,
        joinDate: s.joindate ? (typeof s.joindate === 'string' ? s.joindate.split('T')[0] : new Date(s.joindate).toISOString().split('T')[0]) : '—'
      };
    });
    res.status(200).json({ success: true, students: normalizedStudents });
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
      LEFT JOIN users u ON s.userId = u.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE CAST(s.id AS TEXT) = $1 OR s.studentCustomId = $1
    `, [String(id).trim()]);

    const rawStudent = students[0];
    if (!rawStudent) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    const bNum = rawStudent.bednumber || rawStudent.bedNumber;
    const bLabel = rawStudent.bedlabel || rawStudent.bedLabel || (bNum ? `Bed ${bNum}` : null);
    const rNum = rawStudent.roomnumber || rawStudent.roomNumber;
    const student = {
      ...rawStudent,
      id: rawStudent.id,
      userId: rawStudent.userid || rawStudent.userId,
      studentName: rawStudent.studentname || rawStudent.studentName || `Student #${rawStudent.id}`,
      studentCustomId: rawStudent.studentcustomid || rawStudent.studentCustomId || `AKS${String(rawStudent.id).padStart(6, '0')}`,
      phone: rawStudent.phone || '',
      email: rawStudent.email || '',
      parentName: rawStudent.parentname || rawStudent.parentName || '',
      parentPhone: rawStudent.parentphone || rawStudent.parentPhone || '',
      aadhaarNumber: rawStudent.aadhaarnumber || rawStudent.aadhaarNumber || '',
      collegeName: rawStudent.collegename || rawStudent.collegeName || '',
      course: rawStudent.course || '',
      year: rawStudent.year || '',
      branch: rawStudent.branch || '',
      roomId: rawStudent.roomid || rawStudent.roomId || null,
      bedId: rawStudent.bedid || rawStudent.bedId || null,
      roomNumber: rNum || null,
      floor: rawStudent.floor || null,
      block: rawStudent.block || null,
      bedNumber: bNum || null,
      bedLabel: bLabel,
      monthlyRent: parseFloat(rawStudent.monthlyrent || rawStudent.monthlyRent || 0),
      depositAmount: parseFloat(rawStudent.depositamount || rawStudent.depositAmount || 0),
      depositStatus: rawStudent.depositstatus || rawStudent.depositStatus || 'HELD',
      depositRefundedAmount: parseFloat(rawStudent.depositrefundedamount || rawStudent.depositRefundedAmount || 0),
      depositDeductionsAmount: parseFloat(rawStudent.depositdeductionsamount || rawStudent.depositDeductionsAmount || 0),
      paymentStatus: rawStudent.paymentstatus || rawStudent.paymentStatus || 'unpaid',
      status: rawStudent.status || 'active',
      applicationStatus: rawStudent.applicationstatus || rawStudent.applicationStatus || 'PENDING',
      stayStatus: rawStudent.staystatus || rawStudent.stayStatus || (rawStudent.roomid || rawStudent.roomId ? 'CHECKED_IN' : 'NOT_CHECKED_IN'),
      checkInDate: rawStudent.checkindate ? (typeof rawStudent.checkindate === 'string' ? rawStudent.checkindate.split('T')[0] : new Date(rawStudent.checkindate).toISOString().split('T')[0]) : null,
      checkOutDate: rawStudent.checkoutdate ? (typeof rawStudent.checkoutdate === 'string' ? rawStudent.checkoutdate.split('T')[0] : new Date(rawStudent.checkoutdate).toISOString().split('T')[0]) : null,
      expectedCheckOutDate: rawStudent.expectedcheckoutdate ? (typeof rawStudent.expectedcheckoutdate === 'string' ? rawStudent.expectedcheckoutdate.split('T')[0] : new Date(rawStudent.expectedcheckoutdate).toISOString().split('T')[0]) : null,
      checkInRemarks: rawStudent.checkinremarks || rawStudent.checkInRemarks || '',
      checkOutReason: rawStudent.checkoutreason || rawStudent.checkOutReason || '',
      checkOutRemarks: rawStudent.checkoutremarks || rawStudent.checkOutRemarks || '',
      joinDate: rawStudent.joindate ? (typeof rawStudent.joindate === 'string' ? rawStudent.joindate.split('T')[0] : new Date(rawStudent.joindate).toISOString().split('T')[0]) : '—'
    };

    // Get payment history
    const { rows: payments } = await db.query(`
      SELECT p.*, ph.paymentDate, ph.paymentMode, ph.referenceNumber, ph.notes
      FROM payments p
      LEFT JOIN paymentHistory ph ON ph.paymentId = p.id
      WHERE p.studentId = $1
      ORDER BY p.id DESC
    `, [student.id]);

    // Get stay history
    const { rows: stayHistory } = await db.query(`
      SELECT sh.*, r.roomNumber, r.floor, r.block, b.bedLabel, b.bedNumber
      FROM stay_history sh
      LEFT JOIN rooms r ON sh.roomId = r.id
      LEFT JOIN beds b ON sh.bedId = b.id
      WHERE sh.studentId = $1
      ORDER BY sh.id DESC
    `, [student.id]);

    // Get settlements
    const { rows: settlements } = await db.query(`
      SELECT st.*
      FROM settlements st
      WHERE st.studentId = $1
      ORDER BY st.id DESC
    `, [student.id]);

    // Get security deposits (Phase 4)
    const { rows: securityDeposits } = await db.query(`
      SELECT sd.*, st.settlementNumber
      FROM security_deposits sd
      LEFT JOIN settlements st ON sd.settlementId = st.id
      WHERE sd.studentId = $1
      ORDER BY sd.transactionDate DESC, sd.id DESC
    `, [student.id]);

    res.status(200).json({ success: true, student, payments, stayHistory, settlements, securityDeposits });
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

    // Keep payments table in sync with student payment status toggle
    if (paymentStatus === 'paid') {
      await db.query(
        "UPDATE payments SET status = 'paid', amountPaid = amountDue, paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE studentId = $1 AND status != 'paid'",
        [id]
      );
    } else {
      await db.query(
        "UPDATE payments SET status = 'pending', amountPaid = 0, paidAt = NULL, updatedAt = CURRENT_TIMESTAMP WHERE studentId = $1 AND status = 'paid'",
        [id]
      );
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
        photoPath = req.files.photo[0].path;
      }
      if (req.files.idProof && req.files.idProof[0]) {
        idProofPath = req.files.idProof[0].path;
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
        photoPath = req.files.photo[0].path;
      }
      if (req.files.idProof && req.files.idProof[0]) {
        idProofPath = req.files.idProof[0].path;
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

function subscribeAdminEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });
  addAdminClient(res, req);
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

    // Order descending by submission timestamp, fallback to createdAt, then ID
    query += ` ORDER BY COALESCE(s.submittedAt, s.createdAt) DESC, s.id DESC`;

    const { rows: applications } = await db.query(query, params);
    const normalizedApps = applications.map(app => {
      const bNum = app.bednumber || app.bedNumber;
      const bLabel = app.bedlabel || app.bedLabel || (bNum ? `Bed ${bNum}` : null);
      const rNum = app.roomnumber || app.roomNumber;
      return {
        ...app,
        id: app.id,
        userId: app.userid || app.userId,
        applicationStatus: (app.applicationstatus || app.applicationStatus || 'PENDING').toUpperCase(),
        applicationId: app.applicationid || app.applicationId || `AKS-APP-${app.id}`,
        studentName: app.studentname || app.studentName || 'N/A',
        studentCustomId: app.studentcustomid || app.studentCustomId || `AKS${String(app.id).padStart(6, '0')}`,
        phone: app.phone || 'N/A',
        email: app.email || '',
        parentName: app.parentname || app.parentName || '',
        parentPhone: app.parentphone || app.parentPhone || '',
        collegeName: app.collegename || app.collegeName || 'N/A',
        course: app.course || '',
        year: app.year || '',
        branch: app.branch || '',
        preferredRoomType: app.preferredroomtype || app.preferredRoomType || app.preferredsharingtype || app.preferredSharingType || '3 Sharing',
        preferredFloor: app.preferredfloor || app.preferredFloor || '',
        foodPreference: app.foodpreference || app.foodPreference || '',
        stayDuration: app.stayduration || app.stayDuration || '',
        monthlyRent: parseFloat(app.monthlyrent || app.monthlyRent || 0),
        depositAmount: parseFloat(app.depositamount || app.depositAmount || 0),
        rejectionReason: app.rejectionreason || app.rejectionReason,
        correctionReason: app.correctionreason || app.correctionReason,
        aadhaarNumber: app.aadhaarnumber || app.aadhaarNumber,
        dateOfBirth: app.dateofbirth || app.dateOfBirth,
        emergencyContact: app.emergencycontact || app.emergencyContact,
        rollNumber: app.rollnumber || app.rollNumber,
        roomId: app.roomid || app.roomId || null,
        bedId: app.bedid || app.bedId || null,
        roomNumber: rNum,
        bedNumber: bNum,
        bedLabel: bLabel,
        stayStatus: app.staystatus || app.stayStatus || (app.roomid || app.roomId ? 'CHECKED_IN' : 'NOT_CHECKED_IN'),
        checkInDate: app.checkindate || app.checkInDate || null,
        checkOutDate: app.checkoutdate || app.checkOutDate || null,
        submittedAt: app.submittedat || app.submittedAt || app.createdat || app.createdAt || null,
        createdAt: app.createdat || app.createdAt || null,
        whatsappStatus: app.whatsappstatus || app.whatsappStatus || 'NONE',
        whatsappSentAt: app.whatsappsentat || app.whatsappSentAt,
        whatsappError: app.whatsapperror || app.whatsappError
      };
    });
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
    let targetStudentStatus = student.status || 'APPLICANT';
    let targetUserStatus = 'pending';
    let rejectionReason = null;
    let correctionReason = null;
    let whatsappResult = null;

    if (action === 'APPROVE') {
      targetAppStatus = 'APPROVED';
      targetStudentStatus = 'active';
      targetUserStatus = 'active';
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

      // Send WhatsApp welcome message (safe async, non-blocking)
      try {
        whatsappResult = await sendWelcomeWhatsApp({
          ...student,
          applicationStatus: 'APPROVED'
        });
      } catch (waErr) {
        console.error('WhatsApp Welcome Dispatch Error (non-fatal):', waErr);
      }
    } else if (action === 'REJECT') {
      targetAppStatus = 'REJECTED';
      targetStudentStatus = 'inactive';
      targetUserStatus = 'rejected';
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

    // Update students table
    await db.query(
      `UPDATE students 
       SET applicationStatus = $1, status = $2, rejectionReason = $3, correctionReason = $4, updatedAt = CURRENT_TIMESTAMP 
       WHERE id = $5`,
      [targetAppStatus, targetStudentStatus, rejectionReason, correctionReason, id]
    );

    // Update users table to permit/block Student Portal login access
    const targetUserId = student.userid || student.userId;
    if (targetUserId && (action === 'APPROVE' || action === 'REJECT')) {
      await db.query(
        `UPDATE users SET status = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2`,
        [targetUserStatus, targetUserId]
      );
    }

    // Broadcast real-time SSE update to all connected admin dashboards
    try {
      broadcastAdminEvent('application_updated', {
        id: parseInt(id),
        applicationId: student.applicationId || student.studentCustomId || `AKS-APP-${id}`,
        studentName: student.studentName,
        phone: student.phone,
        applicationStatus: targetAppStatus,
        whatsappStatus: whatsappResult ? whatsappResult.status : student.whatsappStatus || 'NONE',
        updatedAt: new Date().toISOString()
      });
    } catch (sseErr) {
      console.warn('Realtime update broadcast error (non-fatal):', sseErr);
    }

    res.status(200).json({
      success: true,
      message: `Application status updated to ${targetAppStatus}.`,
      applicationStatus: targetAppStatus,
      whatsapp: whatsappResult
    });
  } catch (err) {
    console.error('Review Application Error:', err);
    res.status(500).json({ success: false, message: `Failed to review application: ${err.message}` });
  }
}

async function getStudentDocuments(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();
    const { rows: docs } = await db.query('SELECT * FROM documents WHERE studentId = $1 ORDER BY id ASC', [id]);
    res.status(200).json({ success: true, documents: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function verifyDocument(req, res) {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body;
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid document status.' });
    }
    const db = await getDb();
    await db.query(
      'UPDATE documents SET verificationStatus = $1, adminRemarks = $2, updatedAt = CURRENT_TIMESTAMP WHERE id = $3',
      [status, remarks || null, id]
    );
    res.status(200).json({ success: true, message: `Document verification status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function allocateRoomToStudent(req, res) {
  try {
    const { id } = req.params;
    const { roomId, bedId } = req.body;

    if (!roomId || !bedId) {
      return res.status(400).json({ success: false, message: 'Room ID and Bed ID are required.' });
    }

    const db = await getDb();
    const { rows: studentRows } = await db.query('SELECT * FROM students WHERE id = $1', [id]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const { rows: bedRows } = await db.query('SELECT * FROM beds WHERE id = $1 AND roomId = $2', [bedId, roomId]);
    const bed = bedRows[0];
    if (!bed) {
      return res.status(404).json({ success: false, message: 'Bed not found in the specified room.' });
    }
    if (bed.status !== 'vacant' && bed.userId !== student.userId) {
      return res.status(400).json({ success: false, message: 'Selected bed is already occupied or under maintenance.' });
    }

    await db.query('BEGIN');

    const studentUserId = student.userid || student.userId;
    const currentBedId = student.bedid || student.bedId;

    // Release any OTHER bed currently held by this student's userId to prevent beds_userid_key violation
    if (studentUserId) {
      await db.query(
        `UPDATE beds SET status = 'vacant', userId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE userId = $1 AND id != $2`,
        [studentUserId, bedId]
      );
    }
    // Also release student.bedId if different
    if (currentBedId && parseInt(currentBedId) !== parseInt(bedId)) {
      await db.query(
        `UPDATE beds SET status = 'vacant', userId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
        [currentBedId]
      );
    }

    // Set target bed to occupied
    await db.query(`UPDATE beds SET status = 'occupied', userId = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2`, [studentUserId, bedId]);

    // Fetch room fee
    const { rows: rRows } = await db.query('SELECT monthlyFee FROM rooms WHERE id = $1', [roomId]);
    const roomFee = rRows[0] ? parseFloat(rRows[0].monthlyfee || rRows[0].monthlyFee || 8500) : 8500;

    await db.query(
      `UPDATE students 
       SET roomId = $1, bedId = $2, monthlyRent = $3, status = 'active', applicationStatus = 'ADMISSION_CONFIRMED', updatedAt = CURRENT_TIMESTAMP 
       WHERE id = $4`,
      [roomId, bedId, roomFee, id]
    );

    if (studentUserId) {
      await db.query(`UPDATE users SET status = 'active', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`, [studentUserId]);
    }

    // Mark previous active allocations as vacated
    await db.query(
      `UPDATE allocations SET status = 'vacated', vacatedAt = CURRENT_TIMESTAMP WHERE studentId = $1 AND status = 'active'`,
      [id]
    );

    await db.query(
      `INSERT INTO allocations (studentId, roomId, bedId, status) VALUES ($1, $2, $3, 'active')`,
      [id, roomId, bedId]
    );

    await db.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Room and bed allocated successfully. Student account is now active.`
    });
  } catch (err) {
    try { const db = await getDb(); await db.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getPasswordResetRequests(req, res) {
  try {
    const db = await getDb();
    const { rows: requests } = await db.query(`
      SELECT pr.*, s.studentName, s.studentCustomId
      FROM password_reset_requests pr
      LEFT JOIN students s ON pr.studentId = s.id
      ORDER BY pr.id DESC
    `);
    res.status(200).json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function adminResetPassword(req, res) {
  try {
    const { id } = req.params;
    const { temporaryPassword } = req.body;

    if (!temporaryPassword || temporaryPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Temporary password must be at least 6 characters long.' });
    }

    const db = await getDb();
    const { rows: studentRows } = await db.query('SELECT userId, studentName, phone FROM students WHERE id = $1', [id]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    await db.query('UPDATE users SET password = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2', [hashedPassword, student.userId]);
    await db.query("UPDATE password_reset_requests SET status = 'RESOLVED' WHERE studentId = $1", [id]);

    res.status(200).json({
      success: true,
      message: `Password for ${student.studentName} updated successfully to: ${temporaryPassword}`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ==========================================
// PHASE 2: STUDENT CHECK-IN & CHECK-OUT MANAGEMENT
// ==========================================

async function checkInStudent(req, res) {
  try {
    const { id } = req.params;
    const { checkInDate, expectedCheckOutDate, stayDuration, remarks } = req.body;
    const db = await getDb();

    const { rows: studentRows } = await db.query(
      `SELECT s.*, r.roomNumber, b.bedLabel, b.bedNumber 
       FROM students s
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE s.id = $1`,
      [id]
    );
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const currentRoomId = student.roomId || student.roomid;
    const currentBedId = student.bedId || student.bedid;

    if (!currentRoomId || !currentBedId) {
      return res.status(400).json({ success: false, message: 'Please allocate a room and bed before checking in.' });
    }

    const effectiveCheckIn = checkInDate ? new Date(checkInDate) : new Date();
    const effectiveExpectedOut = expectedCheckOutDate ? new Date(expectedCheckOutDate) : null;
    const duration = stayDuration ? parseInt(stayDuration) : (student.stayDuration || student.stayduration || 12);
    const checkRemarks = remarks || 'Student checked in to hostel.';

    await db.query('BEGIN');

    // 1. Update Student record
    await db.query(
      `UPDATE students 
       SET stayStatus = 'CHECKED_IN',
           status = 'active',
           applicationStatus = 'ADMITTED',
           checkInDate = $1,
           expectedCheckOutDate = $2,
           stayDuration = $3,
           checkInRemarks = $4,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [effectiveCheckIn, effectiveExpectedOut, duration, checkRemarks, id]
    );

    // 2. Activate user account if present
    const studentUserId = student.userId || student.userid;
    if (studentUserId) {
      await db.query(`UPDATE users SET status = 'active', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`, [studentUserId]);
    }

    // 3. Ensure assigned Bed is occupied
    await db.query(
      `UPDATE beds 
       SET status = 'occupied', 
           userId = $1, 
           blockedReason = NULL, 
           reservedFor = NULL, 
           updatedAt = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [studentUserId, currentBedId]
    );

    // 4. Ensure active allocation record exists
    const { rows: activeAlloc } = await db.query(
      `SELECT id FROM allocations WHERE studentId = $1 AND status = 'active'`,
      [id]
    );
    if (activeAlloc.length === 0) {
      await db.query(
        `INSERT INTO allocations (studentId, roomId, bedId, reason, notes, status) VALUES ($1, $2, $3, $4, $5, 'active')`,
        [id, currentRoomId, currentBedId, 'Check-in Activation', checkRemarks]
      );
    }

    // 5. Record in stay_history
    const { rows: activeStay } = await db.query(
      `SELECT id FROM stay_history WHERE studentId = $1 AND status = 'ACTIVE'`,
      [id]
    );
    if (activeStay.length > 0) {
      await db.query(
        `UPDATE stay_history 
         SET checkInDate = $1, expectedCheckOutDate = $2, stayDurationMonths = $3, checkInRemarks = $4, updatedAt = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [effectiveCheckIn, effectiveExpectedOut, duration, checkRemarks, activeStay[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO stay_history (studentId, roomId, bedId, checkInDate, expectedCheckOutDate, stayDurationMonths, status, checkInRemarks)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)`,
        [id, currentRoomId, currentBedId, effectiveCheckIn, effectiveExpectedOut, duration, checkRemarks]
      );
    }

    // 6. Notification
    const sName = student.studentName || student.studentname;
    const rNum = student.roomNumber || student.roomnumber;
    const bLabel = student.bedLabel || student.bedlabel || `Bed ${student.bedNumber || student.bednumber}`;
    await db.query(
      `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
      ['student_checkin', `Student ${sName} has officially checked in to Room ${rNum} (${bLabel}).`]
    );

    await db.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Student ${sName} successfully checked in to Room ${rNum} (${bLabel}).`,
      checkInDate: effectiveCheckIn
    });
  } catch (err) {
    console.error('Check-in error:', err);
    try { const db = await getDb(); await db.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: `Failed to complete check-in: ${err.message}` });
  }
}

async function getCheckoutPreview(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows: studentRows } = await db.query(
      `SELECT s.*, r.roomNumber, r.floor, r.block, b.bedLabel, b.bedNumber, u.email
       FROM students s
       LEFT JOIN users u ON s.userId = u.id
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE s.id = $1`,
      [id]
    );
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    // Query pending/unpaid fees
    const { rows: unpaidFees } = await db.query(
      `SELECT id, billingMonth, amountDue, amountPaid, (amountDue - amountPaid) as pendingAmount, status
       FROM payments
       WHERE studentId = $1 AND status != 'paid' AND (amountDue - amountPaid) > 0
       ORDER BY id ASC`,
      [id]
    );

    const pendingRent = unpaidFees.reduce((acc, f) => acc + parseFloat(f.pendingAmount || 0), 0);
    const depositAmount = parseFloat(student.depositAmount || student.depositamount || 8500);

    const checkIn = student.checkInDate || student.checkindate || student.joinDate || student.joindate || student.createdAt;
    let daysStayed = 0;
    if (checkIn) {
      const start = new Date(checkIn);
      const now = new Date();
      daysStayed = Math.max(1, Math.ceil((now - start) / (1000 * 60 * 60 * 24)));
    }

    res.status(200).json({
      success: true,
      student: {
        id: student.id,
        studentName: student.studentName || student.studentname,
        studentCustomId: student.studentCustomId || student.studentcustomid || `AKS${String(student.id).padStart(6, '0')}`,
        phone: student.phone,
        roomNumber: student.roomNumber || student.roomnumber || 'N/A',
        bedLabel: student.bedLabel || student.bedlabel || `Bed ${student.bedNumber || student.bednumber || 'N/A'}`,
        monthlyRent: parseFloat(student.monthlyRent || student.monthlyrent || 0),
        depositAmount,
        checkInDate: checkIn ? (typeof checkIn === 'string' ? checkIn.split('T')[0] : new Date(checkIn).toISOString().split('T')[0]) : 'N/A',
        daysStayed
      },
      depositAmount,
      pendingRent,
      unpaidFees
    });
  } catch (err) {
    console.error('Checkout preview error:', err);
    res.status(500).json({ success: false, message: `Failed to load checkout preview: ${err.message}` });
  }
}

async function checkOutStudent(req, res) {
  try {
    const { id } = req.params;
    const {
      checkOutDate,
      checkOutReason,
      checkOutRemarks,
      noticePeriodServed,
      maintenanceCharges,
      damageCharges,
      otherCharges,
      refundMode,
      paymentReference,
      notes
    } = req.body;

    const db = await getDb();
    const { rows: studentRows } = await db.query(
      `SELECT s.*, r.roomNumber, b.bedLabel, b.bedNumber 
       FROM students s
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE s.id = $1`,
      [id]
    );
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const currentBedId = student.bedId || student.bedid;
    const currentRoomId = student.roomId || student.roomid;
    const studentUserId = student.userId || student.userid;
    const effectiveCheckOut = checkOutDate ? new Date(checkOutDate) : new Date();

    // Calculate financials
    const depositHeld = parseFloat(student.depositAmount || student.depositamount || 8500);

    // Sum pending rent
    const { rows: unpaidFees } = await db.query(
      `SELECT id, (amountDue - amountPaid) as pendingAmount FROM payments WHERE studentId = $1 AND status != 'paid' AND (amountDue - amountPaid) > 0`,
      [id]
    );
    const pendingRent = unpaidFees.reduce((acc, f) => acc + parseFloat(f.pendingAmount || 0), 0);

    const maintFee = parseFloat(maintenanceCharges || 0);
    const damageFee = parseFloat(damageCharges || 0);
    const otherFee = parseFloat(otherCharges || 0);
    const totalDeductions = pendingRent + maintFee + damageFee + otherFee;
    const netPayable = depositHeld - totalDeductions;
    const refundAmount = netPayable > 0 ? netPayable : 0;
    const amountCollected = netPayable < 0 ? Math.abs(netPayable) : 0;

    const settlementNumber = `SET-AKS-${Date.now().toString().slice(-6)}-${student.id}`;

    await db.query('BEGIN');

    // 1. Close active stay_history
    const { rows: activeStay } = await db.query(
      `UPDATE stay_history 
       SET checkOutDate = $1, checkOutReason = $2, checkOutRemarks = $3, noticePeriodServed = $4, status = 'CHECKED_OUT', updatedAt = CURRENT_TIMESTAMP
       WHERE studentId = $5 AND status = 'ACTIVE'
       RETURNING id`,
      [effectiveCheckOut, checkOutReason || 'Vacating Hostel', checkOutRemarks || notes || '', noticePeriodServed !== false, id]
    );
    const stayId = activeStay.length > 0 ? activeStay[0].id : null;

    // 2. Insert into settlements
    const { rows: settlementRes } = await db.query(
      `INSERT INTO settlements (
        settlementNumber, studentId, stayId, checkOutDate, securityDepositHeld, 
        pendingRentAmount, maintenanceCharges, damageCharges, otherCharges, totalDeductions, 
        netPayableAmount, refundAmount, amountCollected, refundMode, paymentReference, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [
        settlementNumber, id, stayId, effectiveCheckOut, depositHeld,
        pendingRent, maintFee, damageFee, otherFee, totalDeductions,
        netPayable, refundAmount, amountCollected, refundMode || 'Direct UPI/Cash', paymentReference || null,
        'COMPLETED', notes || checkOutRemarks || ''
      ]
    );
    const settlementId = settlementRes.length > 0 ? settlementRes[0].id : null;

    // Phase 4: Record checkout security deposit ledger transactions
    let runningDepositBalance = depositHeld;

    // A. Itemized damage charges deduction
    if (damageFee > 0) {
      runningDepositBalance = Math.max(0, runningDepositBalance - damageFee);
      await db.query(`
        INSERT INTO security_deposits (
          depositNumber, studentId, transactionType, category, amount, balanceAfter,
          paymentMode, referenceNumber, reason, status, settlementId, recordedBy, transactionDate
        ) VALUES ($1, $2, 'DEDUCTION', 'DAMAGE_CHARGES', $3, $4, 'ADJUSTMENT', $5, $6, 'COMPLETED', $7, 'Checkout Settlement', CURRENT_TIMESTAMP)
      `, [`DEP-DED-${Date.now().toString().slice(-6)}-${id}-DMG`, id, damageFee, runningDepositBalance, paymentReference || null, 'Checkout damage charges deduction', settlementId]);
    }

    // B. Itemized maintenance charges deduction
    if (maintFee > 0) {
      runningDepositBalance = Math.max(0, runningDepositBalance - maintFee);
      await db.query(`
        INSERT INTO security_deposits (
          depositNumber, studentId, transactionType, category, amount, balanceAfter,
          paymentMode, referenceNumber, reason, status, settlementId, recordedBy, transactionDate
        ) VALUES ($1, $2, 'DEDUCTION', 'MAINTENANCE_CHARGES', $3, $4, 'ADJUSTMENT', $5, $6, 'COMPLETED', $7, 'Checkout Settlement', CURRENT_TIMESTAMP)
      `, [`DEP-DED-${Date.now().toString().slice(-6)}-${id}-MNT`, id, maintFee, runningDepositBalance, paymentReference || null, 'Checkout maintenance charges deduction', settlementId]);
    }

    // C. Itemized other charges deduction
    if (otherFee > 0) {
      runningDepositBalance = Math.max(0, runningDepositBalance - otherFee);
      await db.query(`
        INSERT INTO security_deposits (
          depositNumber, studentId, transactionType, category, amount, balanceAfter,
          paymentMode, referenceNumber, reason, status, settlementId, recordedBy, transactionDate
        ) VALUES ($1, $2, 'DEDUCTION', 'OTHER_CHARGES', $3, $4, 'ADJUSTMENT', $5, $6, 'COMPLETED', $7, 'Checkout Settlement', CURRENT_TIMESTAMP)
      `, [`DEP-DED-${Date.now().toString().slice(-6)}-${id}-OTH`, id, otherFee, runningDepositBalance, paymentReference || null, 'Checkout other charges deduction', settlementId]);
    }

    // D. Pending rent adjustment against deposit
    if (pendingRent > 0) {
      runningDepositBalance = Math.max(0, runningDepositBalance - pendingRent);
      await db.query(`
        INSERT INTO security_deposits (
          depositNumber, studentId, transactionType, category, amount, balanceAfter,
          paymentMode, referenceNumber, reason, status, settlementId, recordedBy, transactionDate
        ) VALUES ($1, $2, 'ADJUSTMENT', 'RENT_ADJUSTMENT', $3, $4, 'ADJUSTMENT', $5, $6, 'COMPLETED', $7, 'Checkout Settlement', CURRENT_TIMESTAMP)
      `, [`DEP-ADJ-${Date.now().toString().slice(-6)}-${id}-RNT`, id, pendingRent, runningDepositBalance, paymentReference || null, `Checkout pending rent adjustment (₹${pendingRent})`, settlementId]);
    }

    // E. Refund transaction (Completed or Pending)
    const isPendingRefund = refundAmount > 0 && (refundMode === 'Pay Later' || refundMode === 'Pending');
    if (refundAmount > 0) {
      await db.query(`
        INSERT INTO security_deposits (
          depositNumber, studentId, transactionType, category, amount, balanceAfter,
          paymentMode, referenceNumber, reason, status, settlementId, recordedBy, transactionDate
        ) VALUES ($1, $2, 'REFUND', 'CHECKOUT_REFUND', $3, 0, $4, $5, $6, $7, $8, 'Checkout Settlement', CURRENT_TIMESTAMP)
      `, [
        `DEP-REF-${Date.now().toString().slice(-6)}-${id}`,
        id,
        refundAmount,
        refundMode || 'Direct UPI/Cash',
        paymentReference || null,
        `Checkout security deposit refund (${settlementNumber})`,
        isPendingRefund ? 'PENDING' : 'COMPLETED',
        settlementId
      ]);
    }

    const finalDepositStatus = refundAmount > 0 ? (isPendingRefund ? 'PENDING_REFUND' : 'REFUNDED') : 'SETTLED';

    // 3. Mark pending rent as paid/adjusted against security deposit if settled
    if (pendingRent > 0) {
      await db.query(
        `UPDATE payments SET status = 'paid', amountPaid = amountDue, updatedAt = CURRENT_TIMESTAMP WHERE studentId = $1 AND status != 'paid'`,
        [id]
      );
    }

    // 4. Automatically Release the Bed
    if (currentBedId) {
      await db.query(
        `UPDATE beds 
         SET status = 'vacant', userId = NULL, blockedReason = NULL, reservedFor = NULL, updatedAt = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [currentBedId]
      );
    }
    if (studentUserId) {
      await db.query(
        `UPDATE beds 
         SET status = 'vacant', userId = NULL, blockedReason = NULL, reservedFor = NULL, updatedAt = CURRENT_TIMESTAMP 
         WHERE userId = $1`,
        [studentUserId]
      );
    }

    // 5. Update Allocations Table
    await db.query(
      `UPDATE allocations 
       SET vacatedAt = CURRENT_TIMESTAMP, reason = $1, status = 'vacated' 
       WHERE studentId = $2 AND status = 'active'`,
      [checkOutReason || 'Student Checkout', id]
    );

    // 6. Update Student record (with deposit settlement status)
    await db.query(
      `UPDATE students 
       SET roomId = NULL, bedId = NULL, stayStatus = 'CHECKED_OUT', status = 'CHECKED_OUT', 
           checkOutDate = $1, checkOutReason = $2, checkOutRemarks = $3,
           depositAmount = 0,
           depositStatus = $4,
           depositRefundedAmount = $5,
           depositDeductionsAmount = $6,
           updatedAt = CURRENT_TIMESTAMP 
       WHERE id = $7`,
      [effectiveCheckOut, checkOutReason || 'Vacating Hostel', checkOutRemarks || notes || '', finalDepositStatus, isPendingRefund ? 0 : refundAmount, totalDeductions, id]
    );

    // 7. Notification
    const sName = student.studentName || student.studentname;
    const rNum = student.roomNumber || student.roomnumber;
    const bLabel = student.bedLabel || student.bedlabel || `Bed ${student.bedNumber || student.bednumber}`;
    await db.query(
      `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
      ['student_checkout', `Student ${sName} checked out. Bed ${bLabel} in Room ${rNum} is now vacant. Settlement ${settlementNumber} completed.`]
    );

    await db.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Student ${sName} checked out successfully. Bed released.`,
      settlement: {
        settlementNumber,
        depositHeld,
        totalDeductions,
        netPayable,
        refundAmount,
        amountCollected,
        checkOutDate: effectiveCheckOut
      }
    });
  } catch (err) {
    console.error('Checkout error:', err);
    try { const db = await getDb(); await db.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: `Failed to complete checkout: ${err.message}` });
  }
}

async function getStudentStayHistory(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows: stayHistory } = await db.query(
      `SELECT sh.*, r.roomNumber, r.floor, r.block, b.bedLabel, b.bedNumber
       FROM stay_history sh
       LEFT JOIN rooms r ON sh.roomId = r.id
       LEFT JOIN beds b ON sh.bedId = b.id
       WHERE sh.studentId = $1
       ORDER BY sh.id DESC`,
      [id]
    );

    const { rows: allocationHistory } = await db.query(
      `SELECT a.*, r.roomNumber, b.bedLabel, b.bedNumber, fr.roomNumber as fromRoomNumber, fb.bedLabel as fromBedLabel
       FROM allocations a
       LEFT JOIN rooms r ON a.roomId = r.id
       LEFT JOIN beds b ON a.bedId = b.id
       LEFT JOIN rooms fr ON a.fromRoomId = fr.id
       LEFT JOIN beds fb ON a.fromBedId = fb.id
       WHERE a.studentId = $1
       ORDER BY a.allocatedAt DESC`,
      [id]
    );

    const { rows: settlementsList } = await db.query(
      `SELECT * FROM settlements WHERE studentId = $1 ORDER BY id DESC`,
      [id]
    );

    res.status(200).json({
      success: true,
      stayHistory,
      allocationHistory,
      settlements: settlementsList
    });
  } catch (err) {
    console.error('Get stay history error:', err);
    res.status(500).json({ success: false, message: `Failed to load stay history: ${err.message}` });
  }
}


module.exports = {
  getStats,
  checkInStudent,
  getCheckoutPreview,
  checkOutStudent,
  getStudentStayHistory,
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
  reviewApplication,
  getStudentDocuments,
  verifyDocument,
  allocateRoomToStudent,
  getPasswordResetRequests,
  adminResetPassword,
  subscribeAdminEvents
};

