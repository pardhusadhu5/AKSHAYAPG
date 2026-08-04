const { getDb } = require('../config/db');

// Notifications methods
async function getNotifications(req, res) {
  try {
    const db = await getDb();
    const notifications = await db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 50');
    res.status(200).json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAsRead(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();
    await db.run('UPDATE notifications SET isRead = 1 WHERE id = ?', [id]);
    res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Student Complaints ticket desk
async function submitComplaint(req, res) {
  try {
    const { category, description } = req.body;
    if (!category || !description) {
      return res.status(400).json({ success: false, message: 'Category and description are required.' });
    }

    const db = await getDb();
    
    // Get student ID mapped from authenticated user
    const student = await db.get('SELECT id, studentName FROM students WHERE userId = ?', [req.user.id]);
    if (!student) {
      return res.status(403).json({ success: false, message: 'Only registered hostel students can submit complaints.' });
    }

    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Insert Complaint
      await db.run(
        `INSERT INTO complaints (studentId, category, description, status) VALUES (?, ?, ?, 'pending')`,
        [student.id, category, description]
      );

      // 2. Insert Alert notification for the admin
      await db.run(
        `INSERT INTO notifications (type, message) VALUES (?, ?)`,
        ['new_complaint', `Complaint raised by ${student.studentName} (${category}).`]
      );

      await db.run('COMMIT');
      res.status(201).json({ success: true, message: 'Complaint ticket submitted successfully.' });
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Submit Complaint Error:', err);
    res.status(500).json({ success: false, message: `Failed to submit complaint: ${err.message}` });
  }
}

// Get logged-in student complaints
async function getMyComplaints(req, res) {
  try {
    const db = await getDb();
    const student = await db.get('SELECT id FROM students WHERE userId = ?', [req.user.id]);
    if (!student) {
      return res.status(403).json({ success: false, message: 'Student record not found.' });
    }

    const list = await db.all(
      'SELECT * FROM complaints WHERE studentId = ? ORDER BY id DESC',
      [student.id]
    );
    res.status(200).json({ success: true, complaints: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// List all complaints for the admin
async function getAllComplaints(req, res) {
  try {
    const db = await getDb();
    const list = await db.all(
      `SELECT c.*, s.studentName, s.phone, r.roomNumber
       FROM complaints c
       JOIN students s ON c.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       ORDER BY c.id DESC`
    );
    res.status(200).json({ success: true, complaints: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Resolve/Respond to complaint (Admin/Manager only)
async function resolveComplaint(req, res) {
  try {
    const { id } = req.params;
    const { status, adminRemarks } = req.body; // status: 'in_progress', 'resolved'

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status parameter is required.' });
    }

    const db = await getDb();
    const result = await db.run(
      `UPDATE complaints SET status = ?, adminRemarks = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, adminRemarks || '', id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Complaint ticket not found.' });
    }

    res.status(200).json({ success: true, message: `Complaint status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getNotifications,
  markAsRead,
  submitComplaint,
  getMyComplaints,
  getAllComplaints,
  resolveComplaint
};
