const bcrypt = require('bcryptjs');
const { deleteFile } = require('../services/uploadService');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../config/db');
const { JWT_SECRET } = require('../middleware/authMiddleware');

function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).replace(/\D/g, '');
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

function generateApplicationId() {
  const randNum = Math.floor(1000 + Math.random() * 9000);
  return `AKS-APP-2026-${randNum}`;
}

async function login(req, res) {
  try {
    const { email, phone, password } = req.body;
    const db = await getDb();

    // Student login (uses Mobile Number + Password)
    if (phone) {
      const normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone || !password) {
        return res.status(400).json({ success: false, message: 'Mobile number and password are required.' });
      }

      const { rows: userRows } = await db.query(
        'SELECT * FROM users WHERE phone = $1 AND role = $2',
        [normalizedPhone, 'student']
      );
      const user = userRows[0];

      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid mobile number or password.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid mobile number or password.' });
      }

      // Check student account & application status
      const { rows: studentRows } = await db.query(
        'SELECT * FROM students WHERE userId = $1 OR phone = $2',
        [user.id, normalizedPhone]
      );
      const student = studentRows[0];

      if (student) {
        const appStatus = student.applicationStatus || student.applicationstatus;
        const studentStatus = student.status || student.status;

        if (appStatus === 'PENDING' || appStatus === 'PENDING_REVIEW' || appStatus === 'DOCUMENT_VERIFICATION') {
          return res.status(403).json({
            success: false,
            message: 'Your registration is currently under review. Please contact the hostel administration.',
            applicationStatus: appStatus,
            applicationId: student.applicationId || student.applicationid
          });
        }

        if (appStatus === 'REJECTED') {
          return res.status(403).json({
            success: false,
            message: 'Your registration was not approved. Please contact the hostel administration.',
            rejectionReason: student.rejectionReason || student.rejectionreason || 'Application rejected by administration.',
            applicationStatus: appStatus,
            applicationId: student.applicationId || student.applicationid
          });
        }

        if (studentStatus === 'INACTIVE' || user.status === 'inactive') {
          return res.status(403).json({
            success: false,
            message: 'Your account is currently inactive. Please contact the hostel administration.'
          });
        }
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

    // Admin / Manager login (uses Email + Password)
    if (email) {
      const { rows: userRows } = await db.query('SELECT * FROM users WHERE email = $1', [email.trim()]);
      const user = userRows[0];
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

    return res.status(400).json({ success: false, message: 'Email or mobile number is required.' });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function registerStudentApplication(req, res) {
  try {
    const body = req.body || {};
    const {
      name,
      dateOfBirth,
      gender,
      bloodGroup,
      phone,
      email,
      aadhaarNumber,
      collegeName,
      course,
      branch,
      year,
      rollNumber,
      academicYear,
      collegeAddress,
      parentName,
      guardianRelationship,
      parentPhone,
      guardianEmail,
      address,
      city,
      state,
      pincode,
      emergencyName,
      emergencyRelationship,
      emergencyMobile,
      joiningDate,
      stayDuration,
      previousHostel,
      foodPreference,
      preferredSharingType,
      preferredFloor,
      password,
      confirmPassword
    } = body;

    // Validate Required Fields
    if (!name || !dateOfBirth || !gender || !phone || !aadhaarNumber || !collegeName || !course || !year || !rollNumber || !parentName || !guardianRelationship || !parentPhone || !emergencyName || !emergencyRelationship || !emergencyMobile || !joiningDate || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'Please fill in all required fields marked with *.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || !/^\d{10}$/.test(normalizedPhone)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
    }

    const cleanAadhaar = aadhaarNumber.replace(/\D/g, '');
    if (cleanAadhaar.length !== 12) {
      return res.status(400).json({ success: false, message: 'Aadhaar number must be exactly 12 digits.' });
    }

    // Validate Required Files
    const files = req.files || {};
    const photoFile = files.photo ? files.photo[0] : null;
    const collegeIdFile = files.document_collegeId ? files.document_collegeId[0] : null;
    const aadhaarFile = files.document_aadhaar ? files.document_aadhaar[0] : null;
    const parentIdFile = files.document_parentId ? files.document_parentId[0] : null;

    if (!collegeIdFile || !aadhaarFile || !photoFile || !parentIdFile) {
      return res.status(400).json({
        success: false,
        message: 'Please upload all 4 required document files: Student/College ID, Aadhaar Card, Photograph, and Parent ID Proof.'
      });
    }

    const db = await getDb();

    // Check unique mobile in users
    const { rows: phoneRows } = await db.query('SELECT id FROM users WHERE phone = $1', [normalizedPhone]);
    if (phoneRows.length > 0) {
      return res.status(400).json({ success: false, message: 'This mobile number is already registered. Please login.' });
    }

    // Check unique Aadhaar in students
    const { rows: aadhaarRows } = await db.query('SELECT id FROM students WHERE aadhaarNumber = $1', [cleanAadhaar]);
    if (aadhaarRows.length > 0) {
      return res.status(400).json({ success: false, message: 'This Aadhaar number is already registered.' });
    }

    const userEmail = email ? email.trim() : `student_${normalizedPhone}@akshayadeluxepg.com`;
    const { rows: emailRows } = await db.query('SELECT id FROM users WHERE email = $1', [userEmail]);
    if (emailRows.length > 0) {
      return res.status(400).json({ success: false, message: 'This email address is already registered.' });
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);
    const appId = generateApplicationId();
    const photoPath = photoFile.path ? (photoFile.path.startsWith('/uploads/') ? photoFile.path : `/uploads/${photoFile.filename}`) : '/assets/avatar-placeholder.png';

    await db.query('BEGIN');

    // 1. Insert User Record
    const { rows: userResult } = await db.query(
      `INSERT INTO users (name, email, phone, password, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name.trim(), userEmail, normalizedPhone, passwordHash, 'student', 'pending']
    );
    const userId = userResult[0].id;

    // 2. Insert Student Application Record
    const { rows: studentResult } = await db.query(
      `INSERT INTO students (
        userId, studentCustomId, applicationId, applicationStatus, studentName, phone, parentName, parentPhone,
        guardianRelationship, guardianEmail, emergencyContact, emergencyName, emergencyRelationship, emergencyMobile,
        aadhaarNumber, dateOfBirth, gender, bloodGroup, collegeName, course, branch, rollNumber, year, academicYear,
        collegeAddress, address, city, state, pincode, preferredRoomType, preferredFloor, preferredSharingType,
        foodPreference, expectedDuration, stayDuration, photo, idProof, joinDate, status, monthlyRent, depositAmount,
        roomId, bedId, paymentStatus
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44
      ) RETURNING id`,
      [
        userId,
        appId,
        appId,
        'PENDING',
        name.trim(),
        normalizedPhone,
        parentName.trim(),
        parentPhone.trim(),
        guardianRelationship || 'Parent',
        guardianEmail || '',
        emergencyMobile.trim(),
        emergencyName.trim(),
        emergencyRelationship.trim(),
        emergencyMobile.trim(),
        cleanAadhaar,
        dateOfBirth,
        gender,
        bloodGroup || '',
        collegeName.trim(),
        course.trim(),
        branch || course.trim(),
        rollNumber.trim(),
        year.trim(),
        academicYear || '',
        collegeAddress || '',
        address || '',
        city || '',
        state || '',
        pincode || '',
        preferredSharingType || '3 Sharing',
        preferredFloor || 'Any',
        preferredSharingType || '3 Sharing',
        foodPreference || 'Both',
        stayDuration ? parseInt(stayDuration) : 12,
        stayDuration ? parseInt(stayDuration) : 12,
        photoPath,
        '',
        joiningDate,
        'APPLICANT',
        8500,
        8500,
        null,
        null,
        'unpaid'
      ]
    );
    const studentId = studentResult[0].id;

    // 3. Save Uploaded Documents to documents Table
    const docKeys = [
      { key: 'document_collegeId', type: 'Student / College ID Card' },
      { key: 'document_aadhaar', type: 'Aadhaar Card' },
      { key: 'photo', type: 'Passport Photograph' },
      { key: 'document_parentId', type: 'Parent / Guardian ID Proof' },
      { key: 'document_bonafide', type: 'Bonafide Certificate' },
      { key: 'document_joiningLetter', type: 'Admission / Joining Letter' },
      { key: 'document_marksMemo', type: 'Previous Semester Marks Memo' },
      { key: 'document_other', type: 'Other Supporting Document' }
    ];

    for (const item of docKeys) {
      if (files[item.key] && files[item.key][0]) {
        const fileObj = files[item.key][0];
        const filePath = fileObj.path ? (fileObj.path.startsWith('/uploads/') ? fileObj.path : `/uploads/${fileObj.filename}`) : `/uploads/${fileObj.filename}`;
        await db.query(
          `INSERT INTO documents (studentId, documentType, name, fileName, filePath, fileType, storagePath, mimeType, fileSize, verificationStatus)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [studentId, item.type, item.type, fileObj.originalname || item.type, filePath, fileObj.mimetype || 'image', filePath, fileObj.mimetype || '', fileObj.size || 0, 'PENDING']
        );
      }
    }

    // 4. Admin Notification
    await db.query(
      `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
      ['new_application', `New student admission application submitted by ${name.trim()} (Application ID: ${appId}).`]
    );

    await db.query('COMMIT');

    return res.status(200).json({
      success: true,
      applicationId: appId,
      studentName: name.trim(),
      mobile: normalizedPhone,
      message: 'Registration submitted successfully. Your application is currently under review by Akshaya Deluxe Hostel administration.'
    });
  } catch (err) {
    try { const db = await getDb(); await db.query('ROLLBACK'); } catch (_) {}
    console.error('Register Application Error:', err);
    return res.status(500).json({ success: false, message: `Registration failed: ${err.message}` });
  }
}

async function getApplicationStatus(req, res) {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Mobile number is required.' });
    }

    const normalizedPhone = normalizePhone(phone);
    const db = await getDb();

    const { rows: studentRows } = await db.query('SELECT * FROM students WHERE phone = $1', [normalizedPhone]);
    const student = studentRows[0];

    if (!student) {
      return res.status(404).json({ success: false, message: 'No application found for this mobile number.' });
    }

    const { rows: docs } = await db.query('SELECT id, documentType, fileName, verificationStatus, adminRemarks FROM documents WHERE studentId = $1', [student.id]);

    return res.status(200).json({
      success: true,
      applicationId: student.applicationId || student.applicationid,
      studentName: student.studentName || student.studentname,
      applicationStatus: student.applicationStatus || student.applicationstatus,
      rejectionReason: student.rejectionReason || student.rejectionreason,
      correctionReason: student.correctionReason || student.correctionreason,
      documents: docs
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function forgotPasswordRequest(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Mobile number is required.' });
    }

    const normalizedPhone = normalizePhone(phone);
    const db = await getDb();

    const { rows: userRows } = await db.query('SELECT id, name FROM users WHERE phone = $1 AND role = $2', [normalizedPhone, 'student']);
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: 'No student account registered with this mobile number.' });
    }

    const { rows: studentRows } = await db.query('SELECT id FROM students WHERE userId = $1', [user.id]);
    const studentId = studentRows[0] ? studentRows[0].id : null;

    await db.query(
      `INSERT INTO password_reset_requests (studentId, phone, status) VALUES ($1, $2, $3)`,
      [studentId, normalizedPhone, 'PENDING']
    );

    await db.query(
      `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
      ['password_reset_request', `Password reset requested by student ${user.name} (Mobile: ${normalizedPhone}).`]
    );

    return res.status(200).json({
      success: true,
      message: 'Password reset request submitted to hostel administration. Please contact admin to receive your temporary password.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMe(req, res) {
  try {
    const db = await getDb();
    const { rows: userRows } = await db.query('SELECT id, name, email, phone, role FROM users WHERE id = $1', [req.user.id]);
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const { rows: studentRows } = await db.query(`
      SELECT s.*, r.roomNumber, b.bedNumber, b.bedLabel
      FROM students s
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE s.userId = $1
    `, [user.id]);

    const profile = studentRows[0] || null;
    const { rows: docs } = profile ? await db.query('SELECT * FROM documents WHERE studentId = $1', [profile.id]) : { rows: [] };

    res.status(200).json({
      success: true,
      user,
      profile,
      documents: docs
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateProfilePicture(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No photo uploaded.' });
    }
    const db = await getDb();
    const photoPath = req.file.path ? (req.file.path.startsWith('/uploads/') ? req.file.path : `/uploads/${req.file.filename}`) : `/uploads/${req.file.filename}`;
    
    await db.query('UPDATE students SET photo = $1, updatedAt = CURRENT_TIMESTAMP WHERE userId = $2', [photoPath, req.user.id]);

    res.status(200).json({ success: true, photo: photoPath, message: 'Profile photo updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long.' });
    }

    const db = await getDb();
    const { rows: userRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userRows[0];

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect current password.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2', [newHash, req.user.id]);

    res.status(200).json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const { documentType } = req.body;
    const db = await getDb();

    const { rows: studentRows } = await db.query('SELECT id FROM students WHERE userId = $1', [req.user.id]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student profile not found.' });
    }

    const filePath = req.file.path ? (req.file.path.startsWith('/uploads/') ? req.file.path : `/uploads/${req.file.filename}`) : `/uploads/${req.file.filename}`;

    const { rows: docResult } = await db.query(
      `INSERT INTO documents (studentId, documentType, name, fileName, filePath, fileType, storagePath, mimeType, fileSize, verificationStatus)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [student.id, documentType || 'Document', documentType || 'Document', req.file.originalname || 'Document', filePath, req.file.mimetype || 'image', filePath, req.file.mimetype || '', req.file.size || 0, 'PENDING']
    );

    res.status(200).json({ success: true, document: docResult[0], message: 'Document uploaded successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyDocuments(req, res) {
  try {
    const db = await getDb();
    const { rows: studentRows } = await db.query('SELECT id FROM students WHERE userId = $1', [req.user.id]);
    const student = studentRows[0];
    if (!student) return res.status(200).json({ success: true, documents: [] });

    const { rows: docs } = await db.query('SELECT * FROM documents WHERE studentId = $1 ORDER BY id DESC', [student.id]);
    res.status(200).json({ success: true, documents: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteDocument(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();
    const { rows: studentRows } = await db.query('SELECT id FROM students WHERE userId = $1', [req.user.id]);
    const student = studentRows[0];
    if (!student) return res.status(403).json({ success: false, message: 'Access denied.' });

    const { rows: docRows } = await db.query('SELECT * FROM documents WHERE id = $1 AND studentId = $2', [id, student.id]);
    const doc = docRows[0];
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found.' });

    await db.query('DELETE FROM documents WHERE id = $1', [id]);
    try { await deleteFile(doc.storagePath); } catch (_) {}

    res.status(200).json({ success: true, message: 'Document deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateStudentApplication(req, res) {
  try {
    const db = await getDb();
    const { rows: studentRows } = await db.query('SELECT * FROM students WHERE userId = $1', [req.user.id]);
    const student = studentRows[0];
    if (!student) return res.status(404).json({ success: false, message: 'Application record not found.' });

    const { studentName, phone, parentName, parentPhone, collegeName, course, preferredRoomType } = req.body;

    await db.query(
      `UPDATE students SET
        studentName = COALESCE($1, studentName),
        phone = COALESCE($2, phone),
        parentName = COALESCE($3, parentName),
        parentPhone = COALESCE($4, parentPhone),
        collegeName = COALESCE($5, collegeName),
        course = COALESCE($6, course),
        preferredRoomType = COALESCE($7, preferredRoomType),
        applicationStatus = 'PENDING',
        correctionReason = NULL,
        updatedAt = CURRENT_TIMESTAMP
       WHERE id = $8`,
      [studentName || null, phone || null, parentName || null, parentPhone || null, collegeName || null, course || null, preferredRoomType || null, student.id]
    );

    res.status(200).json({ success: true, message: 'Application details updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  login,
  registerStudentApplication,
  getApplicationStatus,
  forgotPasswordRequest,
  updateProfilePicture,
  changePassword,
  getMe,
  uploadDocument,
  getMyDocuments,
  deleteDocument,
  updateStudentApplication
};
