require('dotenv').config();
const { getDb } = require('../config/db');
const complaintController = require('../controllers/complaintController');

async function runPhase6Tests() {
  console.log('====================================================');
  console.log('STARTING PHASE 6 COMPLAINTS & MAINTENANCE TEST SUITE');
  console.log('====================================================');

  const db = await getDb();
  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      throw new Error(message);
    } else {
      passedTests++;
      console.log(`✅ PASS: ${message}`);
    }
  }

  try {
    // 1. Verify complaints table columns
    console.log('\n--- Test 1: Verify Database Schema ---');
    const { rows: columns } = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'complaints'
    `);
    const colNames = columns.map(c => c.column_name.toLowerCase());
    const requiredCols = [
      'id', 'complaintnumber', 'studentid', 'roomid', 'bedid',
      'category', 'title', 'description', 'imageurl', 'priority',
      'status', 'assignedto', 'assignedphone', 'assignedat',
      'adminremarks', 'resolutionnotes', 'resolvedat', 'repaircost',
      'costpaidby', 'invoiceref', 'createdat', 'updatedat'
    ];

    for (const reqCol of requiredCols) {
      assert(colNames.includes(reqCol), `Column '${reqCol}' exists in 'complaints' table`);
    }

    // 2. Fetch or seed a test student for complaint tests
    console.log('\n--- Test 2: Identify Active Student Resident ---');
    let { rows: students } = await db.query(`
      SELECT s.*, u.id as user_id 
      FROM students s
      JOIN users u ON s.userId = u.id
      WHERE s.status = 'active' AND s.roomId IS NOT NULL
      LIMIT 1
    `);

    let testStudent = students[0];
    if (!testStudent) {
      // Find any student
      const { rows: anyStudents } = await db.query(`
        SELECT s.*, u.id as user_id 
        FROM students s
        JOIN users u ON s.userId = u.id
        LIMIT 1
      `);
      testStudent = anyStudents[0];
    }
    assert(!!testStudent, `Found student resident for complaint tests (Student ID: ${testStudent.id})`);

    // 3. Test Student Complaint Submission via Controller
    console.log('\n--- Test 3: Student Submits New Complaint Ticket ---');
    let createdComplaint = null;

    const mockReqSubmit = {
      user: { id: testStudent.user_id, role: 'student' },
      body: {
        category: 'Electrical & Fans',
        title: 'Ceiling Fan Making Squeaking Noise',
        description: 'The ceiling fan in my room is making loud noises at speed 3 and vibrating.',
        priority: 'Medium'
      },
      file: null
    };

    const mockResSubmit = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.responseData = data;
        return this;
      }
    };

    await complaintController.submitComplaint(mockReqSubmit, mockResSubmit);
    assert(mockResSubmit.statusCode === 201, 'Student complaint submission returns 201 Created');
    assert(mockResSubmit.responseData.success === true, 'Response indicates success: true');
    createdComplaint = mockResSubmit.responseData.complaint;
    assert(!!createdComplaint, 'Created complaint object returned');
    assert(createdComplaint.complaintnumber.startsWith('CMP-'), `Complaint number has correct format (${createdComplaint.complaintnumber})`);
    assert(createdComplaint.status === 'Open', `Initial status is 'Open'`);
    assert(createdComplaint.priority === 'Medium', 'Priority is preserved');

    // 4. Test Student Fetching Own Complaints
    console.log('\n--- Test 4: Student Fetches My Complaints ---');
    const mockReqMy = {
      user: { id: testStudent.user_id, role: 'student' }
    };
    const mockResMy = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };

    await complaintController.getMyComplaints(mockReqMy, mockResMy);
    assert(mockResMy.statusCode === 200, 'Student getMyComplaints returns 200 OK');
    assert(Array.isArray(mockResMy.responseData.complaints), 'Complaints returned as an array');
    const foundMy = mockResMy.responseData.complaints.find(c => c.id === createdComplaint.id);
    assert(!!foundMy, 'Newly created complaint is present in student complaints list');

    // 5. Test Admin Listing All Complaints with Filter
    console.log('\n--- Test 5: Admin Lists and Filters Complaints ---');
    const mockReqAdminList = {
      user: { id: 1, role: 'admin' },
      query: { status: 'Open', category: 'ALL' }
    };
    const mockResAdminList = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };

    await complaintController.getAllComplaints(mockReqAdminList, mockResAdminList);
    assert(mockResAdminList.statusCode === 200, 'Admin getAllComplaints returns 200 OK');
    assert(mockResAdminList.responseData.complaints.length > 0, 'Admin can see open complaints');

    // 6. Test Admin Assigning Staff/Technician
    console.log('\n--- Test 6: Admin Assigns Technician to Complaint ---');
    const mockReqAssign = {
      user: { id: 1, role: 'admin' },
      params: { id: createdComplaint.id },
      body: {
        assignedTo: 'Ramesh (Electrician)',
        assignedPhone: '98480 12345',
        adminRemarks: 'Assigned to inspect switch and fan bearing today'
      }
    };
    const mockResAssign = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };

    await complaintController.assignComplaint(mockReqAssign, mockResAssign);
    assert(mockResAssign.statusCode === 200, 'Assign complaint returns 200 OK');
    assert(mockResAssign.responseData.complaint.status === 'Assigned', 'Status updated to Assigned');
    assert(mockResAssign.responseData.complaint.assignedto === 'Ramesh (Electrician)', 'Assigned staff correctly saved');
    assert(mockResAssign.responseData.complaint.assignedphone === '98480 12345', 'Staff phone saved');

    // 7. Test Status Update to 'In Progress'
    console.log('\n--- Test 7: Admin Updates Status to In Progress ---');
    const mockReqInProgress = {
      user: { id: 1, role: 'admin' },
      params: { id: createdComplaint.id },
      body: {
        status: 'In Progress',
        adminRemarks: 'Technician on-site inspecting ceiling motor.'
      }
    };
    const mockResInProgress = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };

    await complaintController.updateComplaintStatus(mockReqInProgress, mockResInProgress);
    assert(mockResInProgress.statusCode === 200, 'Update status returns 200 OK');
    assert(mockResInProgress.responseData.complaint.status === 'In Progress', 'Status updated to In Progress');

    // 8. Test Status Update to 'Resolved' with Repair Cost & Invoice Reference
    console.log('\n--- Test 8: Admin Resolves Complaint & Records Maintenance Repair Cost ---');
    const mockReqResolve = {
      user: { id: 1, role: 'admin' },
      params: { id: createdComplaint.id },
      body: {
        status: 'Resolved',
        repairCost: 350,
        costPaidBy: 'Hostel',
        invoiceRef: 'VOUCHER-ELEC-881',
        resolutionNotes: 'Replaced faulty 2.5uF capacitor and lubricated fan bearing. Verified silent running.',
        adminRemarks: 'Work inspected and completed.'
      }
    };
    const mockResResolve = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };

    await complaintController.updateComplaintStatus(mockReqResolve, mockResResolve);
    assert(mockResResolve.statusCode === 200, 'Resolution returns 200 OK');
    const resolvedComp = mockResResolve.responseData.complaint;
    assert(resolvedComp.status === 'Resolved', 'Status is Resolved');
    assert(parseFloat(resolvedComp.repaircost) === 350, 'Repair cost recorded as ₹350');
    assert(resolvedComp.costpaidby === 'Hostel', 'Cost paid by recorded as Hostel');
    assert(resolvedComp.invoiceref === 'VOUCHER-ELEC-881', 'Invoice ref recorded');
    assert(!!resolvedComp.resolvedat, 'resolvedAt timestamp automatically populated');

    // 9. Test Complaint Metrics & Expenditure Stats
    console.log('\n--- Test 9: Verify Complaint Stats & Expenditure Aggregation ---');
    const mockReqStats = {
      user: { id: 1, role: 'admin' }
    };
    const mockResStats = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };

    await complaintController.getComplaintStats(mockReqStats, mockResStats);
    assert(mockResStats.statusCode === 200, 'Complaint stats returns 200 OK');
    const stats = mockResStats.responseData.stats;
    assert(stats.total > 0, `Total complaints count > 0 (${stats.total})`);
    assert(stats.resolved > 0, `Resolved complaints count > 0 (${stats.resolved})`);
    assert(stats.totalRepairCost >= 350, `Total repair expenditure includes the ₹350 repair (Total: ₹${stats.totalRepairCost})`);
    assert(stats.hostelRepairCost >= 350, `Hostel repair cost breakdown includes ₹350 (Hostel: ₹${stats.hostelRepairCost})`);

    // 10. Test Rejection Flow
    console.log('\n--- Test 10: Test Complaint Rejection with Remarks ---');
    const mockReqReject = {
      user: { id: 1, role: 'admin' },
      params: { id: createdComplaint.id },
      body: {
        status: 'Rejected',
        adminRemarks: 'Duplicate ticket raised or test verification complete.'
      }
    };
    const mockResReject = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await complaintController.updateComplaintStatus(mockReqReject, mockResReject);
    assert(mockResReject.statusCode === 200, 'Status update to Rejected returns 200 OK');
    assert(mockResReject.responseData.complaint.status === 'Rejected', 'Status is Rejected');

    // Clean up test complaint record
    await db.query(`DELETE FROM complaints WHERE id = $1`, [createdComplaint.id]);
    console.log('Cleaned up test complaint record.');

    console.log('====================================================');
    console.log(`ALL PHASE 6 TESTS PASSED SUCCESSFULLY! (${passedTests}/${totalTests})`);
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  }
}

runPhase6Tests();
