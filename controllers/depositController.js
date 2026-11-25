const { getDb } = require('../config/db');

/**
 * 1. GET SECURITY DEPOSIT STATS (Admin Portal)
 * Endpoint: GET /api/payments/deposits/stats
 * Strictly separated from monthly rent income!
 */
async function getDepositStats(req, res) {
  try {
    const db = await getDb();

    // Total Deposits Held (currently held across active students)
    const heldRes = await db.query(`
      SELECT COALESCE(SUM(depositAmount), 0) as sum 
      FROM students 
      WHERE status = 'active'
    `);
    const totalDepositsHeld = Number(heldRes.rows[0]?.sum || 0);

    // Total Refunds Disbursed (Completed refunds)
    const refundedRes = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as sum 
      FROM security_deposits 
      WHERE transactionType = 'REFUND' AND status = 'COMPLETED'
    `);
    const totalRefunded = Number(refundedRes.rows[0]?.sum || 0);

    // Total Approved Deductions (Damages, repairs, penalties)
    const deductionsRes = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as sum 
      FROM security_deposits 
      WHERE transactionType = 'DEDUCTION'
    `);
    const totalDeductions = Number(deductionsRes.rows[0]?.sum || 0);

    // Pending Refunds (Disbursements queued / awaiting payment)
    const pendingRes = await db.query(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as sum 
      FROM security_deposits 
      WHERE transactionType = 'REFUND' AND status = 'PENDING'
    `);
    const pendingRefundsCount = Number(pendingRes.rows[0]?.count || 0);
    const pendingRefundsAmount = Number(pendingRes.rows[0]?.sum || 0);

    // Total Lifetime Collections
    const totalCollectionsRes = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as sum 
      FROM security_deposits 
      WHERE transactionType = 'COLLECTION' AND status = 'COMPLETED'
    `);
    const totalCollections = Number(totalCollectionsRes.rows[0]?.sum || 0);

    res.status(200).json({
      success: true,
      stats: {
        totalDepositsHeld,
        totalRefunded,
        totalDeductions,
        pendingRefundsCount,
        pendingRefundsAmount,
        totalCollections
      }
    });
  } catch (err) {
    console.error('getDepositStats Error:', err);
    res.status(500).json({ success: false, message: `Failed to fetch deposit stats: ${err.message}` });
  }
}

/**
 * 2. GET SECURITY DEPOSIT LEDGER (Admin Portal)
 * Endpoint: GET /api/payments/deposits/ledger
 */
async function getDepositLedger(req, res) {
  try {
    const { search, type } = req.query;
    const db = await getDb();

    let query = `
      SELECT 
        sd.*,
        s.studentName,
        s.phone,
        s.studentCustomId,
        s.applicationId,
        s.depositStatus,
        r.roomNumber,
        b.bedLabel,
        st.settlementNumber
      FROM security_deposits sd
      JOIN students s ON sd.studentId = s.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      LEFT JOIN settlements st ON sd.settlementId = st.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (type && type !== 'all') {
      if (type === 'PENDING') {
        query += ` AND sd.status = 'PENDING'`;
      } else if (['COLLECTION', 'REFUND', 'DEDUCTION', 'ADJUSTMENT'].includes(type)) {
        query += ` AND sd.transactionType = $${paramIdx++}`;
        params.push(type);
      }
    }

    if (search) {
      query += ` AND (
        s.studentName ILIKE $${paramIdx}
        OR s.phone ILIKE $${paramIdx}
        OR s.studentCustomId ILIKE $${paramIdx}
        OR s.applicationId ILIKE $${paramIdx}
        OR r.roomNumber ILIKE $${paramIdx}
        OR sd.depositNumber ILIKE $${paramIdx}
        OR sd.referenceNumber ILIKE $${paramIdx}
        OR sd.reason ILIKE $${paramIdx}
      )`;
      paramIdx++;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY sd.transactionDate DESC, sd.id DESC`;

    const { rows } = await db.query(query, params);

    const transactions = rows.map(r => ({
      id: r.id,
      depositNumber: r.depositnumber || r.depositNumber,
      studentId: r.studentid || r.studentId,
      studentName: r.studentname || r.studentName,
      phone: r.phone,
      studentCustomId: r.studentcustomid || r.studentCustomId || r.applicationid || r.applicationId || `AKS${String(r.studentid || r.studentId).padStart(6, '0')}`,
      roomNumber: r.roomnumber || r.roomNumber || '—',
      bedLabel: r.bedlabel || r.bedLabel || '—',
      transactionType: r.transactiontype || r.transactionType,
      category: r.category || 'ADMISSION_DEPOSIT',
      amount: Number(r.amount || 0),
      balanceAfter: Number(r.balanceafter || r.balanceAfter || 0),
      paymentMode: r.paymentmode || r.paymentMode || 'UPI',
      referenceNumber: r.referencenumber || r.referenceNumber || null,
      reason: r.reason || '',
      status: r.status || 'COMPLETED',
      settlementId: r.settlementid || r.settlementId || null,
      settlementNumber: r.settlementnumber || r.settlementNumber || null,
      recordedBy: r.recordedby || r.recordedBy || 'Hostel Management',
      transactionDate: r.transactiondate || r.transactionDate,
      createdAt: r.createdat || r.createdAt
    }));

    res.status(200).json({
      success: true,
      transactions,
      count: transactions.length
    });
  } catch (err) {
    console.error('getDepositLedger Error:', err);
    res.status(500).json({ success: false, message: `Failed to fetch deposit ledger: ${err.message}` });
  }
}

