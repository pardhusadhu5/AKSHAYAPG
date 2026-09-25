const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../config/db');
const { JWT_SECRET } = require('../middleware/authMiddleware');

async function login(req, res) {
  try {
    const { email, phone, password } = req.body;
    const db = await getDb();

    // Student login (uses phone)
    if (phone) {
      const user = (await (async () => { let args = ['SELECT * FROM users WHERE phone = $1', [phone]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
      if (!user) {
        return res.status(404).json({ success: false, message: 'Student account not found.' });
      }

      if (user.role !== 'student') {
        return res.status(403).json({ success: false, message: 'Access denied. Account is not a student.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Incorrect password.' });
      }

      const token = jwt.sign(
        { id: user.id, name: user.name, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    }

    // Admin / Manager login (uses email)
    if (email) {
      const user = (await (async () => { let args = ['SELECT * FROM users WHERE email = $1', [email]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      const token = jwt.sign(
        { id: user.id, name: user.name, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    }

    return res.status(400).json({ success: false, message: 'Email or phone number is required.' });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

function generateApplicationId() {
  const randNum = Math.floor(100000 + Math.random() * 900000);
  return `AKS-${randNum}`;
}

async function register(req, res) {
  try {
    const {
      name,
      email,
      phone,
      aadhaarNumber,
      collegeName,
      course,
      branch,
      rollNumber,
      year,
      parentName,
      guardianRelationship,
      parentPhone,
      emergencyContact,
      address,
      city,
      state,
      pincode,
      preferredRoomType,
      stayDuration,
      password,
      confirmPassword
    } = req.body;

    if (!name || !phone || !aadhaarNumber || !collegeName || !year || !parentName || !parentPhone || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All required registration fields must be filled.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const db = await getDb();

    // Check unique phone
    const { rows: phoneRows } = await db.query('SELECT id FROM users WHERE phone = $1', [phone.trim()]);
    if (phoneRows.length > 0) {
      return res.status(400).json({ success: false, message: 'This mobile number is already registered.' });
    }

    // Email handling
    const userEmail = email ? email.trim() : `student_${phone.trim()}@akshayadeluxepg.com`;
    const { rows: emailRows } = await db.query('SELECT id FROM users WHERE email = $1', [userEmail]);
    if (emailRows.length > 0) {
      return res.status(400).json({ success: false, message: 'This email is already registered.' });
    }

    // Check unique Aadhaar
    const { rows: aadhaarRows } = await db.query('SELECT id FROM students WHERE aadhaarNumber = $1', [aadhaarNumber.trim()]);
    if (aadhaarRows.length > 0) {
      return res.status(400).json({ success: false, message: 'This Aadhaar number is already registered.' });
    }

    // Handle Photo upload / placeholder
    let photoPath = '/assets/avatar-placeholder.png';
    if (req.file) {
      photoPath = `/uploads/${req.file.filename}`;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const appId = generateApplicationId();
    const joinDate = new Date().toISOString().split('T')[0];

    await db.query('BEGIN');

    // 1. Insert User
    const { rows: userResult } = await db.query(
      `INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name.trim(), userEmail, phone.trim(), hashedPassword, 'student']
    );
    const userId = userResult[0].id;

    // 2. Insert Student Application
    const { rows: studentResult } = await db.query(
      `INSERT INTO students (
        userId, studentCustomId, applicationId, applicationStatus, studentName, phone, parentName, parentPhone,
        guardianRelationship, emergencyContact, aadhaarNumber, dateOfBirth, gender, collegeName, course, branch,
        rollNumber, year, address, city, state, pincode, preferredRoomType, stayDuration, photo, idProof,
        joinDate, status, monthlyRent, depositAmount, roomId, bedId, paymentStatus
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33) RETURNING id`,
      [
        userId,
        appId, // initial custom id set to appId
        appId,
        'PENDING',
        name.trim(),
        phone.trim(),
        parentName.trim(),
        parentPhone.trim(),
        guardianRelationship || 'Parent',
        emergencyContact || parentPhone.trim(),
        aadhaarNumber.trim(),
        req.body.dateOfBirth || null,
        req.body.gender || 'Male',
        collegeName.trim(),
        course || 'B.Tech',
        branch || '',
        rollNumber || '',
        year.trim(),
        address || '',
        city || '',
        state || '',
        pincode || '',
        preferredRoomType || '3 Sharing',
        stayDuration ? parseInt(stayDuration) : 12,
        photoPath,
        '',
        joinDate,
        'APPLICANT',
        8500,
        8500,
        null,
        null,
        'unpaid'
      ]
    );

    // 3. Notification for Admin
    await db.query(
      `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
      ['new_application', `New student admission application submitted by ${name.trim()} (Application ID: ${appId}).`]
    );

    await db.query('COMMIT');

    res.status(201).json({
      success: true,
      message: `Admission application submitted successfully. Application ID: ${appId}`,
      applicationId: appId,
      studentId: studentResult[0].id
    });
  } catch (err) {
    try {
      const db = await getDb();
      await db.query('ROLLBACK');
    } catch (_) {}
    console.error('Registration Error:', err);
    res.status(500).json({ success: false, message: `Registration failed: ${err.message}` });
  }
}

async function updateProfilePicture(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No photo uploaded.' });
    }

    const photoPath = `/uploads/${req.file.filename}`;
    const db = await getDb();

    // Check old photo to delete it (prevent disk clutter)
    const currentStudent = (await (async () => { let args = ['SELECT photo FROM students WHERE userId = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (currentStudent && currentStudent.photo && currentStudent.photo.startsWith('/uploads/')) {
      const oldFilePath = path.join(__dirname, '..', currentStudent.photo);
      fs.unlink(oldFilePath, (err) => {
        if (err) console.error('Failed to delete old photo:', err);
      });
    }

    (await (async () => {
         let args = ['UPDATE students SET photo = $1 WHERE userId = $2', [photoPath, req.user.id]];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

    res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully.',
      photo: photoPath
    });
  } catch (err) {
    console.error('Update Photo Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ success: false, message: 'All password fields are required.' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const db = await getDb();
    const user = (await (async () => { let args = ['SELECT password FROM users WHERE id = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect current password.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    (await (async () => {
         let args = ['UPDATE users SET password = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2', [hashedPassword, req.user.id]];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

    res.status(200).json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Change Password Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const db = await getDb();
    const user = (await (async () => { let args = ['SELECT * FROM users WHERE email = $1', [email]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If the email exists, a password reset link has been simulated.'
      });
    }

    const resetToken = jwt.sign(
      { id: user.id, email: user.email, type: 'reset' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.status(200).json({
      success: true,
      message: 'Password reset link simulated successfully.',
      resetUrl: `/reset-password.html?token=${resetToken}`
    });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    if (decoded.type !== 'reset') {
      return res.status(400).json({ success: false, message: 'Invalid token type' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const db = await getDb();

    (await (async () => {
         let args = [
      'UPDATE users SET password = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, decoded.id]
    ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

    res.status(200).json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getMe(req, res) {
  try {
    const db = await getDb();
    const user = (await (async () => { let args = ['SELECT id, name, email, phone, role, createdAt FROM users WHERE id = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let studentProfile = null;
    if (user.role === 'student') {
      const profileRow = (await (async () => { let args = [`
        SELECT s.*, r.roomNumber, r.floor, b.bedNumber
        FROM students s
        LEFT JOIN rooms r ON s.roomId = r.id
        LEFT JOIN beds b ON s.bedId = b.id
        WHERE s.userId = $1
      `, [user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
      if (profileRow) {
        studentProfile = {
          ...profileRow,
          applicationStatus: profileRow.applicationstatus || profileRow.applicationStatus,
          applicationId: profileRow.applicationid || profileRow.applicationId,
          studentName: profileRow.studentname || profileRow.studentName,
          studentCustomId: profileRow.studentcustomid || profileRow.studentCustomId,
          parentName: profileRow.parentname || profileRow.parentName,
          parentPhone: profileRow.parentphone || profileRow.parentPhone,
          collegeName: profileRow.collegename || profileRow.collegeName,
          preferredRoomType: profileRow.preferredroomtype || profileRow.preferredRoomType,
          stayDuration: profileRow.stayduration || profileRow.stayDuration,
          monthlyRent: profileRow.monthlyrent || profileRow.monthlyRent,
          depositAmount: profileRow.depositamount || profileRow.depositAmount,
          rejectionReason: profileRow.rejectionreason || profileRow.rejectionReason,
          correctionReason: profileRow.correctionreason || profileRow.correctionReason,
          aadhaarNumber: profileRow.aadhaarnumber || profileRow.aadhaarNumber,
          dateOfBirth: profileRow.dateofbirth || profileRow.dateOfBirth,
          emergencyContact: profileRow.emergencycontact || profileRow.emergencyContact,
          rollNumber: profileRow.rollnumber || profileRow.rollNumber,
          roomNumber: profileRow.roomnumber || profileRow.roomNumber,
          bedNumber: profileRow.bednumber || profileRow.bedNumber
        };
      }
    }

    res.status(200).json({
      success: true,
      user,
      profile: studentProfile
    });
  } catch (err) {
    console.error('Get Me Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function uploadDocument(req, res) {
  try {
    const { name } = req.body;
    if (!name || !req.file) {
      return res.status(400).json({ success: false, message: 'Document name and file are required.' });
    }

    const db = await getDb();
    const student = (await (async () => { let args = ['SELECT id FROM students WHERE userId = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!student) {
      return res.status(403).json({ success: false, message: 'Only students can upload documents.' });
    }

    const filePath = '/uploads/' + req.file.filename;
    const fileType = path.extname(req.file.originalname).substring(1).toLowerCase();

    (await (async () => {
         let args = [
      `INSERT INTO documents (studentId, name, filePath, fileType) VALUES ($1, $2, $3, $4)`,
      [student.id, name, filePath, fileType]
    ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

    res.status(201).json({ success: true, message: 'Document uploaded successfully.', document: { name, filePath, fileType } });
  } catch (err) {
    console.error('Upload Doc Error:', err);
    res.status(500).json({ success: false, message: 'Failed to upload document.' });
  }
}

async function getMyDocuments(req, res) {
  try {
    const db = await getDb();
    const student = (await (async () => { let args = ['SELECT id FROM students WHERE userId = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const documents = (await (async () => { let args = ['SELECT * FROM documents WHERE studentId = $1 ORDER BY id DESC', [student.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    res.status(200).json({ success: true, documents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteDocument(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const student = (await (async () => { let args = ['SELECT id FROM students WHERE userId = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!student) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const doc = (await (async () => { let args = ['SELECT * FROM documents WHERE id = $1 AND studentId = $2', [id, student.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    (await (async () => {
         let args = ['DELETE FROM documents WHERE id = $1', [id]];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

    try {
      const absolutePath = path.join(__dirname, '..', doc.filePath);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    } catch (_) {}

    res.status(200).json({ success: true, message: 'Document deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateStudentApplication(req, res) {
  try {
    const db = await getDb();
    const { rows: students } = await db.query('SELECT * FROM students WHERE userId = $1', [req.user.id]);
    const student = students[0];

    if (!student) {
      return res.status(404).json({ success: false, message: 'Application record not found.' });
    }

    const currentAppStatus = student.applicationStatus || student.applicationstatus;
    if (currentAppStatus !== 'CORRECTION_REQUIRED' && currentAppStatus !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'Application cannot be updated at this status.' });
    }

    const {
      studentName, phone, parentName, parentPhone, guardianRelationship, emergencyContact,
      aadhaarNumber, dateOfBirth, gender, collegeName, course, branch, rollNumber, year,
      address, city, state, pincode, preferredRoomType, stayDuration
    } = req.body;

    await db.query(
      `UPDATE students SET
        studentName = COALESCE($1, studentName),
        phone = COALESCE($2, phone),
        parentName = COALESCE($3, parentName),
        parentPhone = COALESCE($4, parentPhone),
        guardianRelationship = COALESCE($5, guardianRelationship),
        emergencyContact = COALESCE($6, emergencyContact),
        aadhaarNumber = COALESCE($7, aadhaarNumber),
        dateOfBirth = COALESCE($8, dateOfBirth),
        gender = COALESCE($9, gender),
        collegeName = COALESCE($10, collegeName),
        course = COALESCE($11, course),
        branch = COALESCE($12, branch),
        rollNumber = COALESCE($13, rollNumber),
        year = COALESCE($14, year),
        address = COALESCE($15, address),
        city = COALESCE($16, city),
        state = COALESCE($17, state),
        pincode = COALESCE($18, pincode),
        preferredRoomType = COALESCE($19, preferredRoomType),
        stayDuration = COALESCE($20, stayDuration),
        applicationStatus = 'PENDING',
        correctionReason = NULL,
        updatedAt = CURRENT_TIMESTAMP
       WHERE id = $21`,
      [
        studentName || null, phone || null, parentName || null, parentPhone || null, guardianRelationship || null, emergencyContact || null,
        aadhaarNumber || null, dateOfBirth || null, gender || null, collegeName || null, course || null, branch || null, rollNumber || null, year || null,
        address || null, city || null, state || null, pincode || null, preferredRoomType || null, stayDuration ? parseInt(stayDuration) : null,
        student.id
      ]
    );

    res.status(200).json({ success: true, message: 'Application resubmitted successfully for admin review.' });
  } catch (err) {
    console.error('Update Application Error:', err);
    res.status(500).json({ success: false, message: `Failed to update application: ${err.message}` });
  }
}

module.exports = {
  login,
  register,
  updateProfilePicture,
  changePassword,
  forgotPassword,
  resetPassword,
  getMe,
  uploadDocument,
  getMyDocuments,
  deleteDocument,
  updateStudentApplication
};
