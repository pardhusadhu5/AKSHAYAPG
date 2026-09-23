const { getDb } = require('../config/db');

// Notifications methods
async function getNotifications(req, res) {
  try {
    const db = await getDb();
    const notifications = (await (async () => { let args = ['SELECT * FROM notifications ORDER BY id DESC LIMIT 50']; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    res.status(200).json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function markAsRead(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();
    (await (async () => {
         let args = ['UPDATE notifications SET isRead = 1 WHERE id = $1', [id]];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
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
    const student = (await (async () => { let args = ['SELECT id, studentName FROM students WHERE userId = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!student) {
      return res.status(403).json({ success: false, message: 'Only registered hostel students can submit complaints.' });
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
      // 1. Insert Complaint
      (await (async () => {
         let args = [
        `INSERT INTO complaints (studentId, category, description, status) VALUES ($1, $2, $3, 'pending')`,
        [student.id, category, description]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // 2. Insert Alert notification for the admin
      (await (async () => {
         let args = [
        `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
        ['new_complaint', `Complaint raised by ${student.studentName} (${category}).`]
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
      res.status(201).json({ success: true, message: 'Complaint ticket submitted successfully.' });
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
    console.error('Submit Complaint Error:', err);
    res.status(500).json({ success: false, message: `Failed to submit complaint: ${err.message}` });
  }
}

// Get logged-in student complaints
async function getMyComplaints(req, res) {
  try {
    const db = await getDb();
    const student = (await (async () => { let args = ['SELECT id FROM students WHERE userId = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!student) {
      return res.status(403).json({ success: false, message: 'Student record not found.' });
    }

    const list = (await (async () => { let args = [
      'SELECT * FROM complaints WHERE studentId = $1 ORDER BY id DESC',
      [student.id]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    res.status(200).json({ success: true, complaints: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// List all complaints for the admin
async function getAllComplaints(req, res) {
  try {
    const db = await getDb();
    const list = (await (async () => { let args = [
      `SELECT c.*, s.studentName, s.phone, r.roomNumber
       FROM complaints c
       JOIN students s ON c.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       ORDER BY c.id DESC`
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
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
    const result = (await (async () => {
         let args = [
      `UPDATE complaints SET status = $1, adminRemarks = $2, updatedAt = CURRENT_TIMESTAMP WHERE id = $3`,
      [status, adminRemarks || '', id]
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