/**
 * 3. RECORD DEPOSIT COLLECTION (Admin Portal)
 * Endpoint: POST /api/payments/deposits/collect
 */
async function recordDepositCollection(req, res) {
  try {
    const { studentId, amount, paymentMode, referenceNumber, category, reason } = req.body;

    if (!studentId || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid student ID and positive deposit amount are required.' });
    }

    const collectAmount = parseFloat(amount);
    const db = await getDb();

    // Verify student exists
    const { rows: studentRows } = await db.query(`SELECT * FROM students WHERE id = $1`, [studentId]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const currentHeld = Number(student.depositamount || student.depositAmount || 0);
    const newBalance = currentHeld + collectAmount;
    const depositNumber = `DEP-COL-${Date.now().toString().slice(-6)}-${student.id}`;

    await db.query('BEGIN');

    // 1. Insert deposit transaction
    await db.query(`
      INSERT INTO security_deposits (
        depositNumber, studentId, transactionType, category, amount, balanceAfter,
        paymentMode, referenceNumber, reason, status, recordedBy, transactionDate
      ) VALUES ($1, $2, 'COLLECTION', $3, $4, $5, $6, $7, $8, 'COMPLETED', $9, CURRENT_TIMESTAMP)
    `, [
      depositNumber,
      student.id,
      category || 'ADDITIONAL_DEPOSIT',
      collectAmount,
      newBalance,
      paymentMode || 'UPI',
      referenceNumber || null,
      reason || 'Security deposit collection',
      req.user?.name || 'Hostel Admin'
    ]);

    // 2. Update student deposit balance & status
    await db.query(`
      UPDATE students 
      SET depositAmount = $1, depositStatus = 'HELD', updatedAt = CURRENT_TIMESTAMP 
      WHERE id = $2
    `, [newBalance, student.id]);

    // 3. Notification
    await db.query(`
      INSERT INTO notifications (type, message) VALUES ($1, $2)
    `, [
      'deposit_collected',
      `Security deposit of ₹${collectAmount.toLocaleString('en-IN')} collected for ${student.studentName || student.studentname} (${depositNumber}).`
    ]);

    await db.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Security deposit of ₹${collectAmount.toLocaleString('en-IN')} recorded successfully.`,
      depositNumber,
      newBalance
    });
  } catch (err) {
    console.error('recordDepositCollection Error:', err);
    try { const db = await getDb(); await db.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: `Failed to record deposit collection: ${err.message}` });
  }
}

/**
 * 4. RECORD APPROVED DEDUCTION / DAMAGE CHARGES (Admin Portal)
 * Endpoint: POST /api/payments/deposits/deduct
 */
async function recordDepositDeduction(req, res) {
  try {
    const { studentId, amount, category, reason, notes } = req.body;

    if (!studentId || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid student ID and positive deduction amount are required.' });
    }

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Reason / itemized explanation for deduction is required.' });
    }

    const deductAmount = parseFloat(amount);
    const db = await getDb();

    // Verify student exists
    const { rows: studentRows } = await db.query(`SELECT * FROM students WHERE id = $1`, [studentId]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const currentHeld = Number(student.depositamount || student.depositAmount || 0);
    const currentDeductions = Number(student.depositdeductionsamount || student.depositDeductionsAmount || 0);

    if (deductAmount > currentHeld) {
      return res.status(400).json({
        success: false,
        message: `Deduction amount (₹${deductAmount}) exceeds currently held security deposit (₹${currentHeld}).`
      });
    }

    const newBalance = Math.max(0, currentHeld - deductAmount);
    const totalDeductions = currentDeductions + deductAmount;
    const depositNumber = `DEP-DED-${Date.now().toString().slice(-6)}-${student.id}`;

    await db.query('BEGIN');

    // 1. Insert deduction transaction
    await db.query(`
      INSERT INTO security_deposits (
        depositNumber, studentId, transactionType, category, amount, balanceAfter,
        paymentMode, referenceNumber, reason, status, recordedBy, transactionDate
      ) VALUES ($1, $2, 'DEDUCTION', $3, $4, $5, 'ADJUSTMENT', $6, $7, 'COMPLETED', $8, CURRENT_TIMESTAMP)
    `, [
      depositNumber,
      student.id,
      category || 'DAMAGE_CHARGES',
      deductAmount,
      newBalance,
      notes || null,
      reason,
      req.user?.name || 'Hostel Admin'
    ]);

    // 2. Update student deposit balance & deductions total
    await db.query(`
      UPDATE students 
      SET depositAmount = $1, depositDeductionsAmount = $2, updatedAt = CURRENT_TIMESTAMP 
      WHERE id = $3
    `, [newBalance, totalDeductions, student.id]);

    // 3. Notification
    await db.query(`
      INSERT INTO notifications (type, message) VALUES ($1, $2)
    `, [
      'deposit_deduction',
      `Approved deduction of ₹${deductAmount.toLocaleString('en-IN')} applied on ${student.studentName || student.studentname}'s deposit for: ${reason}. Remaining balance: ₹${newBalance.toLocaleString('en-IN')}.`
    ]);

    await db.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Deposit deduction of ₹${deductAmount.toLocaleString('en-IN')} recorded successfully.`,
      depositNumber,
      deductedAmount: deductAmount,
      remainingBalance: newBalance
    });
  } catch (err) {
    console.error('recordDepositDeduction Error:', err);
    try { const db = await getDb(); await db.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: `Failed to record deduction: ${err.message}` });
  }
}

/**
 * 5. PROCESS DEPOSIT REFUND (Admin Portal - Full or Partial Refund)
 * Endpoint: POST /api/payments/deposits/refund
 */
async function processDepositRefund(req, res) {
  try {
    const { depositId, studentId, amount, paymentMode, referenceNumber, reason, notes } = req.body;
    const db = await getDb();

    // Case A: Disbursing an existing PENDING refund transaction
    if (depositId) {
      const { rows: depRows } = await db.query(`SELECT * FROM security_deposits WHERE id = $1`, [depositId]);
      const dep = depRows[0];
      if (!dep) {
        return res.status(404).json({ success: false, message: 'Pending deposit refund record not found.' });
      }
      if (dep.status === 'COMPLETED') {
        return res.status(400).json({ success: false, message: 'This refund has already been completed.' });
      }

      const { rows: studentRows } = await db.query(`SELECT * FROM students WHERE id = $1`, [dep.studentid || dep.studentId]);
      const student = studentRows[0];

      await db.query('BEGIN');

      // Update deposit transaction to completed
      await db.query(`
        UPDATE security_deposits 
        SET status = 'COMPLETED',
            paymentMode = $1,
            referenceNumber = $2,
            reason = COALESCE($3, reason),
            recordedBy = $4,
            transactionDate = CURRENT_TIMESTAMP
        WHERE id = $5
      `, [
        paymentMode || dep.paymentmode || dep.paymentMode || 'UPI',
        referenceNumber || dep.referencenumber || dep.referenceNumber || null,
        reason || notes || 'Disbursed security deposit refund',
        req.user?.name || 'Hostel Admin',
        depositId
      ]);

      // Update settlement if linked
      if (dep.settlementid || dep.settlementId) {
        await db.query(`
          UPDATE settlements 
          SET status = 'COMPLETED', refundMode = $1, paymentReference = $2 
          WHERE id = $3
        `, [
          paymentMode || 'UPI',
          referenceNumber || null,
          dep.settlementid || dep.settlementId
        ]);
      }

      // Update student depositStatus
      if (student) {
        const curHeld = Number(student.depositamount || student.depositAmount || 0);
        const curRefunded = Number(student.depositrefundedamount || student.depositRefundedAmount || 0) + Number(dep.amount);
        const newStatus = curHeld <= 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        await db.query(`
          UPDATE students 
          SET depositStatus = $1, depositRefundedAmount = $2, updatedAt = CURRENT_TIMESTAMP 
          WHERE id = $3
        `, [newStatus, curRefunded, student.id]);
      }

      await db.query('COMMIT');

      return res.status(200).json({
        success: true,
        message: `Pending refund of ₹${Number(dep.amount).toLocaleString('en-IN')} marked as COMPLETED.`,
        depositNumber: dep.depositnumber || dep.depositNumber
      });
    }

    // Case B: Direct refund creation for a student
    if (!studentId || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid student ID and positive refund amount are required.' });
    }

    const refundAmount = parseFloat(amount);
    const { rows: studentRows } = await db.query(`SELECT * FROM students WHERE id = $1`, [studentId]);
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const currentHeld = Number(student.depositamount || student.depositAmount || 0);
    const currentRefunded = Number(student.depositrefundedamount || student.depositRefundedAmount || 0);

    if (refundAmount > currentHeld) {
      return res.status(400).json({
        success: false,
        message: `Refund amount (₹${refundAmount}) exceeds currently held security deposit (₹${currentHeld}).`
      });
    }

    const newBalance = Math.max(0, currentHeld - refundAmount);
    const totalRefunded = currentRefunded + refundAmount;
    const depositNumber = `DEP-REF-${Date.now().toString().slice(-6)}-${student.id}`;
    const newStatus = newBalance <= 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    await db.query('BEGIN');

    // 1. Insert refund transaction
    await db.query(`
      INSERT INTO security_deposits (
        depositNumber, studentId, transactionType, category, amount, balanceAfter,
        paymentMode, referenceNumber, reason, status, recordedBy, transactionDate
      ) VALUES ($1, $2, 'REFUND', 'DEPOSIT_REFUND', $3, $4, $5, $6, $7, 'COMPLETED', $8, CURRENT_TIMESTAMP)
    `, [
      depositNumber,
      student.id,
      refundAmount,
      newBalance,
      paymentMode || 'UPI',
      referenceNumber || null,
      reason || notes || 'Security deposit refund',
      req.user?.name || 'Hostel Admin'
    ]);

    // 2. Update student record
    await db.query(`
      UPDATE students 
      SET depositAmount = $1, depositRefundedAmount = $2, depositStatus = $3, updatedAt = CURRENT_TIMESTAMP 
      WHERE id = $4
    `, [newBalance, totalRefunded, newStatus, student.id]);

    // 3. Notification
    await db.query(`
      INSERT INTO notifications (type, message) VALUES ($1, $2)
    `, [
      'deposit_refunded',
      `Deposit refund of ₹${refundAmount.toLocaleString('en-IN')} disbursed to ${student.studentName || student.studentname} (${depositNumber}). Remaining balance: ₹${newBalance.toLocaleString('en-IN')}.`
    ]);

    await db.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Deposit refund of ₹${refundAmount.toLocaleString('en-IN')} processed successfully.`,
      depositNumber,
      refundAmount,
      remainingBalance: newBalance,
      depositStatus: newStatus
    });
  } catch (err) {
    console.error('processDepositRefund Error:', err);
    try { const db = await getDb(); await db.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: `Failed to process refund: ${err.message}` });
  }
}

