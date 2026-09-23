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
  // Create Users Table
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

  // Create Rooms Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      roomNumber VARCHAR(255) UNIQUE NOT NULL,
      capacity INTEGER NOT NULL,
      monthlyFee NUMERIC NOT NULL,
      floor VARCHAR(255) NOT NULL DEFAULT 'Ground Floor',
      status VARCHAR(255) NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'maintenance')),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.query("ALTER TABLE rooms ADD COLUMN floor VARCHAR(255) NOT NULL DEFAULT 'Ground Floor'");
  } catch (e) {
  }

  // Create Beds Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS beds (
      id SERIAL PRIMARY KEY,
      roomId INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bedNumber INTEGER NOT NULL,
      status VARCHAR(255) NOT NULL DEFAULT 'vacant' CHECK(status IN ('vacant', 'occupied', 'reserved', 'maintenance')),
      userId INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (roomId, bedNumber)
    )
  `);

  // Create Students Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      userId INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      studentName VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL,
      parentName VARCHAR(255) NOT NULL,
      parentPhone VARCHAR(255) NOT NULL,
      aadhaarNumber VARCHAR(255) UNIQUE NOT NULL,
      collegeName VARCHAR(255) NOT NULL,
      course VARCHAR(255) NOT NULL,
      year VARCHAR(255) NOT NULL,
      address TEXT,
      photo TEXT,
      idProof TEXT,
      joinDate DATE NOT NULL,
      status VARCHAR(255) NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      monthlyRent NUMERIC NOT NULL,
      depositAmount NUMERIC NOT NULL,
      roomId INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      bedId INTEGER REFERENCES beds(id) ON DELETE SET NULL,
      paymentStatus VARCHAR(255) NOT NULL DEFAULT 'paid' CHECK(paymentStatus IN ('paid', 'unpaid')),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Payments Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      billingMonth VARCHAR(255) NOT NULL,
      amountDue NUMERIC NOT NULL,
      amountPaid NUMERIC NOT NULL DEFAULT 0,
      status VARCHAR(255) NOT NULL DEFAULT 'pending' CHECK(status IN ('paid', 'pending', 'partial', 'late')),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (studentId, billingMonth)
    )
  `);

  try { await db.query("ALTER TABLE payments ADD COLUMN dueDate TIMESTAMP"); } catch (_) {}
  try { await db.query("ALTER TABLE payments ADD COLUMN paidAt TIMESTAMP"); } catch (_) {}

  // Create Payment History Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS paymentHistory (
      id SERIAL PRIMARY KEY,
      paymentId INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL,
      paymentDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paymentMode VARCHAR(255) NOT NULL CHECK(paymentMode IN ('cash', 'upi', 'online')),
      referenceNumber VARCHAR(255),
      notes TEXT
    )
  `);

  // Create Payment Transactions Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS paymentTransactions (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      feeId INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      gatewayOrderId VARCHAR(255) UNIQUE NOT NULL,
      gatewayPaymentId VARCHAR(255),
      gatewaySignature VARCHAR(255),
      amount NUMERIC NOT NULL,
      currency VARCHAR(255) NOT NULL DEFAULT 'INR',
      paymentMethod VARCHAR(255),
      status VARCHAR(255) NOT NULL CHECK(status IN ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED')),
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paidAt TIMESTAMP
    )
  `);

  // Create Receipts Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id SERIAL PRIMARY KEY,
      transactionId INTEGER UNIQUE REFERENCES paymentTransactions(id) ON DELETE CASCADE,
      receiptNumber VARCHAR(255) UNIQUE NOT NULL,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      feeId INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL,
      generatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      receiptUrl TEXT
    )
  `);

  // Create Reminders Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      channel VARCHAR(255) NOT NULL CHECK(channel IN ('whatsapp', 'sms', 'email')),
      sentAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(255) NOT NULL DEFAULT 'sent'
    )
  `);

  // Create Notifications Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      type VARCHAR(255) NOT NULL CHECK(type IN ('new_student', 'payment_received', 'payment_due', 'room_full', 'new_complaint')),
      message TEXT NOT NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Complaints Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      category VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(255) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'resolved')),
      adminRemarks TEXT,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Documents Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      filePath TEXT NOT NULL,
      fileType VARCHAR(255) NOT NULL,
      uploadedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Hostel Settings Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS hostelSettings (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Seed default admin
  const defaultAdminEmail = 'joelramireddy@gmail.com';
  const { rows: adminRows } = await db.query('SELECT * FROM users WHERE email = $1', [defaultAdminEmail]);
  const existingAdmin = adminRows[0];

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('Akshaya@2026', 10);
    await db.query(
      `INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5)`,
      ['Joel Ramireddy', defaultAdminEmail, '9885297517', hashedPassword, 'admin']
    );
    console.log('Seeded new default admin account: joelramireddy@gmail.com / Akshaya@2026');
  }

  // Seed default rooms if empty
  const { rows: roomCounts } = await db.query('SELECT COUNT(*) as count FROM rooms');
  if (parseInt(roomCounts[0].count) === 0) {
    await db.query('BEGIN');
    try {
      const mockRooms = [
        { roomNumber: '001', capacity: 2, monthlyFee: 8500, floor: 'Ground Floor' },
        { roomNumber: '002', capacity: 3, monthlyFee: 8500, floor: 'Ground Floor' },
        { roomNumber: '003', capacity: 4, monthlyFee: 8500, floor: 'Ground Floor' },
        { roomNumber: '101', capacity: 2, monthlyFee: 8500, floor: 'First Floor' },
        { roomNumber: '102', capacity: 3, monthlyFee: 8500, floor: 'First Floor' },
        { roomNumber: '103', capacity: 4, monthlyFee: 8500, floor: 'First Floor' },
        { roomNumber: '104', capacity: 2, monthlyFee: 8500, floor: 'First Floor' },
        { roomNumber: '201', capacity: 2, monthlyFee: 8500, floor: 'Second Floor' },
        { roomNumber: '202', capacity: 3, monthlyFee: 8500, floor: 'Second Floor' },
        { roomNumber: '203', capacity: 4, monthlyFee: 8500, floor: 'Second Floor' },
        { roomNumber: '204', capacity: 2, monthlyFee: 8500, floor: 'Second Floor' },
        { roomNumber: '301', capacity: 2, monthlyFee: 8500, floor: 'Third Floor' },
        { roomNumber: '302', capacity: 3, monthlyFee: 8500, floor: 'Third Floor' },
        { roomNumber: '303', capacity: 4, monthlyFee: 8500, floor: 'Third Floor' },
        { roomNumber: '304', capacity: 2, monthlyFee: 8500, floor: 'Third Floor' }
      ];

      for (const room of mockRooms) {
        const { rows: roomResult } = await db.query(
          `INSERT INTO rooms (roomNumber, capacity, monthlyFee, floor, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [room.roomNumber, room.capacity, room.monthlyFee, room.floor, 'active']
        );
        const roomId = roomResult[0].id;

        for (let b = 1; b <= room.capacity; b++) {
          await db.query(
            `INSERT INTO beds (roomId, bedNumber, status) VALUES ($1, $2, $3)`,
            [roomId, b, 'vacant']
          );
        }
      }
      await db.query('COMMIT');
      console.log('Seeded rooms and generated beds.');
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Room Seeding Error:', err);
    }
  }

  // Seed default students if empty
  const { rows: studentCounts } = await db.query('SELECT COUNT(*) as count FROM students');
  if (parseInt(studentCounts[0].count) === 0) {
    await db.query('BEGIN');
    try {
      const mockStudents = [
        {
          name: 'Arjun Reddy',
          email: 'arjun.reddy.demo@gmail.com',
          password: 'Arjun@123',
          phone: '9876543210',
          parentName: 'Ramana Reddy',
          parentPhone: '9876543200',
          aadhaar: '987654321001',
          college: 'Aurora Deemed University',
          course: 'B.Tech Computer Science',
          year: '2nd Year',
          roomNumber: '101',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          name: 'Rahul Varma',
          email: 'rahul.varma.demo@gmail.com',
          password: 'Rahul@123',
          phone: '9876543211',
          parentName: 'Srinivas Varma',
          parentPhone: '9876543201',
          aadhaar: '987654321002',
          college: 'Aurora Deemed University',
          course: 'B.Tech Artificial Intelligence',
          year: '1st Year',
          roomNumber: '101',
          bedNum: 2,
          paymentStatus: 'paid'
        }
      ];

      for (const stud of mockStudents) {
        const hashedPassword = await bcrypt.hash(stud.password, 10);
        const { rows: userResult } = await db.query(
          `INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [stud.name, stud.email, stud.phone, hashedPassword, 'student']
        );
        const userId = userResult[0].id;
        const joinDate = new Date().toISOString().split('T')[0];

        const { rows: roomRows } = await db.query('SELECT id FROM rooms WHERE roomNumber = $1', [stud.roomNumber]);
        const roomId = roomRows.length > 0 ? roomRows[0].id : null;
        
        let bedId = null;
        if (roomId) {
          const { rows: bedRows } = await db.query('SELECT id FROM beds WHERE roomId = $1 AND bedNumber = $2', [roomId, stud.bedNum]);
          bedId = bedRows.length > 0 ? bedRows[0].id : null;
        }

        const { rows: studentResult } = await db.query(
          `INSERT INTO students (userId, studentName, phone, parentName, parentPhone, aadhaarNumber, collegeName, course, year, address, photo, idProof, joinDate, status, monthlyRent, depositAmount, roomId, bedId, paymentStatus) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
          [
            userId,
            stud.name,
            stud.phone,
            stud.parentName,
            stud.parentPhone,
            stud.aadhaar,
            stud.college,
            stud.course,
            stud.year,
            'Hyderabad, Telangana',
            '/assets/avatar-placeholder.png',
            '',
            joinDate,
            'active',
            8500,
            8500,
            roomId,
            bedId,
            stud.paymentStatus
          ]
        );
        const studentId = studentResult[0].id;

        if (bedId) {
          await db.query(
            `UPDATE beds SET status = 'occupied', userId = $1 WHERE id = $2`,
            [userId, bedId]
          );
        }

        const { rows: paymentResult } = await db.query(
          `INSERT INTO payments (studentId, billingMonth, amountDue, amountPaid, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [studentId, '2026-08', 8500, 8500, 'paid']
        );

        await db.query(
          `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) VALUES ($1, $2, $3, $4, $5)`,
          [paymentResult[0].id, 8500, 'upi', `TXN\${Math.floor(10000000 + Math.random() * 90000000)}`, 'Monthly Rent Paid']
        );
      }
      await db.query('COMMIT');
      console.log('Seeded mock students with room allocations.');
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Student Seeding Error:', err);
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
