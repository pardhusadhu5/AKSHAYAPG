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
      const user = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
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
      const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
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

async function register(req, res) {
  try {
    const {
      name,
      email,
      phone,
      aadhaarNumber,
      collegeName,
      year,
      parentName,
      parentPhone,
      password,
      confirmPassword
    } = req.body;

    // Check basic parameters
    if (!name || !phone || !aadhaarNumber || !collegeName || !year || !parentName || !parentPhone || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All registration fields are required.' });
    }

    // Validation: Passwords match
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const db = await getDb();

    // Validation: Mobile Number uniqueness
    const existingPhone = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existingPhone) {
      return res.status(400).json({ success: false, message: 'This mobile number is already registered.' });
    }

    // Validation: Email uniqueness
    const mockEmail = email || `student_${phone}@akshayadeluxepg.com`; // fallback email for user record
    const existingEmail = await db.get('SELECT * FROM users WHERE email = ?', [mockEmail]);
    if (existingEmail) {
      return res.status(400).json({ success: false, message: 'This email is already registered.' });
    }

    // Validation: Aadhaar uniqueness
    const existingAadhaar = await db.get('SELECT * FROM students WHERE aadhaarNumber = ?', [aadhaarNumber]);
    if (existingAadhaar) {
      return res.status(400).json({ success: false, message: 'This Aadhaar number is already registered.' });
    }

    // Handle Photo upload
    let photoPath = '/assets/avatar-placeholder.png'; // fallback placeholder
    if (req.file) {
      photoPath = `/uploads/${req.file.filename}`;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Start transaction
    await db.run('BEGIN TRANSACTION');

    const userResult = await db.run(
      `INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)`,
      [name, mockEmail, phone, hashedPassword, 'student']
    );

    const userId = userResult.lastID;
    const joinDate = new Date().toISOString().split('T')[0];

    await db.run(
      `INSERT INTO students (userId, studentName, phone, parentName, parentPhone, aadhaarNumber, collegeName, course, year, address, photo, idProof, joinDate, monthlyRent, depositAmount, roomId, bedId, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        name,
        phone,
        parentName,
        parentPhone,
        aadhaarNumber,
        collegeName,
        'N/A', // course placeholder
        year,
        '', // address placeholder
        photoPath,
        '', // idProof placeholder
        joinDate,
        8500, // default monthly rent placeholder
        8500, // default deposit placeholder
        null, // default room placeholder
        null, // default bed placeholder
        'active'
      ]
    );

    await db.run('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Registration completed successfully.'
    });
  } catch (err) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
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
    const currentStudent = await db.get('SELECT photo FROM students WHERE userId = ?', [req.user.id]);
    if (currentStudent && currentStudent.photo && currentStudent.photo.startsWith('/uploads/')) {
      const oldFilePath = path.join(__dirname, '..', currentStudent.photo);
      fs.unlink(oldFilePath, (err) => {
        if (err) console.error('Failed to delete old photo:', err);
      });
    }

    await db.run('UPDATE students SET photo = ? WHERE userId = ?', [photoPath, req.user.id]);

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
    const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect current password.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [hashedPassword, req.user.id]);

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
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

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

    await db.run(
      'UPDATE users SET password = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedPassword, decoded.id]
    );

    res.status(200).json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getMe(req, res) {
  try {
    const db = await getDb();
    const user = await db.get('SELECT id, name, email, phone, role, createdAt FROM users WHERE id = ?', [req.user.id]);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let studentProfile = null;
    if (user.role === 'student') {
      studentProfile = await db.get(`
        SELECT s.*, r.roomNumber, b.bedNumber
        FROM students s
        LEFT JOIN rooms r ON s.roomId = r.id
        LEFT JOIN beds b ON s.bedId = b.id
        WHERE s.userId = ?
      `, [user.id]);
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
    const student = await db.get('SELECT id FROM students WHERE userId = ?', [req.user.id]);
    if (!student) {
      return res.status(403).json({ success: false, message: 'Only students can upload documents.' });
    }

    const filePath = '/uploads/' + req.file.filename;
    const fileType = path.extname(req.file.originalname).substring(1).toLowerCase();

    await db.run(
      `INSERT INTO documents (studentId, name, filePath, fileType) VALUES (?, ?, ?, ?)`,
      [student.id, name, filePath, fileType]
    );

    res.status(201).json({ success: true, message: 'Document uploaded successfully.', document: { name, filePath, fileType } });
  } catch (err) {
    console.error('Upload Doc Error:', err);
    res.status(500).json({ success: false, message: 'Failed to upload document.' });
  }
}

async function getMyDocuments(req, res) {
  try {
    const db = await getDb();
    const student = await db.get('SELECT id FROM students WHERE userId = ?', [req.user.id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const documents = await db.all('SELECT * FROM documents WHERE studentId = ? ORDER BY id DESC', [student.id]);
    res.status(200).json({ success: true, documents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteDocument(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const student = await db.get('SELECT id FROM students WHERE userId = ?', [req.user.id]);
    if (!student) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const doc = await db.get('SELECT * FROM documents WHERE id = ? AND studentId = ?', [id, student.id]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    await db.run('DELETE FROM documents WHERE id = ?', [id]);

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
  deleteDocument
};