/**
 * 6. GET STUDENT DEPOSIT HISTORY (Student & Admin)
 * Endpoint: GET /api/payments/deposits/student/:studentId
 */
async function getStudentDepositHistory(req, res) {
  try {
    const { studentId } = req.params;
    const db = await getDb();

    // Security check for student role
    if (req.user.role === 'student') {
      const { rows: stRows } = await db.query(`SELECT id FROM students WHERE userId = $1`, [req.user.id]);
      if (!stRows[0] || String(stRows[0].id) !== String(studentId)) {
        return res.status(403).json({ success: false, message: 'Access denied to another student deposit history.' });
      }
    }

    const { rows: studentRows } = await db.query(`
      SELECT 
        s.*, 
        r.roomNumber, 
        b.bedLabel, 
        b.bedNumber
      FROM students s
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      WHERE s.id = $1
    `, [studentId]);

    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Transactions list
    const { rows: transactions } = await db.query(`
      SELECT sd.*, st.settlementNumber
      FROM security_deposits sd
      LEFT JOIN settlements st ON sd.settlementId = st.id
      WHERE sd.studentId = $1
      ORDER BY sd.transactionDate DESC, sd.id DESC
    `, [studentId]);

    // Settlements list
    const { rows: settlements } = await db.query(`
      SELECT * FROM settlements WHERE studentId = $1 ORDER BY id DESC
    `, [studentId]);

    const currentHeld = Number(student.depositamount || student.depositAmount || 0);
    const refunded = Number(student.depositrefundedamount || student.depositRefundedAmount || 0);
    const deductions = Number(student.depositdeductionsamount || student.depositDeductionsAmount || 0);

    const normalizedTransactions = transactions.map(r => ({
      id: r.id,
      depositNumber: r.depositnumber || r.depositNumber,
      studentId: r.studentid || r.studentId,
      transactionType: r.transactiontype || r.transactionType,
      category: r.category,
      amount: Number(r.amount || 0),
      balanceAfter: Number(r.balanceafter || r.balanceAfter || 0),
      paymentMode: r.paymentmode || r.paymentMode,
      referenceNumber: r.referencenumber || r.referenceNumber,
      reason: r.reason,
      status: r.status,
      settlementId: r.settlementid || r.settlementId,
      settlementNumber: r.settlementnumber || r.settlementNumber,
      transactionDate: r.transactiondate || r.transactionDate,
      createdAt: r.createdat || r.createdAt
    }));

    res.status(200).json({
      success: true,
      studentSummary: {
        id: student.id,
        studentName: student.studentName || student.studentname,
        phone: student.phone,
        studentCustomId: student.studentCustomId || student.studentcustomid || student.applicationId || student.applicationid,
        roomNumber: student.roomNumber || student.roomnumber || '—',
        bedLabel: student.bedLabel || student.bedlabel || (student.bedNumber ? `Bed ${student.bedNumber}` : '—'),
        depositHeld: currentHeld,
        totalRefunded: refunded,
        totalDeductions: deductions,
        depositStatus: student.depositstatus || student.depositStatus || 'HELD',
        stayStatus: student.staystatus || student.stayStatus || 'CHECKED_IN'
      },
      transactions: normalizedTransactions,
      settlements
    });
  } catch (err) {
    console.error('getStudentDepositHistory Error:', err);
    res.status(500).json({ success: false, message: `Failed to load deposit history: ${err.message}` });
  }
}

