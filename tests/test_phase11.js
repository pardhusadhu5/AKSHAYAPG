const assert = require('assert');

// Mock Database wrapper to run headless unit tests for Phase 11 controllers
const mockDb = {
  query: async (text, params) => {
    const sql = text.toLowerCase();

    if (sql.includes('from students s')) {
      return {
        rows: [
          { id: 1, studentName: 'Joel Reddy', phone: '9885297517', email: 'joel@akshayapg.com', aadhaarNumber: '123456789012', collegeName: 'Aurora Engg College', course: 'B.Tech CSE', year: '3rd Year', joinDate: '2026-07-01', monthlyRent: 8500, depositAmount: 3000, status: 'active', createdAt: new Date(), roomNumber: '101', bedLabel: '101-A' },
          { id: 2, studentName: 'Vikas Kumar', phone: '9848011223', email: 'vikas@akshayapg.com', aadhaarNumber: '987654321098', collegeName: 'Aurora Engg College', course: 'B.Tech ECE', year: '2nd Year', joinDate: '2026-08-15', monthlyRent: 8500, depositAmount: 3000, status: 'active', createdAt: new Date(), roomNumber: '101', bedLabel: '101-B' },
          { id: 3, studentName: 'Karthik Rao', phone: '9701234567', email: 'karthik@akshayapg.com', aadhaarNumber: '456789012345', collegeName: 'Vignana Bharathi', course: 'B.Tech Mech', year: '4th Year', joinDate: '2025-06-01', monthlyRent: 9000, depositAmount: 3000, status: 'vacated', createdAt: new Date(), roomNumber: '105', bedLabel: '105-A' }
        ]
      };
    }

    if (sql.includes('from rooms r')) {
      return {
        rows: [
          { id: 1, roomNumber: '101', floor: 'Floor 1', block: 'Main Block', roomType: '5 Sharing', capacity: 5, totalBeds: 5, occupiedBeds: 4, vacantBeds: 1, reservedBeds: 0, maintenanceBeds: 0, monthlyFee: 8500, status: 'active' },
          { id: 2, roomNumber: '102', floor: 'Floor 1', block: 'Main Block', roomType: '5 Sharing', capacity: 5, totalBeds: 5, occupiedBeds: 2, vacantBeds: 3, reservedBeds: 0, maintenanceBeds: 0, monthlyFee: 8500, status: 'active' },
          { id: 3, roomNumber: '201', floor: 'Floor 2', block: 'Main Block', roomType: '5 Sharing', capacity: 5, totalBeds: 5, occupiedBeds: 5, vacantBeds: 0, reservedBeds: 0, maintenanceBeds: 0, monthlyFee: 8500, status: 'active' },
          { id: 4, roomNumber: '301', floor: 'Floor 3 — Penthouse', block: 'Penthouse', roomType: '4 Sharing', capacity: 4, totalBeds: 4, occupiedBeds: 3, vacantBeds: 1, reservedBeds: 0, maintenanceBeds: 0, monthlyFee: 9500, status: 'active' }
        ]
      };
    }

    if (sql.includes('from payments p') && sql.includes("status != 'paid'")) {
      return {
        rows: [
          { id: 101, invoiceNumber: 'INV-202610-001', studentId: 1, studentName: 'Joel Reddy', phone: '9885297517', roomNumber: '101', billingMonth: '2026-10', amountDue: 8500, lateFee: 200, amountPaid: 0, pendingBalance: 8700, status: 'overdue', dueDate: '2026-10-05', daysOverdue: 22 },
          { id: 102, invoiceNumber: 'INV-202609-002', studentId: 2, studentName: 'Vikas Kumar', phone: '9848011223', roomNumber: '101', billingMonth: '2026-09', amountDue: 8500, lateFee: 500, amountPaid: 4000, pendingBalance: 5000, status: 'partial', dueDate: '2026-09-05', daysOverdue: 52 }
        ]
      };
    }

    if (sql.includes('from payments p')) {
      return {
        rows: [
          { id: 101, invoiceNumber: 'INV-202610-001', studentId: 1, studentName: 'Joel Reddy', phone: '9885297517', roomNumber: '101', billingMonth: '2026-10', billingCycleType: 'CALENDAR_MONTH', amountDue: 8500, lateFee: 0, amountPaid: 8500, advancePaid: 0, pendingBalance: 0, status: 'paid', paymentMode: 'UPI', dueDate: '2026-10-05', paidAt: '2026-10-04', createdAt: new Date() },
          { id: 102, invoiceNumber: 'INV-202610-002', studentId: 2, studentName: 'Vikas Kumar', phone: '9848011223', roomNumber: '101', billingMonth: '2026-10', billingCycleType: 'CALENDAR_MONTH', amountDue: 8500, lateFee: 200, amountPaid: 5000, advancePaid: 0, pendingBalance: 3700, status: 'partially_paid', paymentMode: 'Cash', dueDate: '2026-10-05', paidAt: '2026-10-08', createdAt: new Date() }
        ]
      };
    }

    if (sql.includes('from security_deposits sd')) {
      return {
        rows: [
          { id: 1, depositNumber: 'DEP-COL-001', studentId: 1, studentName: 'Joel Reddy', phone: '9885297517', roomNumber: '101', transactionType: 'COLLECTION', category: 'ADMISSION_DEPOSIT', amount: 3000, balanceAfter: 3000, paymentMode: 'UPI', referenceNumber: 'UPI-9821', reason: 'Initial security deposit', status: 'ACTIVE', transactionDate: '2026-07-01' },
          { id: 2, depositNumber: 'DEP-REF-002', studentId: 3, studentName: 'Karthik Rao', phone: '9701234567', roomNumber: '105', transactionType: 'REFUND', category: 'CHECKOUT_REFUND', amount: 2500, balanceAfter: 0, paymentMode: 'Bank Transfer', referenceNumber: 'NEFT-8842', reason: 'Checkout deposit refund after dues clearance', status: 'COMPLETED', transactionDate: '2026-09-30' },
          { id: 3, depositNumber: 'DEP-DED-003', studentId: 3, studentName: 'Karthik Rao', phone: '9701234567', roomNumber: '105', transactionType: 'DEDUCTION', category: 'ROOM_DAMAGE', amount: 500, balanceAfter: 2500, paymentMode: 'ADJUSTMENT', referenceNumber: 'CARPENTER-01', reason: 'Wardrobe latch repair', status: 'COMPLETED', transactionDate: '2026-09-30' }
        ]
      };
    }

    if (sql.includes('expenses')) {
      if (sql.includes('delete from expenses')) {
        return { rowCount: 1 };
      }
      if (sql.includes('insert into expenses')) {
        return {
          rows: [{
            id: 10,
            expenseNumber: 'EXP-999999',
            category: params[1],
            title: params[2],
            amount: params[3],
            expenseDate: params[4],
            billingMonth: params[5],
            paymentMode: params[6],
            paidTo: params[7],
            invoiceRef: params[8],
            notes: params[9],
            recordedBy: params[10]
          }]
        };
      }
      return {
        rows: [
          { id: 1, expenseNumber: 'EXP-2026-001', category: 'Electricity & Utilities', title: 'TSSPDCL Commercial Electricity Bill', amount: 14850, expenseDate: '2026-10-10', billingMonth: '2026-10', paymentMode: 'NetBanking', paidTo: 'TSSPDCL', invoiceRef: 'TSSPDCL-8842', notes: 'Monthly power consumption', recordedBy: 'Admin' },
          { id: 2, expenseNumber: 'EXP-2026-002', category: 'Water Supply & Tankers', title: 'Water Tanker Refill (3 Loads)', amount: 3600, expenseDate: '2026-10-15', billingMonth: '2026-10', paymentMode: 'Cash', paidTo: 'Sri Laxmi Water', invoiceRef: 'SLW-412', notes: 'Tank refilling', recordedBy: 'Admin' },
          { id: 3, expenseNumber: 'EXP-2026-003', category: 'Internet & Wi-Fi', title: 'ACT Fibernet 300 Mbps Dedicated', amount: 2850, expenseDate: '2026-10-05', billingMonth: '2026-10', paymentMode: 'UPI', paidTo: 'ACT Fibernet', invoiceRef: 'ACT-OCT-5510', notes: 'Hostel internet broadband', recordedBy: 'Admin' }
        ]
      };
    }

    if (sql.includes('from stay_history sh')) {
      return {
        rows: [
          { id: 1, studentId: 1, studentName: 'Joel Reddy', phone: '9885297517', roomNumber: '101', bedLabel: '101-A', checkInDate: '2026-07-01', checkOutDate: null, status: 'active', checkoutReason: null, pendingRent: 0, depositRefunded: 0 },
          { id: 2, studentId: 3, studentName: 'Karthik Rao', phone: '9701234567', roomNumber: '105', bedLabel: '105-A', checkInDate: '2025-06-01', checkOutDate: '2026-09-30', status: 'CHECKED_OUT', checkoutReason: 'Course Completion', pendingRent: 0, depositRefunded: 2500 }
        ]
      };
    }

    if (sql.includes('from complaints c')) {
      return {
        rows: [
          { id: 1, complaintNumber: 'CMP-2026-00001', studentId: 1, studentName: 'Joel Reddy', phone: '9885297517', roomNumber: '101', title: 'Ceiling Fan Making Noise', category: 'Electrical & Fans', priority: 'Medium', repairCost: 350, costPaidBy: 'Hostel', status: 'Resolved', createdAt: '2026-10-12', resolvedAt: '2026-10-14' },
          { id: 2, complaintNumber: 'CMP-2026-00002', studentId: 2, studentName: 'Vikas Kumar', phone: '9848011223', roomNumber: '101', title: 'Tap Leakage in Bathroom', category: 'Plumbing', priority: 'High', repairCost: 200, costPaidBy: 'Hostel', status: 'In Progress', createdAt: '2026-10-20', resolvedAt: null }
        ]
      };
    }

    if (sql.includes('visitors')) {
      if (sql.includes('update visitors')) {
        return {
          rows: [{ id: 1, visitorName: 'M. Venkat Reddy', exitTime: new Date() }]
        };
      }
      if (sql.includes('insert into visitors')) {
        return {
          rows: [{
            id: 4,
            gatePassNumber: 'GP-2026-0004',
            visitorName: params[1],
            phone: params[2],
            relation: params[3],
            purpose: params[4],
            entryTime: new Date(),
            exitTime: null,
            roomNumber: params[7]
          }]
        };
      }
      return {
        rows: [
          { id: 1, gatePassNumber: 'GP-2026-001', studentId: 1, studentName: 'Joel Reddy', roomNo: '101', visitorName: 'M. Venkat Reddy', phone: '9848012345', relation: 'Father', purpose: 'Fee Payment', entryTime: '2026-10-18 10:15:00', exitTime: '2026-10-18 12:45:00', idProofType: 'Aadhaar Card', idProofNumber: 'XXXX-4589', remarks: 'Allowed in lounge', recordedBy: 'Security' },
          { id: 2, gatePassNumber: 'GP-2026-002', studentId: 2, studentName: 'Vikas Kumar', roomNo: '101', visitorName: 'S. Tarun Kumar', phone: '9123456780', relation: 'Friend', purpose: 'Group Study', entryTime: '2026-10-25 14:00:00', exitTime: null, idProofType: 'College ID Card', idProofNumber: 'AURORA-24', remarks: 'Inside library zone', recordedBy: 'Security' }
        ]
      };
    }

    return { rows: [] };
  }
};

