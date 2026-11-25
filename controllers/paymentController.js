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
async function checkAndApplyOverdueLateFees(db) {
  try {
    // 1. Fetch billing settings
    const { rows: settingsRows } = await db.query(
      `SELECT key, value FROM hostelSettings WHERE key IN ('lateFeeType', 'lateFeeAmount', 'gracePeriodDays')`
    );
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const lateFeeType = settings.lateFeeType || 'FIXED';
    const lateFeeAmount = parseFloat(settings.lateFeeAmount || 200);
    const graceDays = parseInt(settings.gracePeriodDays || 3, 10);

    // 2. Query invoices that are past due date + grace days and not fully paid
    const { rows: overdueInvoices } = await db.query(
      `SELECT id, amountDue, amountPaid, lateFee, lateFeeApplied, dueDate, status 
       FROM payments 
       WHERE status IN ('pending', 'partial')
         AND dueDate IS NOT NULL
         AND CURRENT_DATE > (dueDate::date + ($1 || ' days')::interval)::date`,
      [graceDays]
    );

    for (const inv of overdueInvoices) {
      let lateFee = parseFloat(inv.latefee || inv.lateFee || 0);
      let applied = inv.latefeeapplied !== undefined ? inv.latefeeapplied : inv.lateFeeApplied;

      if (!applied) {
        if (lateFeeType === 'PERCENTAGE') {
          const balance = Math.max(0, parseFloat(inv.amountdue || inv.amountDue) - parseFloat(inv.amountpaid || inv.amountPaid || 0));
          lateFee = Math.round(balance * (lateFeeAmount / 100));
        } else {
          lateFee = lateFeeAmount;
        }
      }

      await db.query(
        `UPDATE payments 
         SET status = 'overdue', lateFee = $1, lateFeeApplied = TRUE, updatedAt = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [lateFee, inv.id]
      );
    }
  } catch (err) {
    console.error('checkAndApplyOverdueLateFees error:', err.message);
  }
}

/**
 * 5. GET STUDENT INVOICES / FEES (Student Portal)
 * Endpoint: GET /api/payments/student/fees
 */
async function getStudentFees(req, res) {
  try {
    const db = await getDb();
    const { rows: studentRows } = await db.query(
      `SELECT s.*, u.email, r.roomNumber, r.floor, r.monthlyFee as roomRent, b.bedNumber 
       FROM students s 
       JOIN users u ON s.userId = u.id 
       LEFT JOIN rooms r ON s.roomId = r.id 
       LEFT JOIN beds b ON s.bedId = b.id 
       WHERE s.userId = $1`,
      [req.user.id]
    );
    const student = studentRows[0];

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Run overdue check to keep statuses live
    await checkAndApplyOverdueLateFees(db);

    // Fetch all fees for student
    const { rows: fees } = await db.query(
      `SELECT p.*, r.receiptNumber, pt.gatewayOrderId, pt.gatewayPaymentId, pt.status as gatewayStatus
       FROM payments p
       LEFT JOIN receipts r ON r.feeId = p.id
       LEFT JOIN paymentTransactions pt ON pt.feeId = p.id AND pt.status = 'SUCCESS'
       WHERE p.studentId = $1
       ORDER BY p.billingMonth DESC, p.id DESC`,
      [student.id]
    );

    const admissionFeeInvoice = fees.find(f => (f.billingMonth || f.billingmonth) === 'ADMISSION');

    // Current month identifier e.g. '2026-11'
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let currentFeeRow = fees.find(f => (f.billingMonth || f.billingmonth) === currentMonthStr);
    let currentFee;

    if (!currentFeeRow) {
      currentFee = {
        id: null,
        invoiceNumber: `INV-${currentMonthStr.replace('-', '')}-${String(student.id).padStart(4, '0')}`,
        studentId: student.id,
        billingMonth: currentMonthStr,
        amountDue: parseFloat(student.monthlyRent || student.monthlyrent || 8500),
        lateFee: 0,
        amountPaid: 0,
        pendingBalance: parseFloat(student.monthlyRent || student.monthlyrent || 8500),
        status: 'unpaid',
        dueDate: new Date(now.getFullYear(), now.getMonth(), 5).toISOString().split('T')[0],
        isGenerated: false
      };
    } else {
      const due = parseFloat(currentFeeRow.amountDue || currentFeeRow.amountdue || 0);
      const late = parseFloat(currentFeeRow.lateFee || currentFeeRow.latefee || 0);
      const paid = parseFloat(currentFeeRow.amountPaid || currentFeeRow.amountpaid || 0);
      currentFee = {
        id: currentFeeRow.id,
        invoiceNumber: currentFeeRow.invoiceNumber || currentFeeRow.invoicenumber || `INV-${currentMonthStr.replace('-', '')}-${String(student.id).padStart(4, '0')}`,
        studentId: student.id,
        billingMonth: currentFeeRow.billingMonth || currentFeeRow.billingmonth,
        amountDue: due,
        lateFee: late,
        amountPaid: paid,
        pendingBalance: Math.max(0, (due + late) - paid),
        advancePaid: parseFloat(currentFeeRow.advancePaid || currentFeeRow.advancepaid || 0),
        status: currentFeeRow.status,
        dueDate: currentFeeRow.dueDate || currentFeeRow.duedate,
        isGenerated: true,
        receiptNumber: currentFeeRow.receiptNumber || currentFeeRow.receiptnumber
      };
    }

    // Previous unpaid / overdue dues
    const previousDues = fees
      .filter(f => (f.billingMonth || f.billingmonth) !== currentMonthStr && f.status !== 'paid')
      .map(f => {
        const due = parseFloat(f.amountDue || f.amountdue || 0);
        const late = parseFloat(f.lateFee || f.latefee || 0);
        const paid = parseFloat(f.amountPaid || f.amountpaid || 0);
        return {
          id: f.id,
          invoiceNumber: f.invoiceNumber || f.invoicenumber,
          billingMonth: f.billingMonth || f.billingmonth,
          amountDue: due,
          lateFee: late,
          amountPaid: paid,
          pendingBalance: Math.max(0, (due + late) - paid),
          status: f.status,
          dueDate: f.dueDate || f.duedate
        };
      });

    // Full payment history
    const history = fees.map(f => {
      const due = parseFloat(f.amountDue || f.amountdue || 0);
      const late = parseFloat(f.lateFee || f.latefee || 0);
      const paid = parseFloat(f.amountPaid || f.amountpaid || 0);
      return {
        id: f.id,
        invoiceNumber: f.invoiceNumber || f.invoicenumber || `INV-${(f.billingMonth || f.billingmonth || 'GEN').replace('-', '')}-${String(f.id).padStart(4, '0')}`,
        billingMonth: f.billingMonth || f.billingmonth,
        amountDue: due,
        lateFee: late,
        amountPaid: paid,
        pendingBalance: Math.max(0, (due + late) - paid),
        status: f.status,
        dueDate: f.dueDate || f.duedate,
        paidAt: f.paidAt || f.paidat || f.updatedAt || f.updatedat,
        receiptNumber: f.receiptNumber || f.receiptnumber || (f.status === 'paid' ? `HFR-${now.getFullYear()}-${String(f.id).padStart(6, '0')}` : null),
        gatewayPaymentId: f.gatewayPaymentId || f.gatewaypaymentid || `TXN${f.id}9283`,
        gatewayOrderId: f.gatewayOrderId || f.gatewayorderid
      };
    });

    res.status(200).json({
      success: true,
      studentInfo: {
        id: student.id,
        name: student.studentName || student.studentname,
        email: student.email,
        phone: student.phone,
        applicationId: student.applicationId || student.applicationid || student.studentCustomId || student.studentcustomid,
        applicationStatus: student.applicationStatus || student.applicationstatus || 'PENDING',
        rejectionReason: student.rejectionReason || student.rejectionreason,
        correctionReason: student.correctionReason || student.correctionreason,
        preferredRoomType: student.preferredRoomType || student.preferredroomtype,
        roomNumber: student.roomNumber || student.roomnumber || 'Unassigned',
        bedNumber: student.bedNumber || student.bednumber || 'Unassigned',
        floor: student.floor || 'Ground Floor',
        monthlyRent: student.monthlyRent || student.monthlyrent
      },
      admissionFeeInvoice,
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
 * 6. GET ALL PAYMENTS (Admin Portal - Complete Ledger & Filter)
 * Endpoint: GET /api/payments/admin/all
 */
async function getAllPayments(req, res) {
  try {
    const { search, status, month } = req.query;
    const db = await getDb();

    // Run live overdue calculation
    await checkAndApplyOverdueLateFees(db);

    let query = `
      SELECT 
        p.id,
        p.invoiceNumber,
        p.studentId,
        p.billingMonth,
        p.billingCycleType,
        p.cycleStartDate,
        p.cycleEndDate,
        p.amountDue,
        p.lateFee,
        p.lateFeeApplied,
        p.amountPaid,
        p.advancePaid,
        p.status,
        p.dueDate,
        p.paidAt,
        p.notes,
        p.createdAt,
        p.updatedAt,
        s.id AS "studentId",
        s.studentName AS "studentName",
        s.phone AS "phone",
        s.studentCustomId AS "studentCustomId",
        s.applicationId AS "applicationId",
        r.roomNumber AS "roomNumber",
        rm.receiptNumber AS "receiptNumber",
        pt.gatewayOrderId AS "gatewayOrderId",
        pt.gatewayPaymentId AS "gatewayPaymentId",
        pt.paymentMethod AS "paymentMethod"
      FROM payments p
      JOIN students s ON p.studentId = s.id
      LEFT JOIN rooms r ON s.roomId = r.id
      LEFT JOIN receipts rm ON rm.feeId = p.id
      LEFT JOIN paymentTransactions pt ON pt.feeId = p.id AND pt.status = 'SUCCESS'
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (status && status !== 'all') {
      if (status === 'overdue') {
        query += ` AND p.status = 'overdue'`;
      } else if (status === 'partial') {
        query += ` AND p.status = 'partial'`;
      } else if (status === 'paid') {
        query += ` AND p.status = 'paid'`;
      } else if (status === 'pending') {
        query += ` AND p.status = 'pending'`;
      } else {
        query += ` AND p.status = $${paramIdx++}`;
        params.push(status);
      }
    }

    if (month && month !== 'all') {
      query += ` AND p.billingMonth = $${paramIdx++}`;
      params.push(month);
    }

    if (search) {
      query += ` AND (
        s.studentName ILIKE $${paramIdx} 
        OR s.phone ILIKE $${paramIdx} 
        OR r.roomNumber ILIKE $${paramIdx} 
        OR rm.receiptNumber ILIKE $${paramIdx} 
        OR p.invoiceNumber ILIKE $${paramIdx}
        OR s.studentCustomId ILIKE $${paramIdx}
      )`;
      paramIdx++;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY p.billingMonth DESC, p.id DESC`;

    const { rows } = await db.query(query, params);

    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalOverdueAmount = 0;
    let totalOverdueCount = 0;

    const payments = rows.map(p => {
      const due = Number(p.amountDue ?? p.amountdue ?? 0);
      const late = Number(p.lateFee ?? p.latefee ?? 0);
      const paid = Number(p.amountPaid ?? p.amountpaid ?? 0);
      const advance = Number(p.advancePaid ?? p.advancepaid ?? 0);
      const pendingBal = Math.max(0, (due + late) - paid);
      const curStatus = p.status || 'pending';

      if (curStatus === 'paid') {
        totalCollected += paid > 0 ? paid : due;
      } else if (curStatus === 'partial') {
        totalCollected += paid;
        totalOutstanding += pendingBal;
      } else if (curStatus === 'overdue') {
        totalOutstanding += pendingBal;
        totalOverdueAmount += pendingBal;
        totalOverdueCount++;
      } else {
        totalOutstanding += pendingBal;
      }

      return {
        id: p.id,
        invoiceNumber: p.invoiceNumber || p.invoicenumber || `INV-${String(p.id).padStart(5, '0')}`,
        studentId: p.studentId || p.studentid,
        studentName: (p.studentName || p.studentname || 'Student').trim(),
        phone: p.phone || '',
        studentCustomId: p.studentCustomId || p.studentcustomid || p.applicationId || p.applicationid || `AKS${String(p.studentId || p.studentid).padStart(6, '0')}`,
        applicationId: p.applicationId || p.applicationid || '',
        roomNumber: p.roomNumber || p.roomnumber || null,
        billingMonth: p.billingMonth || p.billingmonth || '',
        billingCycleType: p.billingCycleType || p.billingcycletype || 'CALENDAR_MONTH',
        cycleStartDate: p.cycleStartDate || p.cyclestartdate || null,
        cycleEndDate: p.cycleEndDate || p.cycleenddate || null,
        amountDue: due,
        lateFee: late,
        lateFeeApplied: !!(p.lateFeeApplied || p.latefeeapplied),
        amountPaid: paid,
        pendingAmount: pendingBal,
        advancePaid: advance,
        status: curStatus,
        dueDate: p.dueDate || p.duedate || null,
        paidAt: p.paidAt || p.paidat || null,
        notes: p.notes || '',
        createdAt: p.createdAt || p.createdat || null,
        updatedAt: p.updatedAt || p.updatedat || null,
        receiptNumber: p.receiptNumber || p.receiptnumber || null,
        gatewayOrderId: p.gatewayOrderId || p.gatewayorderid || null,
        gatewayPaymentId: p.gatewayPaymentId || p.gatewaypaymentid || null,
        paymentMethod: p.paymentMethod || p.paymentmethod || null
      };
    });

    const totalBilled = totalCollected + totalOutstanding;
    const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

    res.status(200).json({
      success: true,
      payments,
      stats: {
        totalCollected,
        totalOutstanding,
        totalOverdueCount,
        totalOverdueAmount,
        collectionRate
      }
    });
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
    await checkAndApplyOverdueLateFees(db);

    // Total Collection ever
    const totalCollectedRes = await db.query(`SELECT SUM(amountPaid) as sum FROM payments WHERE status = 'paid'`);
    const totalCollected = Number(totalCollectedRes.rows[0]?.sum || 0);

    // Current Month Collection
    const currentMonthRes = await db.query(
      `SELECT SUM(amountPaid) as sum FROM payments 
       WHERE to_char(updatedAt, 'YYYY-MM') = to_char(CURRENT_TIMESTAMP, 'YYYY-MM') AND status = 'paid'`
    );
    const thisMonth = Number(currentMonthRes.rows[0]?.sum || 0);

    // Total Pending Dues (including late fees)
    const pendingRes = await db.query(
      `SELECT SUM((amountDue + lateFee) - amountPaid) as sum FROM payments WHERE status != 'paid'`
    );
    const pendingDues = Number(pendingRes.rows[0]?.sum || 0);

    // Overdue summary
    const overdueRes = await db.query(
      `SELECT COUNT(*) as count, SUM((amountDue + lateFee) - amountPaid) as sum FROM payments WHERE status = 'overdue'`
    );
    const overdueCount = Number(overdueRes.rows[0]?.count || 0);
    const overdueAmount = Number(overdueRes.rows[0]?.sum || 0);

    // Billed Students
    const billedStudentsRes = await db.query(`SELECT COUNT(DISTINCT studentId) as count FROM payments`);
    const paidStudentsRes = await db.query(`SELECT COUNT(DISTINCT studentId) as count FROM payments WHERE status = 'paid'`);

    res.status(200).json({
      success: true,
      stats: {
        totalCollected,
        thisMonth,
        pendingDues,
        overdueCount,
        overdueAmount,
        billedStudentsCount: Number(billedStudentsRes.rows[0]?.count || 0),
        paidStudentsCount: Number(paidStudentsRes.rows[0]?.count || 0)
      }
    });
  } catch (err) {
    console.error('Get Payment Stats Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 8. GENERATE MONTHLY FEE INVOICES (Admin Portal - Automatic & Idempotent)
 * Endpoint: POST /api/payments/admin/generate-monthly
 */
async function generateMonthlyFee(req, res) {
  try {
    const db = await getDb();
    let { billingMonth } = req.body; // Optional 'YYYY-MM'

    const now = new Date();
    if (!billingMonth) {
      billingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
      return res.status(400).json({ success: false, message: 'Valid billing month (YYYY-MM) is required.' });
    }

    // 1. Fetch billing settings
    const { rows: settingsRows } = await db.query(
      `SELECT key, value FROM hostelSettings WHERE key IN ('billingCycleType', 'rentDueDay')`
    );
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const cycleType = settings.billingCycleType || 'CALENDAR_MONTH';
    const dueDayNum = Math.min(Math.max(parseInt(settings.rentDueDay || 5, 10), 1), 28);

    // 2. Query all active allocated students
    const { rows: students } = await db.query(
      `SELECT id, studentName, monthlyRent, joinDate, checkInDate 
       FROM students 
       WHERE status = 'active' AND roomId IS NOT NULL`
    );

    if (students.length === 0) {
      return res.status(400).json({ success: false, message: 'No active allocated students found to bill.' });
    }

    const [yearStr, monthStr] = billingMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10); // 1-12

    let generatedCount = 0;
    let skippedCount = 0;
    const generatedInvoices = [];

    await db.query('BEGIN');

    try {
      for (const stud of students) {
        // Prevent duplicate invoice generation for the same student and month
        const { rows: existingRows } = await db.query(
          `SELECT id, invoiceNumber FROM payments WHERE studentId = $1 AND billingMonth = $2`,
          [stud.id, billingMonth]
        );

        if (existingRows.length > 0) {
          skippedCount++;
          continue;
        }

        // Determine cycle dates and due date
        let cycleStart, cycleEnd, dueDate;

        if (cycleType === 'JOINING_DATE') {
          const refDate = stud.checkInDate ? new Date(stud.checkInDate) : (stud.joinDate ? new Date(stud.joinDate) : new Date(year, month - 1, 1));
          const dayOfJoin = Math.min(refDate.getDate(), 28);
          cycleStart = new Date(year, month - 1, dayOfJoin);
          cycleEnd = new Date(year, month, dayOfJoin - 1);
          dueDate = new Date(cycleStart.getTime() + (dueDayNum * 24 * 60 * 60 * 1000));
        } else {
          // Calendar month
          cycleStart = new Date(year, month - 1, 1);
          cycleEnd = new Date(year, month, 0); // last day of month
          dueDate = new Date(year, month - 1, dueDayNum);
        }

        const cleanMonth = billingMonth.replace('-', '');
        const randomSalt = Math.floor(1000 + Math.random() * 9000);
        const invoiceNumber = `INV-${cleanMonth}-${String(stud.id).padStart(4, '0')}-${randomSalt}`;
        const rentAmount = parseFloat(stud.monthlyRent || stud.monthlyrent || 8500);

        const { rows: inserted } = await db.query(
          `INSERT INTO payments (
            studentId, billingMonth, amountDue, amountPaid, lateFee, lateFeeApplied,
            status, dueDate, billingCycleType, cycleStartDate, cycleEndDate, invoiceNumber
          ) VALUES ($1, $2, $3, 0, 0, FALSE, 'pending', $4, $5, $6, $7, $8)
          RETURNING id, invoiceNumber, amountDue`,
          [
            stud.id,
            billingMonth,
            rentAmount,
            dueDate.toISOString().split('T')[0],
            cycleType,
            cycleStart.toISOString().split('T')[0],
            cycleEnd.toISOString().split('T')[0],
            invoiceNumber
          ]
        );

        await db.query(
          `UPDATE students SET paymentStatus = 'unpaid', updatedAt = CURRENT_TIMESTAMP WHERE id = $1`,
          [stud.id]
        );

        generatedCount++;
        generatedInvoices.push(inserted[0]);
      }

      if (generatedCount > 0) {
        await db.query(
          `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
          ['payment_due', `Generated monthly rent invoices for ${generatedCount} student(s) for ${billingMonth}.`]
        );
      }

      await db.query('COMMIT');

      res.status(200).json({
        success: true,
        message: `Billing run complete for ${billingMonth}. ${generatedCount} invoice(s) generated, ${skippedCount} skipped (already billed).`,
        generatedCount,
        skippedCount,
        billingMonth,
        cycleType
      });
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Generate Monthly Fee Error:', err);
    res.status(500).json({ success: false, message: `Failed to generate monthly fee: ${err.message}` });
  }
}

/**
 * 9. RECORD PAYMENT (Partial, Full, and Advance Payments)
 * Endpoint: POST /api/payments/:id/record
 */
async function recordPayment(req, res) {
  try {
    const { id } = req.params;
    const { amount, paymentMode, referenceNumber, notes, waiveLateFee } = req.body;

    if (!amount || !paymentMode) {
      return res.status(400).json({ success: false, message: 'Amount and payment mode are required.' });
    }

    const payAmt = parseFloat(amount);
    if (isNaN(payAmt) || payAmt <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero.' });
    }

    const db = await getDb();
    const { rows: paymentRows } = await db.query(
      `SELECT p.*, s.studentName, s.phone, r.roomNumber, b.bedNumber 
       FROM payments p
       JOIN students s ON p.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE p.id = $1`,
      [id]
    );
    const payment = paymentRows[0];

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment invoice record not found.' });
    }

    const targetStudentId = payment.studentId || payment.studentid;

    let lateFee = parseFloat(payment.lateFee || payment.latefee || 0);
    if (waiveLateFee === true || waiveLateFee === 'true') {
      lateFee = 0;
    }

    const amountDue = parseFloat(payment.amountDue || payment.amountdue || 0);
    const currentPaid = parseFloat(payment.amountPaid || payment.amountpaid || 0);
    const totalEffectiveDue = amountDue + lateFee;
    const newTotalPaid = currentPaid + payAmt;

    let nextStatus = 'pending';
    let advanceAmount = 0;

    if (newTotalPaid >= totalEffectiveDue) {
      nextStatus = 'paid';
      advanceAmount = Math.max(0, newTotalPaid - totalEffectiveDue);
    } else if (newTotalPaid > 0) {
      nextStatus = 'partial';
    }

    const receiptNumber = `HFR-${new Date().getFullYear()}-${String(payment.id).padStart(6, '0')}`;
    const recordedBy = (req.user && req.user.name) ? req.user.name : 'Hostel Management';

    await db.query('BEGIN');

    try {
      // 1. Update Payment invoice
      await db.query(
        `UPDATE payments 
         SET amountPaid = $1, lateFee = $2, status = $3, 
             advancePaid = advancePaid + $4, paidAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [newTotalPaid, lateFee, nextStatus, advanceAmount, id]
      );

      // 2. Insert into paymentHistory ledger
      const modeToSave = (paymentMode || 'online').toLowerCase();
      await db.query(
        `INSERT INTO paymentHistory (paymentId, amount, paymentDate, paymentMode, referenceNumber, notes)
         VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5)`,
        [id, payAmt, modeToSave, referenceNumber || 'MANUAL', notes || `Recorded by ${recordedBy}`]
      );

      // 3. Upsert Receipt record
      await db.query(
        `INSERT INTO receipts (receiptNumber, studentId, feeId, amount, generatedAt)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (receiptNumber) DO NOTHING`,
        [receiptNumber, targetStudentId, id, payAmt]
      );

      // 4. Update student overall payment status
      if (nextStatus === 'paid') {
        // Check if student has any other pending/overdue invoices
        const { rows: otherUnpaid } = await db.query(
          `SELECT id FROM payments WHERE studentId = $1 AND id != $2 AND status != 'paid'`,
          [targetStudentId, id]
        );
        const overallStatus = otherUnpaid.length === 0 ? 'paid' : 'unpaid';
        await db.query(
          `UPDATE students SET paymentStatus = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2`,
          [overallStatus, targetStudentId]
        );
      }

      await db.query(
        `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
        [
          'payment_received',
          `Payment of ₹${payAmt.toLocaleString('en-IN')} recorded for ${payment.studentName} (${payment.billingMonth}). Status: ${nextStatus.toUpperCase()}.`
        ]
      );

      await db.query('COMMIT');

      res.status(200).json({
        success: true,
        message: `Successfully recorded payment of ₹${payAmt.toLocaleString('en-IN')}. Status: ${nextStatus.toUpperCase()}`,
        receiptNumber,
        status: nextStatus,
        amountPaid: payAmt,
        totalPaid: newTotalPaid,
        remainingBalance: Math.max(0, totalEffectiveDue - newTotalPaid),
        advanceAmount
      });
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    console.error('Record Payment Error:', err);
    res.status(500).json({ success: false, message: `Failed to record payment: ${err.message}` });
  }
}