/**
 * 7. GET PENDING REFUNDS LIST (Admin Portal)
 * Endpoint: GET /api/payments/deposits/pending-refunds
 */
async function getPendingRefunds(req, res) {
  try {
    const db = await getDb();

    const { rows: pendingDeposits } = await db.query(`
      SELECT 
        sd.*,
        s.studentName,
        s.phone,
        s.studentCustomId,
        s.applicationId,
        s.checkOutDate,
        s.checkOutReason,
        r.roomNumber,
        b.bedLabel,
        st.settlementNumber
      FROM security_deposits sd
      JOIN students s ON sd.studentId = s.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN beds b ON s.bedId = b.id
      LEFT JOIN settlements st ON sd.settlementId = st.id
      WHERE sd.transactionType = 'REFUND' AND sd.status = 'PENDING'
      ORDER BY sd.transactionDate ASC, sd.id ASC
    `);

    res.status(200).json({
      success: true,
      pendingRefunds: pendingDeposits.map(r => ({
        id: r.id,
        depositNumber: r.depositnumber || r.depositNumber,
        studentId: r.studentid || r.studentId,
        studentName: r.studentname || r.studentName,
        phone: r.phone,
        studentCustomId: r.studentcustomid || r.studentCustomId || r.applicationid || r.applicationId || `AKS${String(r.studentid || r.studentId).padStart(6, '0')}`,
        roomNumber: r.roomnumber || r.roomNumber || '—',
        bedLabel: r.bedlabel || r.bedLabel || '—',
        amount: Number(r.amount || 0),
        reason: r.reason || 'Checkout deposit refund',
        settlementId: r.settlementid || r.settlementId,
        settlementNumber: r.settlementnumber || r.settlementNumber,
        checkOutDate: r.checkoutdate || r.checkOutDate,
        transactionDate: r.transactiondate || r.transactionDate
      })),
      count: pendingDeposits.length
    });
  } catch (err) {
    console.error('getPendingRefunds Error:', err);
    res.status(500).json({ success: false, message: `Failed to fetch pending refunds: ${err.message}` });
  }
}