// Monkey-patch getDb in config/db for the unit test run
const dbModule = require('../config/db');
const originalGetDb = dbModule.getDb;
dbModule.getDb = async () => mockDb;
const reportController = require('../controllers/reportController');

async function runTests() {
  console.log('--- STARTING PHASE 11 COMPREHENSIVE AUTOMATED TESTS ---');

  // Test 1: getReportAnalytics across all 9 report types
  const reportTypes = [
    'students_admissions',
    'room_occupancy',
    'rent_collection',
    'pending_dues',
    'security_deposits',
    'income_expenses',
    'checkin_checkout',
    'complaints_maintenance',
    'visitors'
  ];

  for (const type of reportTypes) {
    let capturedJson = null;
    let capturedStatus = null;
    const req = {
      query: { type, month: '2026-10' }
    };
    const res = {
      status: (st) => { capturedStatus = st; return res; },
      json: (data) => { capturedJson = data; }
    };

    await reportController.getReportAnalytics(req, res);

    assert.strictEqual(capturedStatus, 200, `Expected 200 for ${type}`);
    assert.strictEqual(capturedJson.success, true, `Expected success: true for ${type}`);
    assert.ok(capturedJson.kpis, `Expected KPIs object for ${type}`);
    assert.ok(capturedJson.breakdown, `Expected breakdown object for ${type}`);
    assert.ok(Array.isArray(capturedJson.records), `Expected records array for ${type}`);
    console.log(`✓ Analytics Test Passed: ${type} (KPIs: ${Object.keys(capturedJson.kpis).length}, Records: ${capturedJson.recordsCount})`);
  }

  // Test 2: CSV Downloads across all 9 report types
  for (const type of reportTypes) {
    let capturedCsv = '';
    let capturedHeaders = {};
    const req = {
      query: { type, month: '2026-10' }
    };
    const res = {
      setHeader: (name, val) => { capturedHeaders[name.toLowerCase()] = val; },
      status: (st) => res,
      send: (body) => { capturedCsv = body; }
    };

    await reportController.downloadReport(req, res);

    assert.ok(capturedCsv.startsWith('\ufeff'), `Expected UTF-8 BOM in CSV for ${type}`);
    assert.ok(capturedCsv.includes('\n'), `Expected newlines in CSV for ${type}`);
    assert.ok(capturedHeaders['content-type'].includes('text/csv'), `Expected CSV content-type for ${type}`);
    console.log(`✓ CSV Export Test Passed: ${type} (Bytes: ${capturedCsv.length})`);
  }

  // Test 3: PDF Generation across all 9 report types
  for (const type of reportTypes) {
    let capturedHeaders = {};
    let writtenChunks = [];
    const req = {
      query: { type, month: '2026-10' }
    };
    const res = {
      setHeader: (name, val) => { capturedHeaders[name.toLowerCase()] = val; },
      write: (chunk) => { writtenChunks.push(chunk); },
      end: () => {},
      on: () => {},
      once: () => {},
      emit: () => {}
    };

    await reportController.downloadReportPdf(req, res);
    assert.ok(capturedHeaders['content-type'].includes('application/pdf'), `Expected PDF content-type for ${type}`);
    console.log(`✓ PDF Export Test Passed: ${type}`);
  }

  // Test 4: Expense Management CRUD
  {
    let expResult = null;
    const reqAdd = {
      body: {
        category: 'Maintenance & Repairs',
        title: 'Geyser Heating Element Replacement',
        amount: 1200,
        expenseDate: '2026-10-24',
        paymentMode: 'UPI',
        paidTo: 'Ramesh Electricals',
        invoiceRef: 'BILL-4412',
        notes: 'Room 201 geyser repair'
      },
      user: { name: 'Admin Manager' }
    };
    const resAdd = {
      status: (st) => resAdd,
      json: (data) => { expResult = data; }
    };
    await reportController.recordExpense(reqAdd, resAdd);
    assert.strictEqual(expResult.success, true);
    assert.strictEqual(expResult.expense.title, 'Geyser Heating Element Replacement');
    console.log('✓ Expense Creation Test Passed');

    let delResult = null;
    const reqDel = { params: { id: 10 } };
    const resDel = {
      status: (st) => resDel,
      json: (data) => { delResult = data; }
    };
    await reportController.deleteExpense(reqDel, resDel);
    assert.strictEqual(delResult.success, true);
    console.log('✓ Expense Deletion Test Passed');
  }

  // Test 5: Visitor Management CRUD
  {
    let visResult = null;
    const reqVis = {
      body: {
        studentId: 1,
        visitorName: 'M. Venkat Reddy',
        phone: '9848012345',
        relation: 'Father',
        purpose: 'Handover books and monthly pocket money',
        idProofType: 'Aadhaar Card',
        idProofNumber: 'XXXX-9821',
        roomNumber: '101',
        remarks: 'Allowed in Ground Floor lobby'
      },
      user: { name: 'Main Gate Security' }
    };
    const resVis = {
      status: (st) => resVis,
      json: (data) => { visResult = data; }
    };
    await reportController.recordVisitor(reqVis, resVis);
    assert.strictEqual(visResult.success, true);
    assert.ok(visResult.visitor.gatePassNumber.startsWith('GP-'));
    console.log(`✓ Visitor Entry Test Passed (Gate Pass: ${visResult.visitor.gatePassNumber})`);

    let checkOutResult = null;
    const reqOut = { params: { id: 1 } };
    const resOut = {
      status: (st) => resOut,
      json: (data) => { checkOutResult = data; }
    };
    await reportController.checkoutVisitor(reqOut, resOut);
    assert.strictEqual(checkOutResult.success, true);
    console.log('✓ Visitor Check-out Test Passed');
  }

  // Restore getDb
  dbModule.getDb = originalGetDb;

  console.log('====================================================');
  console.log('ALL PHASE 11 TESTS COMPLETED SUCCESSFULLY WITH ZERO ERRORS!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Phase 11 Test Failure:', err);
  process.exit(1);
});