/**
 * 10. GET PAYMENT RECEIPT DETAILS (Student/Admin API JSON)
 * Endpoint: GET /api/payments/:id/receipt
 */
async function getPaymentReceipt(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows: paymentRows } = await db.query(
      `SELECT p.*, s.studentName, s.phone, s.studentCustomId, r.roomNumber, b.bedNumber, rm.receiptNumber
       FROM payments p
       JOIN students s ON p.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       LEFT JOIN receipts rm ON rm.feeId = p.id
       WHERE p.id = $1`,
      [id]
    );
    const payment = paymentRows[0];

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment invoice not found.' });
    }

    const { rows: history } = await db.query(
      `SELECT id, amount, paymentDate, paymentMode, referenceNumber, notes 
       FROM paymentHistory 
       WHERE paymentId = $1 
       ORDER BY id DESC`,
      [id]
    );

    const receiptNo = payment.receiptNumber || payment.receiptnumber || `HFR-${new Date().getFullYear()}-${String(payment.id).padStart(6, '0')}`;

    res.status(200).json({
      success: true,
      receipt: {
        receiptNo,
        invoiceNumber: payment.invoiceNumber || payment.invoicenumber,
        date: payment.updatedAt ? new Date(payment.updatedAt).toLocaleDateString('en-IN') : 'N/A',
        studentName: payment.studentName,
        phone: payment.phone,
        studentCustomId: payment.studentCustomId,
        roomNumber: payment.roomNumber || 'Unassigned',
        bedNumber: payment.bedNumber || 'Unassigned',
        billingMonth: payment.billingMonth,
        amountDue: parseFloat(payment.amountDue || 0),
        lateFee: parseFloat(payment.lateFee || 0),
        amountPaid: parseFloat(payment.amountPaid || 0),
        advancePaid: parseFloat(payment.advancePaid || 0),
        status: payment.status,
        dueDate: payment.dueDate ? new Date(payment.dueDate).toLocaleDateString('en-IN') : null,
        transactions: history
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 11. GET BILLING & RENT CONFIGURATION SETTINGS
 * Endpoint: GET /api/payments/admin/settings
 */
async function getBillingSettings(req, res) {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT key, value FROM hostelSettings 
       WHERE key IN ('billingCycleType', 'rentDueDay', 'lateFeeType', 'lateFeeAmount', 'gracePeriodDays', 'autoReminderEnabled', 'autoReminderDaysBeforeDue')`
    );

    const settings = {
      billingCycleType: 'CALENDAR_MONTH',
      rentDueDay: '5',
      lateFeeType: 'FIXED',
      lateFeeAmount: '200',
      gracePeriodDays: '3',
      autoReminderEnabled: 'true',
      autoReminderDaysBeforeDue: '2'
    };

    rows.forEach(r => { settings[r.key] = r.value; });

    res.status(200).json({ success: true, settings });
  } catch (err) {
    console.error('Get Billing Settings Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 12. UPDATE BILLING & RENT CONFIGURATION SETTINGS
 * Endpoint: PUT /api/payments/admin/settings
 */
async function updateBillingSettings(req, res) {
  try {
    const db = await getDb();
    const {
      billingCycleType,
      rentDueDay,
      lateFeeType,
      lateFeeAmount,
      gracePeriodDays,
      autoReminderEnabled,
      autoReminderDaysBeforeDue
    } = req.body;

    const updates = [
      { key: 'billingCycleType', value: billingCycleType || 'CALENDAR_MONTH' },
      { key: 'rentDueDay', value: String(rentDueDay || '5') },
      { key: 'lateFeeType', value: lateFeeType || 'FIXED' },
      { key: 'lateFeeAmount', value: String(lateFeeAmount || '200') },
      { key: 'gracePeriodDays', value: String(gracePeriodDays || '3') },
      { key: 'autoReminderEnabled', value: String(autoReminderEnabled ?? 'true') },
      { key: 'autoReminderDaysBeforeDue', value: String(autoReminderDaysBeforeDue || '2') }
    ];

    await db.query('BEGIN');
    for (const u of updates) {
      await db.query(
        `INSERT INTO hostelSettings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [u.key, u.value]
      );
    }
    await db.query('COMMIT');

    res.status(200).json({ success: true, message: 'Hostel rent billing settings updated successfully.' });
  } catch (err) {
    console.error('Update Billing Settings Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 13. GET STUDENT-WISE RENT HISTORY (Admin Portal)
 * Endpoint: GET /api/payments/admin/student/:studentId
 */
async function getStudentRentHistory(req, res) {
  try {
    const { studentId } = req.params;
    const db = await getDb();

    // Verify student
    const { rows: studentRows } = await db.query(
      `SELECT s.*, r.roomNumber, b.bedLabel, b.bedNumber 
       FROM students s
       LEFT JOIN rooms r ON s.roomId = r.id
       LEFT JOIN beds b ON s.bedId = b.id
       WHERE s.id = $1`,
      [studentId]
    );
    const student = studentRows[0];
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    // Run live overdue check
    await checkAndApplyOverdueLateFees(db);

    // Fetch all student invoices
    const { rows: invoices } = await db.query(
      `SELECT p.*, r.receiptNumber 
       FROM payments p
       LEFT JOIN receipts r ON r.feeId = p.id
       WHERE p.studentId = $1
       ORDER BY p.billingMonth DESC, p.id DESC`,
      [studentId]
    );

    // Fetch all payment transactions
    const { rows: transactions } = await db.query(
      `SELECT ph.*, p.billingMonth, p.invoiceNumber 
       FROM paymentHistory ph
       JOIN payments p ON ph.paymentId = p.id
       WHERE p.studentId = $1
       ORDER BY ph.paymentDate DESC, ph.id DESC`,
      [studentId]
    );

    let totalBilled = 0;
    let totalPaid = 0;
    let totalPending = 0;

    invoices.forEach(inv => {
      const due = parseFloat(inv.amountDue || inv.amountdue || 0);
      const late = parseFloat(inv.lateFee || inv.latefee || 0);
      const paid = parseFloat(inv.amountPaid || inv.amountpaid || 0);
      totalBilled += (due + late);
      totalPaid += paid;
      totalPending += Math.max(0, (due + late) - paid);
    });

    res.status(200).json({
      success: true,
      student: {
        id: student.id,
        name: student.studentName,
        phone: student.phone,
        customId: student.studentCustomId || `AKS${String(student.id).padStart(6, '0')}`,
        roomNumber: student.roomNumber || 'Unassigned',
        bedLabel: student.bedLabel || (student.bedNumber ? `Bed ${student.bedNumber}` : 'Unassigned'),
        monthlyRent: student.monthlyRent
      },
      summary: {
        totalBilled,
        totalPaid,
        totalPending,
        invoiceCount: invoices.length
      },
      invoices,
      transactions
    });
  } catch (err) {
    console.error('Get Student Rent History Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * 14. AUTOMATED PAYMENT REMINDERS (Admin 1-Click Reminder for Due/Overdue)
 * Endpoint: POST /api/payments/admin/send-reminders
 */
async function sendDueReminders(req, res) {
  try {
    const db = await getDb();
    await checkAndApplyOverdueLateFees(db);

    // Query all students with pending or overdue invoices
    const { rows: unpaidList } = await db.query(
      `SELECT p.id as paymentId, p.invoiceNumber, p.billingMonth, p.amountDue, p.lateFee, p.amountPaid, p.dueDate, p.status,
              s.id as studentId, s.studentName, s.phone, s.parentPhone, r.roomNumber
       FROM payments p
       JOIN students s ON p.studentId = s.id
       LEFT JOIN rooms r ON s.roomId = r.id
       WHERE p.status IN ('pending', 'partial', 'overdue')
         AND s.status = 'active'
       ORDER BY p.dueDate ASC`
    );

    if (unpaidList.length === 0) {
      return res.status(200).json({ success: true, message: 'All student accounts are cleared! No pending or overdue dues found.' });
    }

    await db.query('BEGIN');
    let sentCount = 0;

    for (const item of unpaidList) {
      const sId = item.studentId || item.studentid;
      const sName = item.studentName || item.studentname || 'Student';
      const bMonth = item.billingMonth || item.billingmonth || '';
      const curStatus = (item.status || 'pending').toUpperCase();
      const balance = Math.max(0, (parseFloat(item.amountDue || item.amountdue || 0) + parseFloat(item.lateFee || item.latefee || 0)) - parseFloat(item.amountPaid || item.amountpaid || 0));
      const dueStr = (item.dueDate || item.duedate) ? new Date(item.dueDate || item.duedate).toLocaleDateString('en-IN') : 'immediate';
      const msg = `Dear ${sName}, your hostel rent of ₹${balance.toLocaleString('en-IN')} for ${bMonth} is ${curStatus} (${dueStr}). Please complete your payment to avoid late fees. - Akshaya Deluxe Boys Hostel`;

      await db.query(
        `INSERT INTO reminders (studentId, title, message, channel, status) VALUES ($1, $2, $3, 'whatsapp', 'sent')`,
        [sId, `Rent ${curStatus}: ${bMonth}`, msg]
      );
      sentCount++;
    }

    await db.query(
      `INSERT INTO notifications (type, message) VALUES ($1, $2)`,
      ['reminder_sent', `Dispatched rent payment reminders to ${sentCount} student accounts.`]
    );

    await db.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Dispatched payment reminders to ${sentCount} student account(s).`,
      count: sentCount
    });
  } catch (err) {
    try {
      const db = await getDb();
      await db.query('ROLLBACK');
    } catch (_) {}
    console.error('Send Due Reminders Error:', err);
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
  getPaymentReceipt,
  getBillingSettings,
  updateBillingSettings,
  getStudentRentHistory,
  sendDueReminders
};
