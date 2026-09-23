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

    const { keyId, keySecret } = getRazorpayInstance();
    if (!keyId || !keySecret || keyId.includes('sample_key_id') || keyId.startsWith('rzp_test_sample')) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay is not configured on the backend. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the server environment.'
      });
    }

    const db = await getDb();

    const student = (await (async () => { let args = [
      `SELECT s.*, u.email FROM students s JOIN users u ON s.userId = u.id WHERE s.userId = $1`,
      [req.user.id]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const fee = (await (async () => { let args = [
      'SELECT * FROM payments WHERE id = $1 AND studentId = $2',
      [feeId, student.id]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!fee) {
      return res.status(404).json({ success: false, message: 'Hostel fee invoice not found.' });
    }

    const amountDue = fee.amountDue - fee.amountPaid;
    if (amountDue <= 0 || fee.status === 'paid') {
      return res.status(400).json({ success: false, message: 'This hostel fee has already been fully paid.' });
    }

    const amountInPaisa = Math.round(amountDue * 100);
    const { instance } = getRazorpayInstance();

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
    const orderId = order.id;

    (await (async () => {
         let args = [
      `INSERT INTO paymentTransactions (studentId, feeId, gatewayOrderId, amount, currency, status) 
       VALUES ($1, $2, $3, $4, 'INR', 'CREATED')`,
      [student.id, fee.id, orderId, amountDue]
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
         let args = [
      `UPDATE payments SET status = 'pending', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
      [fee.id]
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
      orderId,
      keyId,
      amount: amountInPaisa,
      amountRupees: amountDue,
      currency: 'INR',
      feeId: fee.id,
      billingMonth: fee.billingMonth,
      studentName: student.studentName,
      email: student.email,
      phone: student.phone
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
    const student = (await (async () => { let args = [
      `SELECT s.*, u.email, r.roomNumber, r.floor, b.bedNumber 
       FROM students s 
       JOIN users u ON s.userId = u.id 
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE s.userId = $1`,
      [req.user.id]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student profile not found.' });
    }

    // 2. Fetch transaction record
    const tx = (await (async () => { let args = [
      'SELECT * FROM paymentTransactions WHERE gatewayOrderId = $1 AND feeId = $2',
      [razorpay_order_id, feeId]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Matching payment order transaction not found.' });
    }

    // Prevent duplicate verification
    if (tx.status === 'SUCCESS') {
      const existingReceipt = (await (async () => { let args = ['SELECT receiptNumber FROM receipts WHERE transactionId = $1', [tx.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
      return res.status(200).json({
        success: true,
        message: 'Payment already verified.',
        receiptNumber: existingReceipt ? existingReceipt.receiptNumber : null,
        transactionId: tx.gatewayPaymentId
      });
    }

    const { keySecret } = getRazorpayInstance();
    if (!keySecret || keySecret.includes('sample_secret_key')) {
      return res.status(500).json({ success: false, message: 'Razorpay secret is not configured on the backend.' });
    }

    const hmac = crypto.createHmac('sha256', keySecret);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generatedSignature = hmac.digest('hex');

    if (generatedSignature !== razorpay_signature) {
      (await (async () => {
         let args = [
        `UPDATE paymentTransactions SET status = 'FAILED', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
        [tx.id]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      return res.status(400).json({ success: false, message: 'Invalid payment signature. Verification failed.' });
    }

    // 4. Begin SQL Transaction for verified payment ledger update
    const fee = (await (async () => { let args = ['SELECT * FROM payments WHERE id = $1', [feeId]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const receiptNumber = `HFR-${new Date().getFullYear()}-${String(fee.id).padStart(6, '0')}`;

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
      // Update PaymentTransaction
      (await (async () => {
         let args = [
        `UPDATE paymentTransactions 
         SET gatewayPaymentId = $1, gatewaySignature = $2, status = 'SUCCESS', paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [razorpay_payment_id, razorpay_signature || 'sandbox_sig', tx.id]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // Update Payments Fee Invoice
      (await (async () => {
         let args = [
        `UPDATE payments 
         SET amountPaid = amountDue, status = 'paid', paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [feeId]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // Update Student payment status flag
      (await (async () => {
         let args = [
        `UPDATE students SET paymentStatus = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
        [student.id]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // Record in PaymentHistory table
      (await (async () => {
         let args = [
        `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) 
         VALUES ($1, $2, 'online', $3, 'Verified Online Razorpay Payment')`,
        [feeId, tx.amount, razorpay_payment_id]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // Create Receipt Record
      const receiptInsert = (await (async () => {
         let args = [
        `INSERT INTO receipts (transactionId, receiptNumber, studentId, feeId, amount) 
         VALUES ($1, $2, $3, $4, $5)`,
        [tx.id, receiptNumber, student.id, feeId, tx.amount]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      // Create Notification
      (await (async () => {
         let args = [
        `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
        ['payment_received', `Online fee payment of ₹${tx.amount} received from ${student.studentName} (${fee.billingMonth}).`]
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
      const tx = (await (async () => { let args = ['SELECT * FROM paymentTransactions WHERE gatewayOrderId = $1', [orderId]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

      if (tx && tx.status !== 'SUCCESS') {
        const fee = (await (async () => { let args = ['SELECT * FROM payments WHERE id = $1', [tx.feeId]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
        const student = (await (async () => { let args = ['SELECT * FROM students WHERE id = $1', [tx.studentId]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
        const receiptNumber = `HFR-${new Date().getFullYear()}-${String(fee.id).padStart(6, '0')}`;

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
          (await (async () => {
         let args = [
            `UPDATE paymentTransactions 
             SET gatewayPaymentId = $1, status = 'SUCCESS', paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [paymentId, tx.id]
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
         let args = [
            `UPDATE payments 
             SET amountPaid = amountDue, status = 'paid', paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [tx.feeId]
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
         let args = [
            `UPDATE students SET paymentStatus = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
            [tx.studentId]
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
         let args = [
            `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) 
             VALUES ($1, $2, 'online', $3, 'Razorpay Webhook Captured Payment')`,
            [tx.feeId, tx.amount, paymentId]
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
         let args = [
            `INSERT OR IGNORE INTO receipts (transactionId, receiptNumber, studentId, feeId, amount) 
             VALUES ($1, $2, $3, $4, $5)`,
            [tx.id, receiptNumber, tx.studentId, tx.feeId, tx.amount]
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
          console.log(`[Webhook] Processed payment.captured for order ${orderId}`);
        } catch (e) {
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
          console.error('[Webhook] DB Error:', e);
        }
      }
    } else if (event === 'payment.failed' && payload && payload.payment) {
      const orderId = payload.payment.entity.order_id;
      const db = await getDb();
      (await (async () => {
         let args = [
        `UPDATE paymentTransactions SET status = 'FAILED', updatedAt = CURRENT_TIMESTAMP WHERE gatewayOrderId = $1`,
        [orderId]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
      console.log(`[Webhook] Processed payment.failed for order ${orderId}`);
    } else if (event === 'refund.processed' && payload && payload.refund) {
      const paymentId = payload.refund.entity.payment_id;
      const db = await getDb();
      (await (async () => {
         let args = [
        `UPDATE paymentTransactions SET status = 'REFUNDED', updatedAt = CURRENT_TIMESTAMP WHERE gatewayPaymentId = $1`,
        [paymentId]
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
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

    const receipt = (await (async () => { let args = [
      `SELECT r.*, p.billingMonth, p.amountDue, pt.gatewayOrderId, pt.gatewayPaymentId, pt.paymentMethod,
              s.studentName, s.phone, s.userId, rm.roomNumber, rm.floor, b.bedNumber, s.collegeName
       FROM receipts r
       JOIN payments p ON r.feeId = p.id
       JOIN paymentTransactions pt ON r.transactionId = pt.id
       JOIN students s ON r.studentId = s.id
       LEFT JOIN rooms rm ON s.roomId = rm.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE r.receiptNumber = $1 OR r.id = $2`,
      [receiptNumber, receiptNumber]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Receipt record not found.' });
    }

    // Security check for student role
    if (req.user.role === 'student') {
      const student = (await (async () => { let args = ['SELECT id FROM students WHERE userId = $1', [req.user.id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
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
    const student = (await (async () => { let args = [
      `SELECT s.*, u.email, r.roomNumber, r.floor, r.monthlyFee as roomRent, b.bedNumber 
       FROM students s 
       JOIN users u ON s.userId = u.id 
       LEFT JOIN rooms r ON s.roomId = r.id 
       LEFT JOIN beds b ON s.bedId = b.id 
       WHERE s.userId = $1`,
      [req.user.id]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Fetch all fees for student
    const fees = (await (async () => { let args = [
      `SELECT p.*, r.receiptNumber, pt.gatewayOrderId, pt.gatewayPaymentId, pt.status as gatewayStatus
       FROM payments p
       LEFT JOIN receipts r ON r.feeId = p.id
       LEFT JOIN paymentTransactions pt ON pt.feeId = p.id AND pt.status = 'SUCCESS'
       WHERE p.studentId = $1
       ORDER BY p.billingMonth DESC`,
      [student.id]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());

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

    const payments = (await (async () => { let args = [query, params]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
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
    const totalCollectedRes = (await (async () => { let args = [`SELECT SUM(amountPaid) as sum FROM payments WHERE status = 'paid'`]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const totalCollected = totalCollectedRes && totalCollectedRes.sum ? totalCollectedRes.sum : 0;

    // Current Month Collection
    const currentMonthRes = (await (async () => { let args = [
      `SELECT SUM(amountPaid) as sum FROM payments WHERE strftime('%Y-%m', updatedAt) = strftime('%Y-%m', 'now') AND status = 'paid'`
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const thisMonth = currentMonthRes && currentMonthRes.sum ? currentMonthRes.sum : 0;

    // Total Pending Dues
    const pendingRes = (await (async () => { let args = [`SELECT SUM(amountDue - amountPaid) as sum FROM payments WHERE status != 'paid'`]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const pendingDues = pendingRes && pendingRes.sum ? pendingRes.sum : 0;

    // Total Failed Transactions
    const failedRes = (await (async () => { let args = [`SELECT COUNT(*) as count FROM paymentTransactions WHERE status = 'FAILED'`]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const failedCount = failedRes ? failedRes.count : 0;

    // Total Active Billed Students
    const billedStudentsRes = (await (async () => { let args = [`SELECT COUNT(DISTINCT studentId) as count FROM payments`]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
    const paidStudentsRes = (await (async () => { let args = [`SELECT COUNT(DISTINCT studentId) as count FROM payments WHERE status = 'paid'`]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

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
    const students = (await (async () => { let args = [`SELECT id, studentName, monthlyRent FROM students WHERE status = 'active' AND roomId IS NOT NULL`]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());

    if (students.length === 0) {
      return res.status(400).json({ success: false, message: 'No active allocated students found.' });
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
    let generatedCount = 0;
    let skippedCount = 0;

    try {
      for (const stud of students) {
        const existing = (await (async () => { let args = ['SELECT id FROM payments WHERE studentId = $1 AND billingMonth = $2', [stud.id, billingMonth]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
        if (existing) {
          skippedCount++;
          continue;
        }

        (await (async () => {
         let args = [
          `INSERT INTO payments (studentId, billingMonth, amountDue, amountPaid, status) VALUES ($1, $2, $3, 0, 'pending')`,
          [stud.id, billingMonth, stud.monthlyRent]
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
         let args = [`UPDATE students SET paymentStatus = 'unpaid', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`, [stud.id]];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
        generatedCount++;
      }

      if (generatedCount > 0) {
        (await (async () => {
         let args = [
          `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
          ['payment_due', `Generated monthly fee invoices for ${generatedCount} student(s) for ${billingMonth}.`]
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
      res.status(200).json({
        success: true,
        message: `Billing run complete for ${billingMonth}. Generated: ${generatedCount}, Already billed: ${skippedCount}.`
      });
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
    const payment = (await (async () => { let args = ['SELECT * FROM payments WHERE id = $1', [id]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment invoice not found.' });
    }

    const totalPaid = payment.amountPaid + payAmt;
    const nextStatus = totalPaid >= payment.amountDue ? 'paid' : 'partial';

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
      (await (async () => {
         let args = [
        `UPDATE payments SET amountPaid = $1, status = $2, paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = $3`,
        [totalPaid, nextStatus, id]
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
         let args = [
        `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) VALUES ($1, $2, $3, $4, $5)`,
        [id, payAmt, paymentMode, referenceNumber || 'MANUAL', notes || 'Manual admin entry']
      ];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());

      if (nextStatus === 'paid') {
        (await (async () => {
         let args = [`UPDATE students SET paymentStatus = 'paid', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`, [payment.studentId]];
         let sql = args[0];
         let params = args.slice(1).length ? args.slice(1)[0] : [];
         if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
            sql += ' RETURNING id';
         }
         const { rows, rowCount } = await db.query(sql, params);
         return { lastID: rows.length > 0 ? rows[0].id : null, changes: rowCount };
      })());
        const stud = (await (async () => { let args = ['SELECT studentName FROM students WHERE id = $1', [payment.studentId]]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());
        (await (async () => {
         let args = [
          `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
          ['payment_received', `Manual payment of ₹${payAmt} recorded for ${stud ? stud.studentName : 'Student'}.`]
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
      res.status(200).json({ success: true, message: `Successfully recorded manual payment of ₹${payAmt}. Status: ${nextStatus}` });
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

    const payment = (await (async () => { let args = [
      `SELECT p.*, s.studentName, s.phone, r.roomNumber, b.bedNumber, rm.receiptNumber
       FROM payments p
       JOIN students s ON p.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       LEFT JOIN receipts rm ON rm.feeId = p.id
       WHERE p.id = $1`,
      [id]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows[0]; })());

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment invoice not found.' });
    }

    const history = (await (async () => { let args = [
      'SELECT id, amount, paymentDate, paymentMode, referenceNumber FROM paymentHistory WHERE paymentId = $1 ORDER BY id DESC',
      [id]
    ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());

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