/**
 * 8. GET & UPDATE DEPOSIT CONFIGURATION (Admin Portal)
 * Endpoints: GET /api/payments/deposits/config, PUT /api/payments/deposits/config
 */
async function getDepositConfig(req, res) {
  try {
    const db = await getDb();
    const { rows } = await db.query(`
      SELECT key, value FROM hostelSettings 
      WHERE key IN ('depositAmount', 'depositRefundPolicy')
    `);
    const config = {};
    rows.forEach(r => { config[r.key] = r.value; });

    res.status(200).json({
      success: true,
      config: {
        depositAmount: config.depositAmount || '3000',
        depositRefundPolicy: config.depositRefundPolicy || 'Security deposits are fully refundable within 3-5 business days of checkout after room inspection and clearance of pending dues.'
      }
    });
  } catch (err) {
    console.error('getDepositConfig Error:', err);
    res.status(500).json({ success: false, message: `Failed to load deposit config: ${err.message}` });
  }
}

async function updateDepositConfig(req, res) {
  try {
    const { depositAmount, depositRefundPolicy } = req.body;
    if (!depositAmount || isNaN(parseFloat(depositAmount)) || parseFloat(depositAmount) < 0) {
      return res.status(400).json({ success: false, message: 'Valid positive deposit amount is required.' });
    }

    const db = await getDb();

    await db.query(`
      INSERT INTO hostelSettings (key, value) VALUES ('depositAmount', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [String(depositAmount)]);

    if (depositRefundPolicy) {
      await db.query(`
        INSERT INTO hostelSettings (key, value) VALUES ('depositRefundPolicy', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [String(depositRefundPolicy)]);
    }

    res.status(200).json({
      success: true,
      message: 'Security deposit configuration updated successfully.',
      config: { depositAmount, depositRefundPolicy }
    });
  } catch (err) {
    console.error('updateDepositConfig Error:', err);
    res.status(500).json({ success: false, message: `Failed to update deposit config: ${err.message}` });
  }
}

module.exports = {
  getDepositStats,
  getDepositLedger,
  recordDepositCollection,
  recordDepositDeduction,
  processDepositRefund,
  getStudentDepositHistory,
  getPendingRefunds,
  getDepositConfig,
  updateDepositConfig
};
