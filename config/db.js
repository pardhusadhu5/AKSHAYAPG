const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

let dbConnection = null;

async function getDb() {
  if (dbConnection) return dbConnection;

  const dbPath = path.join(__dirname, '..', 'database.db');
  
  dbConnection = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await dbConnection.get('PRAGMA foreign_keys = ON');

  // Initialize schemas
  await initializeDatabase(dbConnection);

  return dbConnection;
}

async function initializeDatabase(db) {
  // Create Users Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'student', 'manager')),
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Rooms Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roomNumber TEXT UNIQUE NOT NULL,
      capacity INTEGER NOT NULL,
      monthlyFee REAL NOT NULL,
      floor TEXT NOT NULL DEFAULT 'Ground Floor',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'maintenance')),
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Safe migration check for existing 'rooms' table (add floor and status update check constraints)
  try {
    await db.exec("ALTER TABLE rooms ADD COLUMN floor TEXT NOT NULL DEFAULT 'Ground Floor'");
  } catch (e) {
    // Column already exists
  }

  // Create Beds Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS beds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roomId INTEGER NOT NULL,
      bedNumber INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'vacant' CHECK(status IN ('vacant', 'occupied', 'reserved', 'maintenance')),
      userId INTEGER UNIQUE,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (roomId) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (roomId, bedNumber)
    )
  `);

  // Create Students Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER UNIQUE,
      studentName TEXT NOT NULL,
      phone TEXT NOT NULL,
      parentName TEXT NOT NULL,
      parentPhone TEXT NOT NULL,
      aadhaarNumber TEXT UNIQUE NOT NULL,
      collegeName TEXT NOT NULL,
      course TEXT NOT NULL,
      year TEXT NOT NULL,
      address TEXT,
      photo TEXT,
      idProof TEXT,
      joinDate TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      monthlyRent REAL NOT NULL,
      depositAmount REAL NOT NULL,
      roomId INTEGER,
      bedId INTEGER,
      paymentStatus TEXT NOT NULL DEFAULT 'paid' CHECK(paymentStatus IN ('paid', 'unpaid')),
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (roomId) REFERENCES rooms(id) ON DELETE SET NULL,
      FOREIGN KEY (bedId) REFERENCES beds(id) ON DELETE SET NULL
    )
  `);

  // Create Payments Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL,
      billingMonth TEXT NOT NULL, -- e.g. '2026-08'
      amountDue REAL NOT NULL,
      amountPaid REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('paid', 'pending', 'partial', 'late')),
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE (studentId, billingMonth)
    )
  `);

  // Safe migrations for payments table
  try { await db.exec("ALTER TABLE payments ADD COLUMN dueDate TEXT"); } catch (_) {}
  try { await db.exec("ALTER TABLE payments ADD COLUMN paidAt TEXT"); } catch (_) {}

  // Create Payment History Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS paymentHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paymentId INTEGER NOT NULL,
      amount REAL NOT NULL,
      paymentDate TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paymentMode TEXT NOT NULL CHECK(paymentMode IN ('cash', 'upi', 'online')),
      referenceNumber TEXT,
      notes TEXT,
      FOREIGN KEY (paymentId) REFERENCES payments(id) ON DELETE CASCADE
    )
  `);

  // Create Payment Transactions Table (Online Gateway Orders & Verification)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS paymentTransactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL,
      feeId INTEGER NOT NULL,
      gatewayOrderId TEXT UNIQUE NOT NULL,
      gatewayPaymentId TEXT,
      gatewaySignature TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      paymentMethod TEXT,
      status TEXT NOT NULL CHECK(status IN ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED')),
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paidAt TEXT,
      FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (feeId) REFERENCES payments(id) ON DELETE CASCADE
    )
  `);

  // Create Receipts Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transactionId INTEGER UNIQUE,
      receiptNumber TEXT UNIQUE NOT NULL,
      studentId INTEGER NOT NULL,
      feeId INTEGER NOT NULL,
      amount REAL NOT NULL,
      generatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      receiptUrl TEXT,
      FOREIGN KEY (transactionId) REFERENCES paymentTransactions(id) ON DELETE CASCADE,
      FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (feeId) REFERENCES payments(id) ON DELETE CASCADE
    )
  `);

  // Create Reminders Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('whatsapp', 'sms', 'email')),
      sentAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'sent',
      FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  // Create Notifications Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('new_student', 'payment_received', 'payment_due', 'room_full', 'new_complaint')),
      message TEXT NOT NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Complaints Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'resolved')),
      adminRemarks TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  // Create Documents Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL,
      name TEXT NOT NULL,
      filePath TEXT NOT NULL,
      fileType TEXT NOT NULL,
      uploadedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE
    )
  `);

  // Create Hostel Settings Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hostelSettings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Seed default admin
  const defaultAdminEmail = 'joelramireddy@gmail.com';
  const existingAdmin = await db.get('SELECT * FROM users WHERE email = ?', [defaultAdminEmail]);

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('Akshaya@2026', 10);
    await db.run(
      `INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)`,
      ['Joel Ramireddy', defaultAdminEmail, '9885297517', hashedPassword, 'admin']
    );
    console.log('Seeded new default admin account: joelramireddy@gmail.com / Akshaya@2026');
  }

  // Seed default rooms if empty
  const roomCount = await db.get('SELECT COUNT(*) as count FROM rooms');
  if (roomCount.count === 0) {
    await db.run('BEGIN TRANSACTION');
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
        const roomResult = await db.run(
          `INSERT INTO rooms (roomNumber, capacity, monthlyFee, floor, status) VALUES (?, ?, ?, ?, ?)`,
          [room.roomNumber, room.capacity, room.monthlyFee, room.floor, 'active']
        );
        const roomId = roomResult.lastID;

        // Generate beds
        for (let b = 1; b <= room.capacity; b++) {
          await db.run(
            `INSERT INTO beds (roomId, bedNumber, status) VALUES (?, ?, ?)`,
            [roomId, b, 'vacant']
          );
        }
      }
      await db.run('COMMIT');
      console.log('Seeded rooms and generated beds.');
    } catch (err) {
      await db.run('ROLLBACK');
      console.error('Room Seeding Error:', err);
    }
  }

  // Seed default students if empty
  const studentCount = await db.get('SELECT COUNT(*) as count FROM students');
  if (studentCount.count === 0) {
    await db.run('BEGIN TRANSACTION');
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
        },
        {
          name: 'Karthik Naidu',
          email: 'karthik.naidu.demo@gmail.com',
          password: 'Karthik@123',
          phone: '9876543212',
          parentName: 'Venkatesh Naidu',
          parentPhone: '9876543202',
          aadhaar: '987654321003',
          college: 'Malla Reddy University',
          course: 'B.Tech Information Technology',
          year: '3rd Year',
          roomNumber: '102',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          name: 'Sai Teja',
          email: 'sai.teja.demo@gmail.com',
          password: 'Sai@123',
          phone: '9876543213',
          parentName: 'Narayana Teja',
          parentPhone: '9876543203',
          aadhaar: '987654321004',
          college: 'CMR Technical Campus',
          course: 'B.Tech Electronics and Communication',
          year: '2nd Year',
          roomNumber: '102',
          bedNum: 2,
          paymentStatus: 'paid'
        },
        {
          name: 'Aditya Kumar',
          email: 'aditya.kumar.demo@gmail.com',
          password: 'Aditya@123',
          phone: '9876543214',
          parentName: 'Rajesh Kumar',
          parentPhone: '9876543204',
          aadhaar: '987654321005',
          college: "St. Mary's College",
          course: 'BCA',
          year: '2nd Year',
          roomNumber: '201',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          name: 'Rohit Sharma',
          email: 'rohit.sharma.demo@gmail.com',
          password: 'Rohit@123',
          phone: '9876543215',
          parentName: 'Anand Sharma',
          parentPhone: '9876543205',
          aadhaar: '987654321006',
          college: 'Vardhaman College of Engineering',
          course: 'B.Tech Mechanical Engineering',
          year: '3rd Year',
          roomNumber: '202',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          name: 'Vishal Reddy',
          email: 'vishal.reddy.demo@gmail.com',
          password: 'Vishal@123',
          phone: '9876543216',
          parentName: 'Prabhakar Reddy',
          parentPhone: '9876543206',
          aadhaar: '987654321007',
          college: 'Malla Reddy University',
          course: 'B.Tech Data Science',
          year: '1st Year',
          roomNumber: '202',
          bedNum: 2,
          paymentStatus: 'paid'
        },
        {
          name: 'Naveen Kumar',
          email: 'naveen.kumar.demo@gmail.com',
          password: 'Naveen@123',
          phone: '9876543217',
          parentName: 'Bhaskar Kumar',
          parentPhone: '9876543207',
          aadhaar: '987654321008',
          college: 'CMR Institute of Technology',
          course: 'B.Tech Computer Science',
          year: '4th Year',
          roomNumber: '301',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          name: 'Abhishek Rao',
          email: 'abhishek.rao.demo@gmail.com',
          password: 'Abhishek@123',
          phone: '9876543218',
          parentName: 'Ramesh Rao',
          parentPhone: '9876543208',
          aadhaar: '987654321009',
          college: 'Aurora Deemed University',
          course: 'B.Tech Artificial Intelligence',
          year: '2nd Year',
          roomNumber: '301',
          bedNum: 2,
          paymentStatus: 'paid'
        },
        {
          name: 'Manish Yadav',
          email: 'manish.yadav.demo@gmail.com',
          password: 'Manish@123',
          phone: '9876543219',
          parentName: 'Satyanarayana Yadav',
          parentPhone: '9876543209',
          aadhaar: '987654321010',
          college: "St. Joseph's Degree College",
          course: 'BCA',
          year: '1st Year',
          roomNumber: '302',
          bedNum: 1,
          paymentStatus: 'paid'
        }
      ];

      for (const stud of mockStudents) {
        const hashedPassword = await bcrypt.hash(stud.password, 10);
        const userResult = await db.run(
          `INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)`,
          [stud.name, stud.email, stud.phone, hashedPassword, 'student']
        );
        const userId = userResult.lastID;
        const joinDate = new Date().toISOString().split('T')[0];

        // Query Room and Bed IDs
        const roomRecord = await db.get('SELECT id FROM rooms WHERE roomNumber = ?', [stud.roomNumber]);
        const roomId = roomRecord ? roomRecord.id : null;
        
        let bedId = null;
        if (roomId) {
          const bedRecord = await db.get('SELECT id FROM beds WHERE roomId = ? AND bedNumber = ?', [roomId, stud.bedNum]);
          bedId = bedRecord ? bedRecord.id : null;
        }

        // Insert Student
        const studentResult = await db.run(
          `INSERT INTO students (userId, studentName, phone, parentName, parentPhone, aadhaarNumber, collegeName, course, year, address, photo, idProof, joinDate, status, monthlyRent, depositAmount, roomId, bedId, paymentStatus) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        const studentId = studentResult.lastID;

        // Update Bed status
        if (bedId) {
          await db.run(
            `UPDATE beds SET status = 'occupied', userId = ? WHERE id = ?`,
            [userId, bedId]
          );
        }

        // Seed payment ledger entry for August 2026
        const paymentResult = await db.run(
          `INSERT INTO payments (studentId, billingMonth, amountDue, amountPaid, status) VALUES (?, ?, ?, ?, ?)`,
          [studentId, '2026-08', 8500, 8500, 'paid']
        );

        await db.run(
          `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) VALUES (?, ?, ?, ?, ?)`,
          [paymentResult.lastID, 8500, 'upi', `TXN${Math.floor(10000000 + Math.random() * 90000000)}`, 'Monthly Rent Paid']
        );
      }
      await db.run('COMMIT');
      console.log('Seeded mock students with room allocations.');
    } catch (err) {
      await db.run('ROLLBACK');
      console.error('Student Seeding Error:', err);
    }
  }

  // Seed default hostel settings if empty
  const settingsCount = await db.get('SELECT COUNT(*) as count FROM hostelSettings');
  if (settingsCount.count === 0) {
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
        await db.run('INSERT INTO hostelSettings (key, value) VALUES (?, ?)', [setting.key, setting.value]);
      }
      console.log('Seeded default hostel settings.');
    } catch (err) {
      console.error('Settings Seeding Error:', err);
    }
  }
}

module.exports = { getDb };
