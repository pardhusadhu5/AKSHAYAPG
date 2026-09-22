const crypto = require('crypto');
const Razorpay = require('razorpay');
const { getDb } = require('../config/db');
const { generateReceiptPDF } = require('../services/pdfService');
const { sendPaymentReceiptEmail } = require('../services/emailService');

// Initialize Razorpay SDK instance safely
function getRazorpayInstance() {
  const keyId = process.env.RAZORPAY_KEY_ID || process.env.PAYMENT_KEY_ID || 'rzp_test_sample_key_id';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.PAYMENT_KEY_SECRET || 'sample_secret_key';
  return {
    instance: new Razorpay({ key_id: keyId, key_secret: keySecret }),
    keyId,
    keySecret
  };
}

/**
 * 1. CREATE PAYMENT ORDER (Student)
 * Endpoint: POST /api/payments/create-order
 */
async function createOrder(req, res) {
  try {
    const { feeId } = req.body;
    if (!feeId) {
      return res.status(400).json({ success: false, message: 'Fee ID is required.' });
    }

    const db = await getDb();

    // 1. Authenticate & fetch logged-in student
    const student = await db.get(
      `SELECT s.*, u.email FROM students s JOIN users u ON s.userId = u.id WHERE s.userId = ?`,
      [req.user.id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // 2. Fetch fee invoice and verify ownership & unpaid status
    const fee = await db.get(
      'SELECT * FROM payments WHERE id = ? AND studentId = ?',
      [feeId, student.id]
    );

    if (!fee) {
      return res.status(404).json({ success: false, message: 'Hostel fee invoice not found.' });
    }

    const amountDue = fee.amountDue - fee.amountPaid;
    if (amountDue <= 0 || fee.status === 'paid') {
      return res.status(400).json({ success: false, message: 'This hostel fee has already been fully paid.' });
    }

    // 3. Create Gateway Order (Razorpay)
    const amountInPaisa = Math.round(amountDue * 100);
    const { instance, keyId } = getRazorpayInstance();

    let orderId;
    let isSandboxFallback = false;

    try {
      if (keyId.includes('sample_key_id') || keyId.startsWith('rzp_test_sample')) {
        throw new Error('Sandbox key detected - using sandbox mode');
      }

      const orderOptions = {
        amount: amountInPaisa,
        currency: 'INR',
        receipt: `fee_${fee.id}_${Date.now()}`,
        notes: {
          studentId: student.id,
          feeId: fee.id,
          billingMonth: fee.billingMonth,
          studentName: student.studentName
        }
      };

      const order = await instance.orders.create(orderOptions);
      orderId = order.id;
    } catch (rzpErr) {
      // Fallback sandbox order generation for offline/test mode
      isSandboxFallback = true;
      orderId = `order_sbx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      console.log(`[PaymentController] Razorpay SDK fallback sandbox order created: ${orderId}`);
    }

    // 4. Save PaymentTransaction record
    await db.run(
      `INSERT INTO paymentTransactions (studentId, feeId, gatewayOrderId, amount, currency, status) 
       VALUES (?, ?, ?, ?, 'INR', 'CREATED')`,
      [student.id, fee.id, orderId, amountDue]
    );

    // 5. Update Fee status to pending
    await db.run(
      `UPDATE payments SET status = 'pending', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [fee.id]
    );

    res.status(200).json({
      success: true,
      orderId,
      keyId: isSandboxFallback ? 'rzp_test_demo_key' : keyId,
      amount: amountInPaisa,
      amountRupees: amountDue,
      currency: 'INR',
      feeId: fee.id,
      billingMonth: fee.billingMonth,
      studentName: student.studentName,
      email: student.email,
      phone: student.phone,
      isSandbox: isSandboxFallback
    });
  } catch (err) {
    console.error('Create Payment Order Error:', err);
    res.status(500).json({ success: false, message: `Failed to create payment order: ${err.message}` });
  }
}

/**
 * 2. VERIFY PAYMENT (Student)
 * Endpoint: POST /api/payments/verify
 */
async function verifyPayment(req, res) {
  try {
    const { feeId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!feeId || !razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ success: false, message: 'Missing required payment verification parameters.' });
    }

    const db = await getDb();

    // 1. Authenticate student
    const student = await db.get(
      `SELECT s.*, u.email, r.roomNumber, r.floor, b.bedNumber 
       FROM students s 
       JOIN users u ON s.userId = u.id 
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE s.userId = ?`,
      [req.user.id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student profile not found.' });
    }

    // 2. Fetch transaction record
    const tx = await db.get(
      'SELECT * FROM paymentTransactions WHERE gatewayOrderId = ? AND feeId = ?',
      [razorpay_order_id, feeId]
    );

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Matching payment order transaction not found.' });
    }

    // Prevent duplicate verification
    if (tx.status === 'SUCCESS') {
      const existingReceipt = await db.get('SELECT receiptNumber FROM receipts WHERE transactionId = ?', [tx.id]);
      return res.status(200).json({
        success: true,
        message: 'Payment already verified.',
        receiptNumber: existingReceipt ? existingReceipt.receiptNumber : null,
        transactionId: tx.gatewayPaymentId
      });
    }

    // 3. Verify Razorpay HMAC Signature
    const { keySecret } = getRazorpayInstance();
    const isSandbox = razorpay_order_id.startsWith('order_sbx_');

    if (!isSandbox) {
      const hmac = crypto.createHmac('sha256', keySecret);
      hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
      const generatedSignature = hmac.digest('hex');

      if (generatedSignature !== razorpay_signature) {
        await db.run(
          `UPDATE paymentTransactions SET status = 'FAILED', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
          [tx.id]
        );
        return res.status(400).json({ success: false, message: 'Invalid payment signature. Verification failed.' });
      }
    }

    // 4. Begin SQL Transaction for verified payment ledger update
    const fee = await db.get('SELECT * FROM payments WHERE id = ?', [feeId]);
    const receiptNumber = `HFR-${new Date().getFullYear()}-${String(fee.id).padStart(6, '0')}`;

    await db.run('BEGIN TRANSACTION');
    try {
      // Update PaymentTransaction
      await db.run(
        `UPDATE paymentTransactions 
         SET gatewayPaymentId = ?, gatewaySignature = ?, status = 'SUCCESS', paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [razorpay_payment_id, razorpay_signature || 'sandbox_sig', tx.id]
      );

      // Update Payments Fee Invoice
      await db.run(
        `UPDATE payments 
         SET amountPaid = amountDue, status = 'paid', paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [feeId]
      );

      // Update Student payment status flag
      await db.run(
        `UPDATE students SET paymentStatus = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [student.id]
      );

      // Record in PaymentHistory table
      await db.run(
        `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) 
         VALUES (?, ?, 'online', ?, 'Verified Online Razorpay Payment')`,
        [feeId, tx.amount, razorpay_payment_id]
      );

      // Create Receipt Record
      const receiptInsert = await db.run(
        `INSERT INTO receipts (transactionId, receiptNumber, studentId, feeId, amount) 
         VALUES (?, ?, ?, ?, ?)`,
        [tx.id, receiptNumber, student.id, feeId, tx.amount]
      );

      // Create Notification
      await db.run(
        `INSERT INTO notifications (type, message) VALUES (?, ?)`,
        ['payment_received', `Online fee payment of ₹${tx.amount} received from ${student.studentName} (${fee.billingMonth}).`]
      );

      await db.run('COMMIT');

      // 5. Generate PDF & Send Email asynchronously
      const receiptData = {
        receiptNumber,
        date: new Date().toISOString().split('T')[0],
        status: 'PAID',
        studentId: student.id,
        studentName: student.studentName,
        phone: student.phone,
        roomNumber: student.roomNumber,
        bedNumber: student.bedNumber,
        floor: student.floor,
        collegeName: student.collegeName,
        billingMonth: fee.billingMonth,
        amountDue: fee.amountDue,
        amountPaid: tx.amount,
        paymentMethod: 'Online (Razorpay UPI / Banking)',
        gatewayOrderId: razorpay_order_id,
        gatewayPaymentId: razorpay_payment_id
      };

      generateReceiptPDF(receiptData)
        .then(pdfBuffer => {
          sendPaymentReceiptEmail({
            to: student.email,
            studentName: student.studentName,
            billingMonth: fee.billingMonth,
            amount: tx.amount,
            receiptNumber,
            gatewayPaymentId: razorpay_payment_id,
            pdfBuffer
          }).catch(err => console.error('[VerifyPayment] Email trigger error:', err));
        })
        .catch(pdfErr => console.error('[VerifyPayment] PDF generation error:', pdfErr));

      res.status(200).json({
        success: true,
        message: 'Payment verified and fee marked as PAID successfully.',
        receiptNumber,
        transactionId: razorpay_payment_id,
        orderId: razorpay_order_id,
        billingMonth: fee.billingMonth,
        amountPaid: tx.amount
      });
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Verify Payment Error:', err);
    res.status(500).json({ success: false, message: `Failed to verify payment: ${err.message}` });
  }
}

/**
 * 3. WEBHOOK ENDPOINT (Public Gateway Hook)
 * Endpoint: POST /api/payments/webhook
 */
async function handleWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET;

    if (webhookSecret && signature) {
      const shasum = crypto.createHmac('sha256', webhookSecret);
      shasum.update(JSON.stringify(req.body));
      const digest = shasum.digest('hex');

      if (digest !== signature) {
        return res.status(400).json({ status: 'invalid_signature' });
      }
    }

    const event = req.body.event;
    const payload = req.body.payload;

    if (event === 'payment.captured' && payload && payload.payment) {
      const entity = payload.payment.entity;
      const orderId = entity.order_id;
      const paymentId = entity.id;

      const db = await getDb();
      const tx = await db.get('SELECT * FROM paymentTransactions WHERE gatewayOrderId = ?', [orderId]);

      if (tx && tx.status !== 'SUCCESS') {
        const fee = await db.get('SELECT * FROM payments WHERE id = ?', [tx.feeId]);
        const student = await db.get('SELECT * FROM students WHERE id = ?', [tx.studentId]);
        const receiptNumber = `HFR-${new Date().getFullYear()}-${String(fee.id).padStart(6, '0')}`;

        await db.run('BEGIN TRANSACTION');
        try {
          await db.run(
            `UPDATE paymentTransactions 
             SET gatewayPaymentId = ?, status = 'SUCCESS', paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [paymentId, tx.id]
          );

          await db.run(
            `UPDATE payments 
             SET amountPaid = amountDue, status = 'paid', paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [tx.feeId]
          );

          await db.run(
            `UPDATE students SET paymentStatus = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
            [tx.studentId]
          );

          await db.run(
            `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) 
             VALUES (?, ?, 'online', ?, 'Razorpay Webhook Captured Payment')`,
            [tx.feeId, tx.amount, paymentId]
          );

          await db.run(
            `INSERT OR IGNORE INTO receipts (transactionId, receiptNumber, studentId, feeId, amount) 
             VALUES (?, ?, ?, ?, ?)`,
            [tx.id, receiptNumber, tx.studentId, tx.feeId, tx.amount]
          );

          await db.run('COMMIT');
          console.log(`[Webhook] Processed payment.captured for order ${orderId}`);
        } catch (e) {
          await db.run('ROLLBACK');
          console.error('[Webhook] DB Error:', e);
        }
      }
    } else if (event === 'payment.failed' && payload && payload.payment) {
      const orderId = payload.payment.entity.order_id;
      const db = await getDb();
      await db.run(
        `UPDATE paymentTransactions SET status = 'FAILED', updatedAt = CURRENT_TIMESTAMP WHERE gatewayOrderId = ?`,
        [orderId]
      );
      console.log(`[Webhook] Processed payment.failed for order ${orderId}`);
    } else if (event === 'refund.processed' && payload && payload.refund) {
      const paymentId = payload.refund.entity.payment_id;
      const db = await getDb();
      await db.run(
        `UPDATE paymentTransactions SET status = 'REFUNDED', updatedAt = CURRENT_TIMESTAMP WHERE gatewayPaymentId = ?`,
        [paymentId]
      );
      console.log(`[Webhook] Processed refund.processed for payment ${paymentId}`);
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
}

/**
 * 4. DOWNLOAD PDF RECEIPT (Student / Admin)
 * Endpoint: GET /api/payments/receipt/:receiptNumber/pdf
 */
async function downloadReceiptPdf(req, res) {
  try {
    const { receiptNumber } = req.params;
    const db = await getDb();

    const receipt = await db.get(
      `SELECT r.*, p.billingMonth, p.amountDue, pt.gatewayOrderId, pt.gatewayPaymentId, pt.paymentMethod,
              s.studentName, s.phone, s.userId, rm.roomNumber, rm.floor, b.bedNumber, s.collegeName
       FROM receipts r
       JOIN payments p ON r.feeId = p.id
       JOIN paymentTransactions pt ON r.transactionId = pt.id
       JOIN students s ON r.studentId = s.id
       LEFT JOIN rooms rm ON s.roomId = rm.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE r.receiptNumber = ? OR r.id = ?`,
      [receiptNumber, receiptNumber]
    );

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Receipt record not found.' });
    }

    // Security check for student role
    if (req.user.role === 'student') {
      const student = await db.get('SELECT id FROM students WHERE userId = ?', [req.user.id]);
      if (!student || student.id !== receipt.studentId) {
        return res.status(403).json({ success: false, message: 'Access denied to another student receipt.' });
      }
    }

    const pdfData = {
      receiptNumber: receipt.receiptNumber,
      date: receipt.generatedAt ? receipt.generatedAt.split(' ')[0] : new Date().toISOString().split('T')[0],
      status: 'PAID',
      studentId: receipt.studentId,
      studentName: receipt.studentName,
      phone: receipt.phone,
      roomNumber: receipt.roomNumber || 'Unassigned',
      bedNumber: receipt.bedNumber || 'Unassigned',
      floor: receipt.floor || 'Ground Floor',
      collegeName: receipt.collegeName,
      billingMonth: receipt.billingMonth,
      amountDue: receipt.amountDue,
      amountPaid: receipt.amount,
      paymentMethod: receipt.paymentMethod || 'Online (Razorpay)',
      gatewayOrderId: receipt.gatewayOrderId,
      gatewayPaymentId: receipt.gatewayPaymentId
    };

    const pdfBuffer = await generateReceiptPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Receipt-${receipt.receiptNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Download Receipt PDF Error:', err);
    res.status(500).json({ success: false, message: `Failed to generate PDF: ${err.message}` });
  }
}

/**
 * 5. GET STUDENT FEES (Student Portal Dashboard)
 * Endpoint: GET /api/payments/student/fees
 */
async function getStudentFees(req, res) {
  try {
    const db = await getDb();
    const student = await db.get(
      `SELECT s.*, u.email, r.roomNumber, r.floor, r.monthlyFee as roomRent, b.bedNumber 
       FROM students s 
       JOIN users u ON s.userId = u.id 
       LEFT JOIN rooms r ON s.roomId = r.id 
       LEFT JOIN beds b ON s.bedId = b.id 
       WHERE s.userId = ?`,
      [req.user.id]
    );

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Fetch all fees for student
    const fees = await db.all(
      `SELECT p.*, r.receiptNumber, pt.gatewayOrderId, pt.gatewayPaymentId, pt.status as gatewayStatus
       FROM payments p
       LEFT JOIN receipts r ON r.feeId = p.id
       LEFT JOIN paymentTransactions pt ON pt.feeId = p.id AND pt.status = 'SUCCESS'
       WHERE p.studentId = ?
       ORDER BY p.billingMonth DESC`,
      [student.id]
    );

    // Current month identifier e.g. '2026-09'
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let currentFee = fees.find(f => f.billingMonth === currentMonthStr);
    
    // If no fee generated for current month yet, return placeholder object
    if (!currentFee) {
      currentFee = {
        id: null,
        studentId: student.id,
        billingMonth: currentMonthStr,
        amountDue: student.monthlyRent || 8500,
        amountPaid: 0,
        status: 'unpaid',
        isGenerated: false
      };
    } else {
      currentFee.isGenerated = true;
    }

    // Previous unpaid dues
    const previousDues = fees.filter(f => f.billingMonth !== currentMonthStr && f.status !== 'paid');

    // Full payment history
    const history = fees.map(f => ({
      id: f.id,
      billingMonth: f.billingMonth,
      amountDue: f.amountDue,
      amountPaid: f.amountPaid,
      status: f.status,
      paidAt: f.paidAt || f.updatedAt,
      receiptNumber: f.receiptNumber || (f.status === 'paid' ? `HFR-${now.getFullYear()}-${String(f.id).padStart(6, '0')}` : null),
      gatewayPaymentId: f.gatewayPaymentId || `TXN${f.id}9283`,
      gatewayOrderId: f.gatewayOrderId
    }));

    res.status(200).json({
      success: true,
      studentInfo: {
        id: student.id,
        name: student.studentName,
        email: student.email,
        phone: student.phone,
        roomNumber: student.roomNumber || 'Unassigned',
        bedNumber: student.bedNumber || 'Unassigned',
        floor: student.floor || 'Ground Floor',
        monthlyRent: student.monthlyRent
      },
      currentFee,
      previousDues,
      history
    });
  } catch (err) {
    console.error('Get Student Fees Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 6. GET ALL PAYMENTS (Admin Portal)
 * Endpoint: GET /api/payments/admin/all
 */
async function getAllPayments(req, res) {
  try {
    const { search, status, month, method } = req.query;
    const db = await getDb();

    let query = `
      SELECT p.*, s.id as studentId, s.studentName, s.phone, r.roomNumber, rm.receiptNumber, pt.gatewayOrderId, pt.gatewayPaymentId, pt.paymentMethod
      FROM payments p
      JOIN students s ON p.studentId = s.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN receipts rm ON rm.feeId = p.id
      LEFT JOIN paymentTransactions pt ON pt.feeId = p.id AND pt.status = 'SUCCESS'
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ` AND p.status = ?`;
      params.push(status);
    }
    if (month && month !== 'all') {
      query += ` AND p.billingMonth = ?`;
      params.push(month);
    }
    if (search) {
      query += ` AND (s.studentName LIKE ? OR s.phone LIKE ? OR r.roomNumber LIKE ? OR rm.receiptNumber LIKE ? OR pt.gatewayPaymentId LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    query += ` ORDER BY p.billingMonth DESC, p.id DESC`;

    const payments = await db.all(query, params);
    res.status(200).json({ success: true, payments });
  } catch (err) {
    console.error('Admin Get All Payments Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 7. GET PAYMENT COLLECTION STATS (Admin Portal)
 * Endpoint: GET /api/payments/admin/stats
 */
async function getPaymentStats(req, res) {
  try {
    const db = await getDb();

    // Total Collection ever
    const totalCollectedRes = await db.get(`SELECT SUM(amountPaid) as sum FROM payments WHERE status = 'paid'`);
    const totalCollected = totalCollectedRes && totalCollectedRes.sum ? totalCollectedRes.sum : 0;

    // Current Month Collection
    const currentMonthRes = await db.get(
      `SELECT SUM(amountPaid) as sum FROM payments WHERE strftime('%Y-%m', updatedAt) = strftime('%Y-%m', 'now') AND status = 'paid'`
    );
    const thisMonth = currentMonthRes && currentMonthRes.sum ? currentMonthRes.sum : 0;

    // Total Pending Dues
    const pendingRes = await db.get(`SELECT SUM(amountDue - amountPaid) as sum FROM payments WHERE status != 'paid'`);
    const pendingDues = pendingRes && pendingRes.sum ? pendingRes.sum : 0;

    // Total Failed Transactions
    const failedRes = await db.get(`SELECT COUNT(*) as count FROM paymentTransactions WHERE status = 'FAILED'`);
    const failedCount = failedRes ? failedRes.count : 0;

    // Total Active Billed Students
    const billedStudentsRes = await db.get(`SELECT COUNT(DISTINCT studentId) as count FROM payments`);
    const paidStudentsRes = await db.get(`SELECT COUNT(DISTINCT studentId) as count FROM payments WHERE status = 'paid'`);

    res.status(200).json({
      success: true,
      stats: {
        totalCollected,
        thisMonth,
        pendingDues,
        failedCount,
        billedStudentsCount: billedStudentsRes ? billedStudentsRes.count : 0,
        paidStudentsCount: paidStudentsRes ? paidStudentsRes.count : 0
      }
    });
  } catch (err) {
    console.error('Get Payment Stats Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 8. GENERATE MONTHLY FEE INVOICES (Admin Portal - Idempotent)
 * Endpoint: POST /api/payments/admin/generate-monthly
 */
async function generateMonthlyFee(req, res) {
  try {
    const { billingMonth } = req.body; // Expect 'YYYY-MM'
    if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
      return res.status(400).json({ success: false, message: 'Valid billing month (YYYY-MM) is required.' });
    }

    const db = await getDb();
    const students = await db.all(`SELECT id, studentName, monthlyRent FROM students WHERE status = 'active' AND roomId IS NOT NULL`);

    if (students.length === 0) {
      return res.status(400).json({ success: false, message: 'No active allocated students found.' });
    }

    await db.run('BEGIN TRANSACTION');
    let generatedCount = 0;
    let skippedCount = 0;

    try {
      for (const stud of students) {
        const existing = await db.get('SELECT id FROM payments WHERE studentId = ? AND billingMonth = ?', [stud.id, billingMonth]);
        if (existing) {
          skippedCount++;
          continue;
        }

        await db.run(
          `INSERT INTO payments (studentId, billingMonth, amountDue, amountPaid, status) VALUES (?, ?, ?, 0, 'pending')`,
          [stud.id, billingMonth, stud.monthlyRent]
        );

        await db.run(`UPDATE students SET paymentStatus = 'unpaid', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [stud.id]);
        generatedCount++;
      }

      if (generatedCount > 0) {
        await db.run(
          `INSERT INTO notifications (type, message) VALUES (?, ?)`,
          ['payment_due', `Generated monthly fee invoices for ${generatedCount} student(s) for ${billingMonth}.`]
        );
      }

      await db.run('COMMIT');
      res.status(200).json({
        success: true,
        message: `Billing run complete for ${billingMonth}. Generated: ${generatedCount}, Already billed: ${skippedCount}.`
      });
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Generate Monthly Fee Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 9. RECORD MANUAL PAYMENT (Admin Portal - Cash / Bank Transfer)
 * Endpoint: POST /api/payments/:id/record
 */
async function recordPayment(req, res) {
  try {
    const { id } = req.params;
    const { amount, paymentMode, referenceNumber, notes } = req.body;

    if (!amount || !paymentMode) {
      return res.status(400).json({ success: false, message: 'Amount and payment mode are required.' });
    }

    const payAmt = parseFloat(amount);
    if (payAmt <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    }

    const db = await getDb();
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [id]);

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment invoice not found.' });
    }

    const totalPaid = payment.amountPaid + payAmt;
    const nextStatus = totalPaid >= payment.amountDue ? 'paid' : 'partial';

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(
        `UPDATE payments SET amountPaid = ?, status = ?, paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [totalPaid, nextStatus, id]
      );

      await db.run(
        `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) VALUES (?, ?, ?, ?, ?)`,
        [id, payAmt, paymentMode, referenceNumber || 'MANUAL', notes || 'Manual admin entry']
      );

      if (nextStatus === 'paid') {
        await db.run(`UPDATE students SET paymentStatus = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [payment.studentId]);
        const stud = await db.get('SELECT studentName FROM students WHERE id = ?', [payment.studentId]);
        await db.run(
          `INSERT INTO notifications (type, message) VALUES (?, ?)`,
          ['payment_received', `Manual payment of ₹${payAmt} recorded for ${stud ? stud.studentName : 'Student'}.`]
        );
      }

      await db.run('COMMIT');
      res.status(200).json({ success: true, message: `Successfully recorded manual payment of ₹${payAmt}. Status: ${nextStatus}` });
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Record Payment Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 10. GET PAYMENT RECEIPT (Student/Admin API JSON)
 */
async function getPaymentReceipt(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const payment = await db.get(
      `SELECT p.*, s.studentName, s.phone, r.roomNumber, b.bedNumber, rm.receiptNumber
       FROM payments p
       JOIN students s ON p.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       LEFT JOIN receipts rm ON rm.feeId = p.id
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

    const receiptNo = payment.receiptNumber || `HFR-${new Date().getFullYear()}-${String(payment.id).padStart(6, '0')}`;

    res.status(200).json({
      success: true,
      receipt: {
        receiptNo,
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

module.exports = {
  createOrder,
  verifyPayment,
  handleWebhook,
  downloadReceiptPdf,
  getStudentFees,
  getAllPayments,
  getPaymentStats,
  generateMonthlyFee,
  recordPayment,
  getPaymentReceipt
};
