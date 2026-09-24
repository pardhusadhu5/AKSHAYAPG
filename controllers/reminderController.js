const { getDb } = require('../config/db');

// Send individual reminder
async function sendIndividualReminder(req, res) {
  try {
    const { studentId, title, message, channel } = req.body;
    if (!studentId || !message || !channel) {
      return res.status(400).json({ success: false, message: 'Student ID, message, and channel are required.' });
    }

    const db = await getDb();

    // Verify Student
    const student = (await (async () => { let args = ['SELECT * FROM students WHERE id = $1', [studentId]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Insert Reminder log
    (await (async () => {
         let args = [
      `INSERT INTO reminders (studentId, title, message, channel, status) VALUES ($1, $2, $3, $4, 'sent')`,
      [studentId, title || 'Rent Due Alert', message, channel]
    ];
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
      message: `Reminder logged successfully via ${channel}.`,
      recipientPhone: student.parentPhone || student.phone,
      studentName: student.studentName
    });
  } catch (err) {
    console.error('Send Reminder Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Send bulk reminders to all unpaid students
async function sendBulkReminders(req, res) {
  try {
    const { billingMonth } = req.body; // e.g. '2026-08'
    if (!billingMonth) {
      return res.status(400).json({ success: false, message: 'Billing month is required.' });
    }

    const db = await getDb();

    // Query unpaid invoices for that billing month
    const unpaidPayments = (await (async () => { let args = [
      `SELECT p.id, p.amountDue, p.amountPaid, s.id as studentId, s.studentName, s.phone, s.parentPhone
       FROM payments p
       JOIN students s ON p.studentId = s.id
       WHERE p.billingMonth = $1 AND p.status != 'paid'`,
      [billingMonth]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());

    if (unpaidPayments.length === 0) {
      return res.status(200).json({ success: true, message: 'All student accounts are fully paid for this month.' });
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
      for (const pay of unpaidPayments) {
        const dueAmt = pay.amountDue - pay.amountPaid;
        const msg = `Hello ${pay.studentName}, your rent balance of Rs. ${dueAmt} for ${billingMonth} is pending. Please complete your payment. Regards, Akshaya Deluxe Boys Hostel.`;
        
        (await (async () => {
         let args = [
          `INSERT INTO reminders (studentId, title, message, channel, status) VALUES ($1, $2, $3, 'whatsapp', 'sent')`,
          [pay.studentId, `Rent Due ${billingMonth}`, msg]
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
      res.status(200).json({ success: true, message: `Dispatched WhatsApp reminders to ${unpaidPayments.length} unpaid students.` });
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
    console.error('Send Bulk Reminders Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Fetch reminders sent log
async function getReminderLogs(req, res) {
  try {
    const db = await getDb();
    const logs = (await (async () => { let args = [
      `SELECT r.*, s.studentName, s.phone
       FROM reminders r
       JOIN students s ON r.studentId = s.id
       ORDER BY r.id DESC LIMIT 100`
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
    res.status(200).json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  sendIndividualReminder,
  sendBulkReminders,
  getReminderLogs
};
