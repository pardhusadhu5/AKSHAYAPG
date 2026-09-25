const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool = null;

async function getDb() {
  if (pool) return pool;

  if (!process.env.DATABASE_URL) {
    throw new Error("FATAL: DATABASE_URL is not defined in the environment. Please configure your PostgreSQL connection string.");
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  await initializeDatabase(pool);

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
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  await db.query(`ALTER TABLE beds ADD COLUMN IF NOT EXISTS bedLabel VARCHAR(255)`).catch(() => {});

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
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE students 
      ADD COLUMN IF NOT EXISTS studentCustomId VARCHAR(255),
      ADD COLUMN IF NOT EXISTS applicationId VARCHAR(255),
      ADD COLUMN IF NOT EXISTS applicationStatus VARCHAR(255) NOT NULL DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS rejectionReason TEXT,
      ADD COLUMN IF NOT EXISTS correctionReason TEXT,
      ADD COLUMN IF NOT EXISTS guardianRelationship VARCHAR(255),
      ADD COLUMN IF NOT EXISTS dateOfBirth DATE,
      ADD COLUMN IF NOT EXISTS gender VARCHAR(255),
      ADD COLUMN IF NOT EXISTS emergencyContact VARCHAR(255),
      ADD COLUMN IF NOT EXISTS branch VARCHAR(255),
      ADD COLUMN IF NOT EXISTS rollNumber VARCHAR(255),
      ADD COLUMN IF NOT EXISTS city VARCHAR(255),
      ADD COLUMN IF NOT EXISTS state VARCHAR(255),
      ADD COLUMN IF NOT EXISTS pincode VARCHAR(255),
      ADD COLUMN IF NOT EXISTS preferredRoomType VARCHAR(255),
      ADD COLUMN IF NOT EXISTS stayDuration INTEGER,
      DROP CONSTRAINT IF EXISTS students_status_check;
  `).catch((err) => { console.error('Migration notice:', err.message); });

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

  try { await db.query("ALTER TABLE payments ADD COLUMN dueDate TIMESTAMP"); } catch (_) {}
  try { await db.query("ALTER TABLE payments ADD COLUMN paidAt TIMESTAMP"); } catch (_) {}

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

  // 11. Create Performance Indexes
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_beds_roomid ON beds(roomId);
    CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(status);
    CREATE INDEX IF NOT EXISTS idx_beds_userid ON beds(userId);
    CREATE INDEX IF NOT EXISTS idx_students_roomid ON students(roomId);
    CREATE INDEX IF NOT EXISTS idx_students_bedid ON students(bedId);
    CREATE INDEX IF NOT EXISTS idx_students_userid ON students(userId);
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

  // Seed sample students if empty (DISABLED to start with clean real admission workflow)
  if (false) {
    await db.query('BEGIN');
    try {
      const mockStudents = [];
    } catch (_) {}
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
