const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool = null;

async function getDb() {
  if (pool) return pool;

  if (!process.env.DATABASE_URL) {
    throw new Error("FATAL: DATABASE_URL is not defined in the environment. Please configure your PostgreSQL connection string.");
  }

  pool = new Pool({
    connectionString: (function() {
      try { 
        const u = new URL(process.env.DATABASE_URL); 
        u.searchParams.set('sslmode', 'verify-full'); 
        return u.toString(); 
      } catch(e) { 
        return process.env.DATABASE_URL; 
      } 
    })(),
    ssl: {
      rejectUnauthorized: false
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    console.error('Unexpected pool error:', err.message);
  });

  let retries = 5;
  while (retries > 0) {
    try {
      await initializeDatabase(pool);
      break;
    } catch (err) {
      retries--;
      console.warn(`Database connection attempt failed (${err.message}). Retrying in 2 seconds... (${retries} attempts left)`);
      if (retries === 0) throw err;
      await new Promise(res => setTimeout(res, 2000));
    }
  }

  return pool;
}

async function initializeDatabase(db) {
  // 1. Users Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(255) NOT NULL CHECK(role IN ('admin', 'student', 'manager')),
      status VARCHAR(255) DEFAULT 'active',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(255) DEFAULT 'active'`).catch(() => {});

  // 2. Rooms Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      roomNumber VARCHAR(255) UNIQUE NOT NULL,
      capacity INTEGER NOT NULL,
      monthlyFee NUMERIC NOT NULL,
      floor VARCHAR(255) NOT NULL DEFAULT 'Ground Floor',
      block VARCHAR(255) NOT NULL DEFAULT 'Block A',
      roomType VARCHAR(255) NOT NULL DEFAULT 'Triple Sharing',
      status VARCHAR(255) NOT NULL DEFAULT 'active',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor VARCHAR(255) NOT NULL DEFAULT 'Ground Floor';
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS block VARCHAR(255) NOT NULL DEFAULT 'Block A';
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS roomType VARCHAR(255) NOT NULL DEFAULT 'Triple Sharing';
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS status VARCHAR(255) NOT NULL DEFAULT 'active';
  `).catch(() => {});

  // 3. Beds Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS beds (
      id SERIAL PRIMARY KEY,
      roomId INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bedNumber INTEGER NOT NULL,
      bedLabel VARCHAR(255),
      status VARCHAR(255) NOT NULL DEFAULT 'vacant',
      userId INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (roomId, bedNumber)
    )
  `);

  await db.query(`
    ALTER TABLE beds ADD COLUMN IF NOT EXISTS bedLabel VARCHAR(255);
    ALTER TABLE beds ADD COLUMN IF NOT EXISTS blockedReason TEXT;
    ALTER TABLE beds ADD COLUMN IF NOT EXISTS reservedFor VARCHAR(255);
  `).catch(() => {});

  // 4. Students Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      userId INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      studentCustomId VARCHAR(255) UNIQUE,
      applicationId VARCHAR(255) UNIQUE,
      applicationStatus VARCHAR(255) NOT NULL DEFAULT 'PENDING',
      rejectionReason TEXT,
      correctionReason TEXT,
      studentName VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL,
      parentName VARCHAR(255) NOT NULL,
      parentPhone VARCHAR(255) NOT NULL,
      guardianRelationship VARCHAR(255),
      emergencyContact VARCHAR(255),
      aadhaarNumber VARCHAR(255) UNIQUE,
      dateOfBirth DATE,
      gender VARCHAR(255),
      collegeName VARCHAR(255) NOT NULL,
      course VARCHAR(255) NOT NULL,
      branch VARCHAR(255),
      rollNumber VARCHAR(255),
      year VARCHAR(255) NOT NULL,
      address TEXT,
      city VARCHAR(255),
      state VARCHAR(255),
      pincode VARCHAR(255),
      preferredRoomType VARCHAR(255),
      stayDuration INTEGER,
      photo TEXT,
      idProof TEXT,
      joinDate DATE NOT NULL,
      status VARCHAR(255) NOT NULL DEFAULT 'active',
      monthlyRent NUMERIC NOT NULL,
      depositAmount NUMERIC NOT NULL,
      roomId INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      bedId INTEGER REFERENCES beds(id) ON DELETE SET NULL,
      paymentStatus VARCHAR(255) NOT NULL DEFAULT 'paid',
      submittedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS submittedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS studentCustomId VARCHAR(255),
      ADD COLUMN IF NOT EXISTS applicationId VARCHAR(255),
      ADD COLUMN IF NOT EXISTS applicationStatus VARCHAR(255) NOT NULL DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS rejectionReason TEXT,
      ADD COLUMN IF NOT EXISTS correctionReason TEXT,
      ADD COLUMN IF NOT EXISTS guardianRelationship VARCHAR(255),
      ADD COLUMN IF NOT EXISTS dateOfBirth DATE,
      ADD COLUMN IF NOT EXISTS gender VARCHAR(255),
      ADD COLUMN IF NOT EXISTS bloodGroup VARCHAR(50),
      ADD COLUMN IF NOT EXISTS emergencyContact VARCHAR(255),
      ADD COLUMN IF NOT EXISTS emergencyName VARCHAR(255),
      ADD COLUMN IF NOT EXISTS emergencyRelationship VARCHAR(255),
      ADD COLUMN IF NOT EXISTS emergencyMobile VARCHAR(255),
      ADD COLUMN IF NOT EXISTS branch VARCHAR(255),
      ADD COLUMN IF NOT EXISTS rollNumber VARCHAR(255),
      ADD COLUMN IF NOT EXISTS academicYear VARCHAR(100),
      ADD COLUMN IF NOT EXISTS collegeAddress TEXT,
      ADD COLUMN IF NOT EXISTS guardianEmail VARCHAR(255),
      ADD COLUMN IF NOT EXISTS city VARCHAR(255),
      ADD COLUMN IF NOT EXISTS state VARCHAR(255),
      ADD COLUMN IF NOT EXISTS pincode VARCHAR(255),
      ADD COLUMN IF NOT EXISTS preferredRoomType VARCHAR(255),
      ADD COLUMN IF NOT EXISTS preferredFloor VARCHAR(100),
      ADD COLUMN IF NOT EXISTS preferredSharingType VARCHAR(100),
      ADD COLUMN IF NOT EXISTS foodPreference VARCHAR(100),
      ADD COLUMN IF NOT EXISTS expectedDuration INTEGER,
      ADD COLUMN IF NOT EXISTS stayDuration INTEGER,
      ADD COLUMN IF NOT EXISTS applicationRemarks TEXT,
      ADD COLUMN IF NOT EXISTS whatsappStatus VARCHAR(50) DEFAULT 'NONE',
      ADD COLUMN IF NOT EXISTS whatsappSentAt TIMESTAMP,
      ADD COLUMN IF NOT EXISTS whatsappMessageId VARCHAR(255),
      ADD COLUMN IF NOT EXISTS whatsappError TEXT,
      ADD COLUMN IF NOT EXISTS checkInDate TIMESTAMP,
      ADD COLUMN IF NOT EXISTS checkOutDate TIMESTAMP,
      ADD COLUMN IF NOT EXISTS stayStatus VARCHAR(50) DEFAULT 'NOT_CHECKED_IN',
      ADD COLUMN IF NOT EXISTS expectedCheckOutDate DATE,
      ADD COLUMN IF NOT EXISTS checkInRemarks TEXT,
      ADD COLUMN IF NOT EXISTS checkOutReason TEXT,
      ADD COLUMN IF NOT EXISTS checkOutRemarks TEXT,
      DROP CONSTRAINT IF EXISTS students_status_check;
    UPDATE students SET submittedAt = createdAt WHERE submittedAt IS NULL;
    UPDATE students 
    SET stayStatus = 'CHECKED_IN',
        checkInDate = COALESCE(checkInDate, joinDate, createdAt)
    WHERE roomId IS NOT NULL AND (stayStatus IS NULL OR stayStatus = 'NOT_CHECKED_IN') AND status = 'active';
  `).catch((err) => { console.error('Migration notice:', err.message); });

  // 5. Documents Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      studentId INTEGER REFERENCES students(id) ON DELETE CASCADE,
      documentType VARCHAR(255) NOT NULL,
      fileName VARCHAR(255) NOT NULL,
      storagePath TEXT NOT NULL,
      mimeType VARCHAR(255),
      fileSize INTEGER,
      verificationStatus VARCHAR(255) NOT NULL DEFAULT 'PENDING',
      adminRemarks TEXT,
      uploadedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS studentId INTEGER,
      ADD COLUMN IF NOT EXISTS documentType VARCHAR(255),
      ADD COLUMN IF NOT EXISTS name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS fileName VARCHAR(255),
      ADD COLUMN IF NOT EXISTS filePath TEXT,
      ADD COLUMN IF NOT EXISTS fileType VARCHAR(255),
      ADD COLUMN IF NOT EXISTS storagePath TEXT,
      ADD COLUMN IF NOT EXISTS mimeType VARCHAR(255),
      ADD COLUMN IF NOT EXISTS fileSize INTEGER,
      ADD COLUMN IF NOT EXISTS verificationStatus VARCHAR(255) DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS adminRemarks TEXT;
  `).catch(() => {});

  await db.query(`ALTER TABLE documents ALTER COLUMN name DROP NOT NULL;`).catch(() => {});

  await db.query(`CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, userId INTEGER REFERENCES users(id) ON DELETE CASCADE, token VARCHAR(255) NOT NULL, expiresAt TIMESTAMP NOT NULL, isUsed BOOLEAN DEFAULT false, createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
  
  // 6. Password Reset Requests Table (Non-OTP)
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id SERIAL PRIMARY KEY,
      studentId INTEGER REFERENCES students(id) ON DELETE CASCADE,
      phone VARCHAR(255) NOT NULL,
      status VARCHAR(255) NOT NULL DEFAULT 'PENDING',
      requestedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 6b. Secure Token-Based Password Resets Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      userId INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(255) NOT NULL,
      expiresAt TIMESTAMP NOT NULL,
      isUsed BOOLEAN DEFAULT false,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);`).catch(() => {});
  await db.query(`CREATE INDEX IF NOT EXISTS idx_password_resets_userid ON password_resets(userId);`).catch(() => {});

  // Drop legacy OTP table if present (OTP System Completely Removed)
  await db.query(`DROP TABLE IF EXISTS otps;`).catch(() => {});

  // 5. Allocations Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS allocations (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      roomId INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bedId INTEGER NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
      allocatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      vacatedAt TIMESTAMP,
      status VARCHAR(255) NOT NULL DEFAULT 'active'
    )
  `);

  await db.query(`
    ALTER TABLE allocations
      ADD COLUMN IF NOT EXISTS fromRoomId INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS fromBedId INTEGER REFERENCES beds(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reason TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT;
    CREATE INDEX IF NOT EXISTS idx_allocations_student ON allocations(studentId);
    CREATE INDEX IF NOT EXISTS idx_allocations_room ON allocations(roomId);
    CREATE INDEX IF NOT EXISTS idx_allocations_bed ON allocations(bedId);
    CREATE INDEX IF NOT EXISTS idx_allocations_status ON allocations(status);
  `).catch(() => {});

  // 6. Payments Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      billingMonth VARCHAR(255) NOT NULL,
      amountDue NUMERIC NOT NULL,
      amountPaid NUMERIC NOT NULL DEFAULT 0,
      status VARCHAR(255) NOT NULL DEFAULT 'pending',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (studentId, billingMonth)
    )
  `);

  // Phase 3: Monthly Rent Management schema enhancements
  await db.query(`
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
    ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('paid', 'pending', 'partial', 'late', 'overdue'));
  `);

  await db.query(`
    ALTER TABLE paymenthistory DROP CONSTRAINT IF EXISTS paymenthistory_paymentmode_check;
    ALTER TABLE paymenthistory ADD CONSTRAINT paymenthistory_paymentmode_check 
      CHECK (LOWER(paymentmode) IN ('cash', 'upi', 'online', 'bank transfer', 'card', 'debit/credit card', 'cheque'));
  `);

  await db.query(`
    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS invoiceNumber VARCHAR(255),
      ADD COLUMN IF NOT EXISTS dueDate TIMESTAMP,
      ADD COLUMN IF NOT EXISTS paidAt TIMESTAMP,
      ADD COLUMN IF NOT EXISTS lateFee NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS lateFeeApplied BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS billingCycleType VARCHAR(50) NOT NULL DEFAULT 'CALENDAR_MONTH',
      ADD COLUMN IF NOT EXISTS cycleStartDate DATE,
      ADD COLUMN IF NOT EXISTS cycleEndDate DATE,
      ADD COLUMN IF NOT EXISTS advancePaid NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS notes TEXT
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(studentId);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_month ON payments(billingMonth);
  `);

  // Backfill invoice numbers for existing payments where missing
  await db.query(`
    UPDATE payments 
    SET invoiceNumber = CASE 
      WHEN billingMonth = 'ADMISSION' THEN 'INV-ADM-' || LPAD(id::text, 5, '0')
      ELSE 'INV-' || REPLACE(billingMonth, '-', '') || '-' || LPAD(studentId::text, 4, '0') || '-' || LPAD(id::text, 4, '0')
    END
    WHERE invoiceNumber IS NULL
  `);

  // Ensure unique index on invoiceNumber
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_invoicenumber ON payments(invoiceNumber);
  `);

  // Phase 3: Seed default billing settings if not present
  const defaultBillingSettings = [
    { key: 'billingCycleType', value: 'CALENDAR_MONTH' }, // 'CALENDAR_MONTH' or 'JOINING_DATE'
    { key: 'rentDueDay', value: '5' },                    // 5th of each month
    { key: 'lateFeeType', value: 'FIXED' },               // 'FIXED' or 'PERCENTAGE'
    { key: 'lateFeeAmount', value: '200' },               // ₹200 or 5%
    { key: 'gracePeriodDays', value: '3' },               // Grace days past due date before late fee applies
    { key: 'autoReminderEnabled', value: 'true' },        // Automatic reminders enabled
    { key: 'autoReminderDaysBeforeDue', value: '2' }      // Days before due date to remind
  ];
  for (const bs of defaultBillingSettings) {
    await db.query(`
      INSERT INTO hostelSettings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
    `, [bs.key, bs.value]);
  }

  // 7. Payment History Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS paymentHistory (
      id SERIAL PRIMARY KEY,
      paymentId INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL,
      paymentDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paymentMode VARCHAR(255) NOT NULL,
      referenceNumber VARCHAR(255),
      notes TEXT
    )
  `);

  // 8. Reminders Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      channel VARCHAR(255) NOT NULL,
      sentAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(255) NOT NULL DEFAULT 'sent'
    )
  `);

  // 9. Notifications Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      type VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check`).catch(() => {});

  // 10. Hostel Settings Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS hostelSettings (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 11. OTP Verification Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS otps (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(255) UNIQUE NOT NULL,
      otpHash VARCHAR(255) NOT NULL,
      expiresAt TIMESTAMP NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      verifiedToken VARCHAR(512),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 12. Student Stay History Table (Phase 2)
  await db.query(`
    CREATE TABLE IF NOT EXISTS stay_history (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      roomId INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      bedId INTEGER REFERENCES beds(id) ON DELETE SET NULL,
      checkInDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checkOutDate TIMESTAMP,
      expectedCheckOutDate DATE,
      stayDurationMonths INTEGER,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      checkInRemarks TEXT,
      checkOutReason TEXT,
      checkOutRemarks TEXT,
      noticePeriodServed BOOLEAN DEFAULT TRUE,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_stay_history_student ON stay_history(studentId);
    CREATE INDEX IF NOT EXISTS idx_stay_history_status ON stay_history(status);
  `).catch(() => {});

  // 13. Checkout Settlements Table (Phase 2)
  await db.query(`
    CREATE TABLE IF NOT EXISTS settlements (
      id SERIAL PRIMARY KEY,
      settlementNumber VARCHAR(100) UNIQUE NOT NULL,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      stayId INTEGER REFERENCES stay_history(id) ON DELETE SET NULL,
      checkOutDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      securityDepositHeld NUMERIC NOT NULL DEFAULT 0,
      pendingRentAmount NUMERIC NOT NULL DEFAULT 0,
      maintenanceCharges NUMERIC NOT NULL DEFAULT 0,
      damageCharges NUMERIC NOT NULL DEFAULT 0,
      otherCharges NUMERIC NOT NULL DEFAULT 0,
      totalDeductions NUMERIC NOT NULL DEFAULT 0,
      netPayableAmount NUMERIC NOT NULL DEFAULT 0,
      refundAmount NUMERIC NOT NULL DEFAULT 0,
      amountCollected NUMERIC NOT NULL DEFAULT 0,
      refundMode VARCHAR(50),
      paymentReference VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
      notes TEXT,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_settlements_student ON settlements(studentId);
  `).catch(() => {});

  // 14. Security Deposits Table (Phase 4)
  await db.query(`
    CREATE TABLE IF NOT EXISTS security_deposits (
      id SERIAL PRIMARY KEY,
      depositNumber VARCHAR(100) UNIQUE NOT NULL,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      transactionType VARCHAR(50) NOT NULL CHECK (transactionType IN ('COLLECTION', 'REFUND', 'DEDUCTION', 'ADJUSTMENT')),
      category VARCHAR(100) NOT NULL DEFAULT 'ADMISSION_DEPOSIT',
      amount NUMERIC NOT NULL,
      balanceAfter NUMERIC NOT NULL DEFAULT 0,
      paymentMode VARCHAR(50) NOT NULL DEFAULT 'UPI',
      referenceNumber VARCHAR(255),
      reason TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PENDING', 'CANCELLED')),
      settlementId INTEGER REFERENCES settlements(id) ON DELETE SET NULL,
      recordedBy VARCHAR(255) DEFAULT 'Hostel Management',
      transactionDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS depositStatus VARCHAR(50) NOT NULL DEFAULT 'HELD',
      ADD COLUMN IF NOT EXISTS depositRefundedAmount NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS depositDeductionsAmount NUMERIC NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_security_deposits_student ON security_deposits(studentId);
    CREATE INDEX IF NOT EXISTS idx_security_deposits_type ON security_deposits(transactionType);
    CREATE INDEX IF NOT EXISTS idx_security_deposits_status ON security_deposits(status);
    CREATE INDEX IF NOT EXISTS idx_security_deposits_date ON security_deposits(transactionDate DESC);
  `).catch((err) => { console.error('Deposit migration notice:', err.message); });

  // Backfill initial deposit collection records for active students with depositAmount > 0 if not present
  await db.query(`
    INSERT INTO security_deposits (depositNumber, studentId, transactionType, category, amount, balanceAfter, paymentMode, reason, status, transactionDate)
    SELECT 
      'DEP-COL-' || LPAD(s.id::text, 4, '0') || '-INIT',
      s.id,
      'COLLECTION',
      'ADMISSION_DEPOSIT',
      COALESCE(s.depositAmount, 3000),
      COALESCE(s.depositAmount, 3000),
      'Online/Admission',
      'Initial admission security deposit',
      'COMPLETED',
      COALESCE(s.joinDate, s.createdAt)
    FROM students s
    WHERE COALESCE(s.depositAmount, 0) > 0
    AND NOT EXISTS (SELECT 1 FROM security_deposits sd WHERE sd.studentId = s.id)
    ON CONFLICT (depositNumber) DO NOTHING;
  `).catch((err) => { console.error('Deposit backfill notice:', err.message); });

  // Phase 4: Seed default deposit settings if not present
  const defaultDepositSettings = [
    { key: 'depositAmount', value: '3000' },
    { key: 'depositRefundPolicy', value: 'Security deposits are fully refundable within 3-5 business days of checkout after room inspection and clearance of pending dues.' }
  ];
  for (const ds of defaultDepositSettings) {
    await db.query(`
      INSERT INTO hostelSettings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
    `, [ds.key, ds.value]);
  }

  // Backfill initial active stay record for current residents if not yet tracked
  await db.query(`
    INSERT INTO stay_history (studentId, roomId, bedId, checkInDate, status, checkInRemarks)
    SELECT s.id, s.roomId, s.bedId, COALESCE(s.checkInDate, s.joinDate, s.createdAt), 'ACTIVE', 'Initial stay record'
    FROM students s
    WHERE s.roomId IS NOT NULL AND s.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM stay_history sh WHERE sh.studentId = s.id AND sh.status = 'ACTIVE')
  `).catch(() => {});

  // 11. Create Performance Indexes
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_beds_roomid ON beds(roomId);
    CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(status);
    CREATE INDEX IF NOT EXISTS idx_beds_userid ON beds(userId);
    CREATE INDEX IF NOT EXISTS idx_students_roomid ON students(roomId);
    CREATE INDEX IF NOT EXISTS idx_students_bedid ON students(bedId);
    CREATE INDEX IF NOT EXISTS idx_students_userid ON students(userId);
    CREATE INDEX IF NOT EXISTS idx_students_submittedat ON students(submittedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_students_createdat ON students(createdAt DESC);
  `).catch((err) => { console.error('Index creation notice:', err.message); });

  // Seed default admin
  const defaultAdminEmail = 'joelramireddy@gmail.com';
  const { rows: adminRows } = await db.query('SELECT * FROM users WHERE email = $1', [defaultAdminEmail]);
  if (!adminRows[0]) {
    const hashedPassword = await bcrypt.hash('Akshaya@2026', 10);
    await db.query(
      `INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5)`,
      ['Joel Ramireddy', defaultAdminEmail, '9885297517', hashedPassword, 'admin']
    );
    console.log('Seeded admin account: joelramireddy@gmail.com');
  }

  // Check if standard rooms (101, 102, 201, 301, etc.) exist
  const { rows: existingRooms } = await db.query("SELECT COUNT(*) as count FROM rooms WHERE roomNumber = '101'");
  if (parseInt(existingRooms[0].count) === 0) {
    // Clear legacy unformatted rooms if any
    await db.query('DELETE FROM allocations');
    await db.query('UPDATE students SET roomId = NULL, bedId = NULL');
    await db.query('DELETE FROM beds');
    await db.query('DELETE FROM rooms');

    await db.query('BEGIN');
    try {
      const mockRooms = [
        // FLOOR 1 — 6 ROOMS
        { roomNumber: '101', capacity: 5, monthlyFee: 8500, floor: 'Floor 1', block: 'Main Block', roomType: '5 Sharing' },
        { roomNumber: '102', capacity: 5, monthlyFee: 8500, floor: 'Floor 1', block: 'Main Block', roomType: '5 Sharing' },
        { roomNumber: '103', capacity: 5, monthlyFee: 8500, floor: 'Floor 1', block: 'Main Block', roomType: '5 Sharing' },
        { roomNumber: '104', capacity: 5, monthlyFee: 8500, floor: 'Floor 1', block: 'Main Block', roomType: '5 Sharing' },
        { roomNumber: '105', capacity: 4, monthlyFee: 9000, floor: 'Floor 1', block: 'Main Block', roomType: '4 Sharing' },
        { roomNumber: '106', capacity: 4, monthlyFee: 9000, floor: 'Floor 1', block: 'Main Block', roomType: '4 Sharing' },

        // FLOOR 2 — 6 ROOMS
        { roomNumber: '201', capacity: 5, monthlyFee: 8500, floor: 'Floor 2', block: 'Main Block', roomType: '5 Sharing' },
        { roomNumber: '202', capacity: 5, monthlyFee: 8500, floor: 'Floor 2', block: 'Main Block', roomType: '5 Sharing' },
        { roomNumber: '203', capacity: 5, monthlyFee: 8500, floor: 'Floor 2', block: 'Main Block', roomType: '5 Sharing' },
        { roomNumber: '204', capacity: 5, monthlyFee: 8500, floor: 'Floor 2', block: 'Main Block', roomType: '5 Sharing' },
        { roomNumber: '205', capacity: 4, monthlyFee: 9000, floor: 'Floor 2', block: 'Main Block', roomType: '4 Sharing' },
        { roomNumber: '206', capacity: 4, monthlyFee: 9000, floor: 'Floor 2', block: 'Main Block', roomType: '4 Sharing' },

        // FLOOR 3 — PENTHOUSE — 3 ROOMS
        { roomNumber: '301', capacity: 4, monthlyFee: 9500, floor: 'Floor 3 — Penthouse', block: 'Penthouse', roomType: '4 Sharing' },
        { roomNumber: '302', capacity: 4, monthlyFee: 9500, floor: 'Floor 3 — Penthouse', block: 'Penthouse', roomType: '4 Sharing' },
        { roomNumber: '303', capacity: 5, monthlyFee: 9000, floor: 'Floor 3 — Penthouse', block: 'Penthouse', roomType: '5 Sharing' }
      ];

      function getBedLetter(index) {
        let letter = '';
        let i = parseInt(index);
        while (i > 0) {
          let rem = (i - 1) % 26;
          letter = String.fromCharCode(65 + rem) + letter;
          i = Math.floor((i - 1) / 26);
        }
        return letter;
      }

      for (const room of mockRooms) {
        const { rows: roomResult } = await db.query(
          `INSERT INTO rooms (roomNumber, capacity, monthlyFee, floor, block, roomType, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [room.roomNumber, room.capacity, room.monthlyFee, room.floor, room.block, room.roomType, 'active']
        );
        const roomId = roomResult[0].id;

        for (let b = 1; b <= room.capacity; b++) {
          const bedLabel = `${room.roomNumber}-${getBedLetter(b)}`;
          await db.query(
            `INSERT INTO beds (roomId, bedNumber, bedLabel, status) VALUES ($1, $2, $3, $4)`,
            [roomId, b, bedLabel, 'vacant']
          );
        }
      }
      await db.query('COMMIT');
      console.log('Seeded Akshaya Deluxe Hostel rooms (Floor 1, Floor 2, Floor 3 — Penthouse) with alphabetical beds.');
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Room Seeding Error:', err);
    }
  }

  // Seed default hostel settings if empty
  const { rows: settingsCounts } = await db.query('SELECT COUNT(*) as count FROM hostelSettings');
  if (parseInt(settingsCounts[0].count) === 0) {
    try {
      const defaultSettings = [
        { key: 'hostelName', value: 'Akshaya Deluxe Boys Hostel' },
        { key: 'contactPhone', value: '98852 97517' },
        { key: 'ownerName', value: 'Murali' },
        { key: 'address', value: 'Opp Aurora Engineering College, Avushapur, Ghatkesar, Hyderabad, Telangana' },
        { key: 'googleMapsIframe', value: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3806.8242083984365!2d78.6946660148768!3d17.420235788094625!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bcb77b0032e3a1f%3A0xe543fa022a106fdf!2sAkshaya%20Deluxe%20Boys%20Hostel!5e0!3m2!1sen!2sin!4v1659102409831!5m2!1sen!2sin' },
        { key: 'depositAmount', value: '3000' }
      ];
      for (const setting of defaultSettings) {
        await db.query('INSERT INTO hostelSettings (key, value) VALUES ($1, $2)', [setting.key, setting.value]);
      }
      console.log('Seeded default hostel settings.');
    } catch (err) {
      console.error('Settings Seeding Error:', err);
    }
  }
}

module.exports = { getDb };
