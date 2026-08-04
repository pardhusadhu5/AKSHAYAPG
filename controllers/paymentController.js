const { getDb } = require('../config/db');

// Generate monthly fee invoices for all active students with assigned rooms
async function generateMonthlyFee(req, res) {
  try {
    const { billingMonth } = req.body; // Expect format 'YYYY-MM', e.g., '2026-08'
    if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
      return res.status(400).json({ success: false, message: 'Valid billing month (YYYY-MM) is required.' });
    }

    const db = await getDb();

    // Query active students who are allocated to rooms
    const students = await db.all(
      `SELECT id, studentName, monthlyRent FROM students WHERE status = 'active' AND roomId IS NOT NULL`
    );

    if (students.length === 0) {
      return res.status(400).json({ success: false, message: 'No active allocated students found to bill.' });
    }

    await db.run('BEGIN TRANSACTION');
    let generatedCount = 0;
    let skippedCount = 0;

    try {
      for (const student of students) {
        // Check if invoice already exists
        const existing = await db.get(
          'SELECT id FROM payments WHERE studentId = ? AND billingMonth = ?',
          [student.id, billingMonth]
        );

        if (existing) {
          skippedCount++;
          continue;
        }

        // Insert new pending monthly payment invoice
        await db.run(
          `INSERT INTO payments (studentId, billingMonth, amountDue, amountPaid, status) VALUES (?, ?, ?, 0, 'pending')`,
          [student.id, billingMonth, student.monthlyRent]
        );

        // Update student's local paymentStatus flag to unpaid
        await db.run(
          `UPDATE students SET paymentStatus = 'unpaid', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
          [student.id]
        );

        generatedCount++;
      }

      // Add Notification
      if (generatedCount > 0) {
        await db.run(
          `INSERT INTO notifications (type, message) VALUES (?, ?)`,
          ['payment_due', `Generated monthly invoices for ${generatedCount} students for ${billingMonth}.`]
        );
      }

      await db.run('COMMIT');
      res.status(200).json({
        success: true,
        message: `Billing run complete. Generated: ${generatedCount}, Skipped (Already billed): ${skippedCount}.`
      });
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Invoice Generation Error:', err);
    res.status(500).json({ success: false, message: `Failed to generate monthly fees: ${err.message}` });
  }
}

// Record manual payment (Cash/UPI)
async function recordPayment(req, res) {
  try {
    const { id } = req.params; // payment invoice ID
    const { amount, paymentMode, referenceNumber, notes } = req.body;

    if (!amount || !paymentMode) {
      return res.status(400).json({ success: false, message: 'Amount and payment mode are required.' });
    }

    const payAmt = parseFloat(amount);
    if (payAmt <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero.' });
    }

    const db = await getDb();

    // Query Payment
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment invoice not found.' });
    }

    const totalPaid = payment.amountPaid + payAmt;
    let nextStatus = 'pending';
    if (totalPaid >= payment.amountDue) {
      nextStatus = 'paid';
    } else if (totalPaid > 0) {
      nextStatus = 'partial';
    }

    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Update Payment status
      await db.run(
        `UPDATE payments SET amountPaid = ?, status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [totalPaid, nextStatus, id]
      );

      // 2. Insert into History
      await db.run(
        `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) VALUES (?, ?, ?, ?, ?)`,
        [id, payAmt, paymentMode, referenceNumber || '', notes || '']
      );

      // 3. Update student payment flag if invoice is paid off
      if (nextStatus === 'paid') {
        await db.run(
          `UPDATE students SET paymentStatus = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
          [payment.studentId]
        );

        // Add Notification log
        const stud = await db.get('SELECT studentName FROM students WHERE id = ?', [payment.studentId]);
        await db.run(
          `INSERT INTO notifications (type, message) VALUES (?, ?)`,
          ['payment_received', `Rent payment received from ${stud ? stud.studentName : 'Student'}.`]
        );
      }

      await db.run('COMMIT');
      res.status(200).json({ success: true, message: `Successfully recorded payment of ₹${payAmt} as ${nextStatus}.` });
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Record Payment Error:', err);
    res.status(500).json({ success: false, message: `Failed to record payment: ${err.message}` });
  }
}

// Simulate Online Razorpay Checkout payment callback webhook
async function simulateOnlinePayment(req, res) {
  try {
    const { id } = req.params; // payment ID
    const { razorpayPaymentId } = req.body;
    
    const db = await getDb();

    // Query Payment
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [id]);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment invoice not found.' });
    }

    const remainingDue = payment.amountDue - payment.amountPaid;
    if (remainingDue <= 0) {
      return res.status(400).json({ success: false, message: 'This invoice has already been fully paid.' });
    }

    const txId = razorpayPaymentId || 'pay_sim_' + Math.random().toString(36).substring(2, 10).toUpperCase();

    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Update Payment status to paid
      await db.run(
        `UPDATE payments SET amountPaid = ?, status = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [payment.amountDue, id]
      );

      // 2. Insert into History
      await db.run(
        `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) VALUES (?, ?, ?, ?, ?)`,
        [id, remainingDue, 'online', txId, 'Simulated Razorpay Online checkout']
      );

      // 3. Update student payment flag to paid
      await db.run(
        `UPDATE students SET paymentStatus = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [payment.studentId]
      );

      // 4. Create Notification
      const stud = await db.get('SELECT studentName FROM students WHERE id = ?', [payment.studentId]);
      await db.run(
        `INSERT INTO notifications (type, message) VALUES (?, ?)`,
        ['payment_received', `Online rent payment (Razorpay) received from ${stud ? stud.studentName : 'Student'}.`]
      );

      await db.run('COMMIT');
      res.status(200).json({ success: true, message: 'Razorpay simulated online payment successful.', transactionId: txId });
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Online Simulation Error:', err);
    res.status(500).json({ success: false, message: `Online simulation failed: ${err.message}` });
  }
}

// Generate receipt structured data
async function getPaymentReceipt(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const payment = await db.get(
      `SELECT p.*, s.studentName, s.phone, r.roomNumber, b.bedNumber
       FROM payments p
       JOIN students s ON p.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE p.id = ?`,
      [id]
    );

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment invoice not found.' });
    }

    const history = await db.all(
      'SELECT id, amount, paymentDate, paymentMode, referenceNumber FROM paymentHistory WHERE paymentId = ? ORDER BY id DESC',
      [id]
    );

    res.status(200).json({
      success: true,
      receipt: {
        receiptNo: `REC-${payment.id}-${payment.billingMonth.replace('-', '')}`,
        date: payment.updatedAt.split(' ')[0],
        studentName: payment.studentName,
        phone: payment.phone,
        roomNumber: payment.roomNumber || 'Unassigned',
        bedNumber: payment.bedNumber || 'Unassigned',
        billingMonth: payment.billingMonth,
        amountDue: payment.amountDue,
        amountPaid: payment.amountPaid,
        status: payment.status,
        transactions: history
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Fetch revenue collections aggregates (daily, monthly, yearly summaries)
async function getPaymentStats(req, res) {
  try {
    const db = await getDb();

    // Daily Collection (Today)
    const dailyResult = await db.get(
      `SELECT SUM(amount) as sum FROM paymentHistory WHERE date(paymentDate) = date('now')`
    );
    const daily = dailyResult && dailyResult.sum ? dailyResult.sum : 0;

    // Monthly Collection (Current Month)
    const monthlyResult = await db.get(
      `SELECT SUM(amount) as sum FROM paymentHistory WHERE strftime('%Y-%m', paymentDate) = strftime('%Y-%m', 'now')`
    );
    const monthly = monthlyResult && monthlyResult.sum ? monthlyResult.sum : 0;

    // Yearly Collection (Current Year)
    const yearlyResult = await db.get(
      `SELECT SUM(amount) as sum FROM paymentHistory WHERE strftime('%Y', paymentDate) = strftime('%Y', 'now')`
    );
    const yearly = yearlyResult && yearlyResult.sum ? yearlyResult.sum : 0;

    // Outstanding Dues
    const outstandingResult = await db.get(
      `SELECT SUM(amountDue - amountPaid) as sum FROM payments WHERE status != 'paid'`
    );
    const outstanding = outstandingResult && outstandingResult.sum ? outstandingResult.sum : 0;

    res.status(200).json({
      success: true,
      stats: {
        daily,
        monthly,
        yearly,
        outstanding
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Fetch payment invoices for the logged-in student
async function getMyPayments(req, res) {
  try {
    const db = await getDb();
    const student = await db.get('SELECT id FROM students WHERE userId = ?', [req.user.id]);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const payments = await db.all(
      `SELECT p.*, r.roomNumber, b.bedNumber
       FROM payments p
       JOIN students s ON p.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE p.studentId = ?
       ORDER BY p.billingMonth DESC`,
      [student.id]
    );

    res.status(200).json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// Fetch all generated payment invoices (Admin/Manager only)
async function getAllPayments(req, res) {
  try {
    const db = await getDb();
    const payments = await db.all(
      `SELECT p.*, s.studentName, s.phone, r.roomNumber
       FROM payments p
       JOIN students s ON p.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       ORDER BY p.billingMonth DESC, p.id DESC`
    );
    res.status(200).json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  generateMonthlyFee,
  recordPayment,
  simulateOnlinePayment,
  getPaymentReceipt,
  getPaymentStats,
  getMyPayments,
  getAllPayments
};
