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
    const student = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Insert Reminder log
    await db.run(
      `INSERT INTO reminders (studentId, title, message, channel, status) VALUES (?, ?, ?, ?, 'sent')`,
      [studentId, title || 'Rent Due Alert', message, channel]
    );

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
    const unpaidPayments = await db.all(
      `SELECT p.id, p.amountDue, p.amountPaid, s.id as studentId, s.studentName, s.phone, s.parentPhone
       FROM payments p
       JOIN students s ON p.studentId = s.id
       WHERE p.billingMonth = ? AND p.status != 'paid'`,
      [billingMonth]
    );

    if (unpaidPayments.length === 0) {
      return res.status(200).json({ success: true, message: 'All student accounts are fully paid for this month.' });
    }

    await db.run('BEGIN TRANSACTION');
    try {
      for (const pay of unpaidPayments) {
        const dueAmt = pay.amountDue - pay.amountPaid;
        const msg = `Hello ${pay.studentName}, your rent balance of Rs. ${dueAmt} for ${billingMonth} is pending. Please complete your payment. Regards, Akshaya Deluxe Boys Hostel.`;
        
        await db.run(
          `INSERT INTO reminders (studentId, title, message, channel, status) VALUES (?, ?, ?, 'whatsapp', 'sent')`,
          [pay.studentId, `Rent Due ${billingMonth}`, msg]
        );
      }
      await db.run('COMMIT');
      res.status(200).json({ success: true, message: `Dispatched WhatsApp reminders to ${unpaidPayments.length} unpaid students.` });
    } catch (txErr) {
      await db.run('ROLLBACK');
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
    const logs = await db.all(
      `SELECT r.*, s.studentName, s.phone
       FROM reminders r
       JOIN students s ON r.studentId = s.id
       ORDER BY r.id DESC LIMIT 100`
    );
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
