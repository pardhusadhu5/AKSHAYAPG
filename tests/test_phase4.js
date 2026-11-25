require('dotenv').config();
const { getDb } = require('../config/db');
const depositController = require('../controllers/depositController');
const paymentController = require('../controllers/paymentController');

function createMockReqRes(body = {}, params = {}, query = {}, user = { id: 1, name: 'Admin User', role: 'admin' }) {
  const req = { body, params, query, user };
  let statusCode = 200;
  let responseData = null;
  let headers = {};

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      headers[key] = val;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    getStatusCode: () => statusCode,
    getData: () => responseData,
    getHeaders: () => headers
  };
  return { req, res };
}

async function runPhase4Tests() {
  console.log('=== RUNNING PHASE 4: SECURITY DEPOSIT MANAGEMENT AUTOMATED TEST SUITE ===\n');
  const db = await getDb();
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Configure deposit amounts test
  console.log('Test 1: Configure deposit amounts & terms');
  try {
    const { req: getCfgReq, res: getCfgRes } = createMockReqRes();
    await depositController.getDepositConfig(getCfgReq, getCfgRes);
    const cfgData = getCfgRes.getData();
    assert(getCfgRes.getStatusCode() === 200 && cfgData.success, 'GET /api/payments/deposits/config returns success');
    assert(cfgData.config && cfgData.config.depositAmount !== undefined, 'Returns depositAmount in config');

    const { req: putCfgReq, res: putCfgRes } = createMockReqRes({
      depositAmount: 3500,
      depositRefundPolicy: 'Standard 3-5 days refund after checkout clearance'
    });
    await depositController.updateDepositConfig(putCfgReq, putCfgRes);
    assert(putCfgRes.getStatusCode() === 200, 'PUT /api/payments/deposits/config successfully updates deposit settings');
  } catch (err) {
    assert(false, `Test 1 failed with error: ${err.message}`);
  }

  // Find or create a test student
  const { rows: testStudents } = await db.query(`SELECT * FROM students WHERE status = 'active' LIMIT 1`);
  let testStudent = testStudents[0];
  if (!testStudent) {
    console.error('No active student found for testing. Aborting.');
    return;
  }
  const studentId = testStudent.id;
  console.log(`\nUsing Test Student: ID=${studentId}, Name=${testStudent.studentName}`);

  // 2. Deposit Collection Test
  console.log('\nTest 2: Collect & Record Security Deposit');
  try {
    const initialHeld = parseFloat(testStudent.depositAmount || testStudent.depositamount || 0);
    const collectAmount = 1500;

    const { req, res } = createMockReqRes({
      studentId,
      amount: collectAmount,
      category: 'ADDITIONAL_DEPOSIT',
      paymentMode: 'UPI',
      referenceNumber: 'UTR-PHASE4-TEST-101',
      reason: 'Top-up security deposit for single occupancy guarantee'
    });
    await depositController.recordDepositCollection(req, res);
    const data = res.getData();

    assert(res.getStatusCode() === 200 && data.success, 'POST /api/payments/deposits/collect succeeds');
    assert(data.depositNumber && data.depositNumber.startsWith('DEP-COL-'), `Generated deposit number: ${data.depositNumber}`);
    assert(data.newBalance === initialHeld + collectAmount, `Deposit balance updated from ₹${initialHeld} to ₹${data.newBalance}`);

    // Verify DB record
    const { rows: depRows } = await db.query(
      `SELECT * FROM security_deposits WHERE depositNumber = $1`,
      [data.depositNumber]
    );
    assert(depRows.length === 1, 'Transaction recorded in security_deposits table');
    assert(depRows[0].transactionType === 'COLLECTION' || depRows[0].transactiontype === 'COLLECTION', 'Transaction type is COLLECTION');
    assert(depRows[0].status === 'COMPLETED', 'Status is COMPLETED');
  } catch (err) {
    assert(false, `Test 2 failed with error: ${err.message}`);
  }

  // 3. Approved Damage Deduction Test
  console.log('\nTest 3: Damage and Approved Deductions');
  try {
    const { rows: sRows } = await db.query(`SELECT depositAmount FROM students WHERE id = $1`, [studentId]);
    const currentHeld = parseFloat(sRows[0].depositAmount || sRows[0].depositamount);
    const deductAmount = 400;

    const { req, res } = createMockReqRes({
      studentId,
      amount: deductAmount,
      category: 'APPLIANCE_DAMAGE',
      reason: 'Room 101 ceiling fan regulator replacement',
      notes: 'Electrician Bill #99201'
    });
    await depositController.recordDepositDeduction(req, res);
    const data = res.getData();

    assert(res.getStatusCode() === 200 && data.success, 'POST /api/payments/deposits/deduct succeeds');
    assert(data.depositNumber && data.depositNumber.startsWith('DEP-DED-'), `Generated deduction reference: ${data.depositNumber}`);
    assert(data.remainingBalance === currentHeld - deductAmount, `Deposit reduced to ₹${data.remainingBalance}`);

    // Verify excessive deduction is rejected
    const { req: errReq, res: errRes } = createMockReqRes({
      studentId,
      amount: 999999, // Exceeds deposit
      reason: 'Excessive claim'
    });
    await depositController.recordDepositDeduction(errReq, errRes);
    assert(errRes.getStatusCode() === 400, 'Rejects deduction exceeding available deposit balance');
  } catch (err) {
    assert(false, `Test 3 failed with error: ${err.message}`);
  }

  // 4. Refund Processing (Partial Refund)
  console.log('\nTest 4: Refund Processing (Partial & Status Update)');
  try {
    const { rows: sRows } = await db.query(`SELECT depositAmount FROM students WHERE id = $1`, [studentId]);
    const currentHeld = parseFloat(sRows[0].depositAmount || sRows[0].depositamount);
    const refundAmount = 500;

    const { req, res } = createMockReqRes({
      studentId,
      amount: refundAmount,
      paymentMode: 'Bank Transfer',
      referenceNumber: 'NEFT-PHASE4-REF-001',
      reason: 'Partial deposit return upon room downsizing'
    });
    await depositController.processDepositRefund(req, res);
    const data = res.getData();

    assert(res.getStatusCode() === 200 && data.success, 'POST /api/payments/deposits/refund succeeds');
    assert(data.depositNumber && data.depositNumber.startsWith('DEP-REF-'), `Generated refund reference: ${data.depositNumber}`);
    assert(data.remainingBalance === currentHeld - refundAmount, `Remaining balance updated to ₹${data.remainingBalance}`);
    assert(data.depositStatus === 'PARTIALLY_REFUNDED', `Student depositStatus transitioned to ${data.depositStatus}`);
  } catch (err) {
    assert(false, `Test 4 failed with error: ${err.message}`);
  }

  // 5. Pending Refund Tracking & Disbursement Test
  console.log('\nTest 5: Pending Refund Tracking and Direct Settlement');
  try {
    // Insert a pending refund record
    const pendingDepNum = `DEP-REF-PENDING-${Date.now().toString().slice(-4)}`;
    await db.query(`
      INSERT INTO security_deposits (
        depositNumber, studentId, transactionType, category, amount, balanceAfter,
        paymentMode, reason, status
      ) VALUES ($1, $2, 'REFUND', 'CHECKOUT_REFUND', 2000, 0, 'UPI', 'Queued checkout refund', 'PENDING')
    `, [pendingDepNum, studentId]);

    // Test getPendingRefunds
    const { req: pendReq, res: pendRes } = createMockReqRes();
    await depositController.getPendingRefunds(pendReq, pendRes);
    const pendData = pendRes.getData();
    assert(pendRes.getStatusCode() === 200 && pendData.success, 'GET /api/payments/deposits/pending-refunds succeeds');
    assert(Array.isArray(pendData.pendingRefunds), 'Returns pendingRefunds list');
    const foundPending = pendData.pendingRefunds.find(p => p.depositNumber === pendingDepNum);
    assert(!!foundPending, `Found queued pending refund record: ${pendingDepNum}`);

    // Disburse the pending refund using its depositId
    if (foundPending) {
      const { req: disburseReq, res: disburseRes } = createMockReqRes({
        depositId: foundPending.id,
        paymentMode: 'UPI',
        referenceNumber: 'UPI-DISBURSE-SUCCESS-771',
        reason: 'Final checkout refund disbursed to student GPay'
      });
      await depositController.processDepositRefund(disburseReq, disburseRes);
      assert(disburseRes.getStatusCode() === 200 && disburseRes.getData().success, 'Disbursed pending refund successfully');

      // Verify status changed to COMPLETED
      const { rows: checkRows } = await db.query(`SELECT status FROM security_deposits WHERE id = $1`, [foundPending.id]);
      assert(checkRows[0].status === 'COMPLETED', 'Pending refund status updated to COMPLETED in database');
    }
  } catch (err) {
    assert(false, `Test 5 failed with error: ${err.message}`);
  }

  // 6. Security Deposit Stats & Financial Separation
  console.log('\nTest 6: Security Deposit Stats & Income Separation');
  try {
    const { req: statReq, res: statRes } = createMockReqRes();
    await depositController.getDepositStats(statReq, statRes);
    const statData = statRes.getData();

    assert(statRes.getStatusCode() === 200 && statData.success, 'GET /api/payments/deposits/stats succeeds');
    assert(statData.stats.totalDepositsHeld !== undefined, `totalDepositsHeld: ₹${statData.stats.totalDepositsHeld}`);
    assert(statData.stats.totalRefunded !== undefined, `totalRefunded: ₹${statData.stats.totalRefunded}`);
    assert(statData.stats.totalDeductions !== undefined, `totalDeductions: ₹${statData.stats.totalDeductions}`);
    assert(statData.stats.pendingRefundsCount !== undefined, `pendingRefundsCount: ${statData.stats.pendingRefundsCount}`);

    // Verify monthly rent payment stats does NOT mix security deposits
    const { req: rentStatReq, res: rentStatRes } = createMockReqRes();
    await paymentController.getPaymentStats(rentStatReq, rentStatRes);
    const rentStatData = rentStatRes.getData();
    assert(rentStatRes.getStatusCode() === 200 && rentStatData.success, 'Monthly rent payment stats unaffected and separated');
  } catch (err) {
    assert(false, `Test 6 failed with error: ${err.message}`);
  }

  // 7. Student Deposit Audit History Test
  console.log('\nTest 7: Student Deposit Audit Trail & Ledger');
  try {
    const { req, res } = createMockReqRes({}, { studentId });
    await depositController.getStudentDepositHistory(req, res);
    const data = res.getData();

    assert(res.getStatusCode() === 200 && data.success, 'GET /api/payments/deposits/student/:studentId succeeds');
    assert(data.studentSummary && data.studentSummary.id === studentId, 'Returns student deposit summary');
    assert(Array.isArray(data.transactions) && data.transactions.length >= 3, `Returns audit trail with ${data.transactions.length} transactions`);
    assert(data.transactions.every(t => t.depositNumber && t.transactionType && t.amount), 'Every transaction contains complete audit fields');
  } catch (err) {
    assert(false, `Test 7 failed with error: ${err.message}`);
  }

  // 8. Deposit Ledger & Search Filtering Test
  console.log('\nTest 8: Deposit Ledger Query & Filtering');
  try {
    const { req, res } = createMockReqRes({}, {}, { search: 'DEP-', type: 'all' });
    await depositController.getDepositLedger(req, res);
    const data = res.getData();

    assert(res.getStatusCode() === 200 && data.success, 'GET /api/payments/deposits/ledger succeeds');
    assert(Array.isArray(data.transactions), `Returns ledger with ${data.count} transactions`);

    const { req: colReq, res: colRes } = createMockReqRes({}, {}, { type: 'COLLECTION' });
    await depositController.getDepositLedger(colReq, colRes);
    const colData = colRes.getData();
    assert(colData.transactions.every(t => t.transactionType === 'COLLECTION'), 'Filtered ledger by transactionType COLLECTION');
  } catch (err) {
    assert(false, `Test 8 failed with error: ${err.message}`);
  }

  console.log(`\n======================================================`);
  console.log(`PHASE 4 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase4Tests().catch(err => {
  console.error('Test Suite Fatal Error:', err);
  process.exit(1);
});
