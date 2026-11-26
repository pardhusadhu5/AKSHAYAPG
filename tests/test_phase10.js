require('dotenv').config();
const { getDb } = require('../config/db');
const { createNotification, broadcastAnnouncement } = require('../services/notificationService');
const emailService = require('../services/emailService');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`❌ FAIL: ${testName}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('=== Starting Phase 10 Notifications & Announcements Test Suite ===\n');
  const db = await getDb();

  // 1. Verify notifications table schema
  console.log('--- Test 1: Notifications Table Schema ---');
  const { rows: notiCols } = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'notifications'"
  );
  const colNames = notiCols.map(r => r.column_name.toLowerCase());
  assert(colNames.includes('userid'), 'notifications has userId column');
  assert(colNames.includes('studentid'), 'notifications has studentId column');
  assert(colNames.includes('title'), 'notifications has title column');
  assert(colNames.includes('category'), 'notifications has category column');
  assert(colNames.includes('channel'), 'notifications has channel column');
  assert(colNames.includes('metadata'), 'notifications has metadata column');
  assert(colNames.includes('readat'), 'notifications has readAt column');

  // 2. Verify announcements table schema and seeded data
  console.log('\n--- Test 2: Announcements Table Schema & Seeds ---');
  const { rows: annCols } = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'announcements'"
  );
  const annColNames = annCols.map(r => r.column_name.toLowerCase());
  assert(annColNames.includes('title'), 'announcements has title column');
  assert(annColNames.includes('content'), 'announcements has content column');
  assert(annColNames.includes('category'), 'announcements has category column');
  assert(annColNames.includes('priority'), 'announcements has priority column');
  assert(annColNames.includes('isactive'), 'announcements has isActive column');

  const { rows: initialAnns } = await db.query("SELECT * FROM announcements WHERE isActive = true");
  assert(initialAnns.length >= 3, `Seeded initial announcements present (found ${initialAnns.length})`);

  // 3. Test In-App Notification Creation & Queries
  console.log('\n--- Test 3: Notification Creation & Tracking ---');
  // Find or use sample student with joined user email
  const { rows: students } = await db.query(
    "SELECT s.id, s.userId, s.studentName, u.email FROM students s JOIN users u ON s.userId = u.id LIMIT 1"
  );
  const testStudent = students[0] || { id: 1, userid: 1, studentname: 'Test Resident', email: 'test@example.com' };

  // Create test notifications across different categories
  const testCategories = [
    { type: 'ADMISSION', category: 'ADMISSION', title: 'Application Approved', message: 'Your hostel application has been approved.' },
    { type: 'RENT_DUE', category: 'RENT_DUE', title: 'Rent Payment Due', message: 'Monthly rent for 2026-10 is due.' },
    { type: 'RENT_OVERDUE', category: 'RENT_OVERDUE', title: 'Overdue Rent Alert', message: 'Monthly rent is overdue. Late fee applied.' },
    { type: 'PAYMENT', category: 'PAYMENT', title: 'Payment Confirmed', message: 'Payment of ₹8500 confirmed. Receipt #REC-101.' },
    { type: 'STAY_CHECKIN', category: 'STAY', title: 'Hostel Check-in', message: 'Checked into Room 101-A.' },
    { type: 'COMPLAINT_UPDATE', category: 'COMPLAINT', title: 'Ticket Resolved', message: 'Maintenance issue resolved.' }
  ];

  const createdNotiIds = [];
  for (const tc of testCategories) {
    const noti = await createNotification({
      userId: testStudent.userid || testStudent.userId,
      studentId: testStudent.id,
      type: tc.type,
      category: tc.category,
      title: tc.title,
      message: tc.message,
      channel: 'IN_APP',
      metadata: { test: true }
    });
    assert(noti && noti.id, `Created ${tc.category} notification (id: ${noti?.id})`);
    if (noti?.id) createdNotiIds.push(noti.id);
  }

  // Verify notifications can be queried for student
  const { rows: studentNotis } = await db.query(
    "SELECT * FROM notifications WHERE studentId = $1 OR userId = $2 ORDER BY id DESC",
    [testStudent.id, testStudent.userid || testStudent.userId]
  );
  assert(studentNotis.length >= createdNotiIds.length, `Retrieved student notifications (count: ${studentNotis.length})`);

  // Test single mark read
  const notiToRead = createdNotiIds[0];
  const { rows: readResult } = await db.query(
    "UPDATE notifications SET isRead = 1, readAt = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
    [notiToRead]
  );
  assert(readResult[0]?.isread === 1 && readResult[0]?.readat !== null, `Marked single notification #${notiToRead} as read`);

  // Test mark all read
  await db.query(
    "UPDATE notifications SET isRead = 1, readAt = CURRENT_TIMESTAMP WHERE id = ANY($1)",
    [createdNotiIds]
  );
  const { rows: remainingUnread } = await db.query(
    "SELECT COUNT(*) as count FROM notifications WHERE id = ANY($1) AND isRead = 0",
    [createdNotiIds]
  );
  assert(parseInt(remainingUnread[0].count, 10) === 0, 'Mark all test notifications as read verified');

  // 4. Test Announcements CRUD
  console.log('\n--- Test 4: Announcements CRUD & Priority Sorting ---');
  // Create test announcement
  const { rows: newAnnRows } = await db.query(`
    INSERT INTO announcements (title, content, category, priority, targetAudience, isActive, postedBy)
    VALUES ('🚨 Fire Drill Notice', 'Annual fire safety inspection tomorrow at 4 PM.', 'EMERGENCY', 'Urgent', 'ALL', TRUE, 'Hostel Warden')
    RETURNING *
  `);
  const createdAnn = newAnnRows[0];
  assert(createdAnn && createdAnn.id, `Created test announcement #${createdAnn?.id}`);

  // Fetch active announcements and verify priority ordering
  const { rows: sortedAnns } = await db.query(`
    SELECT id, title, priority, category FROM announcements 
    WHERE isActive = true
    ORDER BY CASE priority WHEN 'Urgent' THEN 1 WHEN 'Important' THEN 2 ELSE 3 END, createdAt DESC
  `);
  assert(sortedAnns.length > 0 && sortedAnns[0].priority === 'Urgent', 'Urgent priority announcements appear at the top');

  // Toggle announcement
  const { rows: toggledRows } = await db.query(
    "UPDATE announcements SET isActive = NOT isActive WHERE id = $1 RETURNING *",
    [createdAnn.id]
  );
  assert(toggledRows[0]?.isactive === false, `Toggled announcement #${createdAnn.id} to inactive`);

  // Delete test announcement
  const { rowCount: delCount } = await db.query("DELETE FROM announcements WHERE id = $1", [createdAnn.id]);
  assert(delCount === 1, `Deleted test announcement #${createdAnn.id}`);

  // 5. Test Email Service Templates
  console.log('\n--- Test 5: Email Service Functions (Non-blocking) ---');
  const emailOpts = { to: 'teststudent@example.com', studentName: 'Test Student' };

  const admEmailRes = await emailService.sendAdmissionStatusEmail({
    ...emailOpts,
    status: 'APPROVED',
    applicationId: 'AKS-2026-001'
  });
  assert(typeof admEmailRes === 'object', 'sendAdmissionStatusEmail completed without throwing');

  const rentEmailRes = await emailService.sendRentReminderEmail({
    ...emailOpts,
    billingMonth: '2026-10',
    amountDue: 8500,
    dueDate: '2026-10-05',
    isOverdue: false
  });
  assert(typeof rentEmailRes === 'object', 'sendRentReminderEmail completed without throwing');

  const stayEmailRes = await emailService.sendStayStatusEmail({
    ...emailOpts,
    type: 'CHECK_IN',
    roomNumber: '101',
    bedLabel: '101-A'
  });
  assert(typeof stayEmailRes === 'object', 'sendStayStatusEmail completed without throwing');

  const complaintEmailRes = await emailService.sendComplaintStatusEmail({
    ...emailOpts,
    ticketNumber: 'CMP-2026-00001',
    category: 'Electrical & Fans',
    status: 'Resolved',
    adminRemarks: 'Ceiling fan regulator replaced.'
  });
  assert(typeof complaintEmailRes === 'object', 'sendComplaintStatusEmail completed without throwing');

  const annEmailRes = await emailService.sendAnnouncementEmail({
    ...emailOpts,
    title: '💧 Water Tank Cleaning',
    content: 'Water supply will be paused from 10 AM to 1 PM.',
    category: 'MAINTENANCE',
    priority: 'Important'
  });
  assert(typeof annEmailRes === 'object', 'sendAnnouncementEmail completed without throwing');

  // Clean up created test notifications
  if (createdNotiIds.length > 0) {
    await db.query("DELETE FROM notifications WHERE id = ANY($1)", [createdNotiIds]);
  }

  console.log(`\n========================================`);
  console.log(`Tests Finished: ${passedTests} PASSED, ${failedTests} FAILED.`);
  console.log(`========================================\n`);

  process.exit(failedTests > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
