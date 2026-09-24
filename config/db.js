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

  try { await db.query("ALTER TABLE rooms ADD COLUMN floor VARCHAR(255) NOT NULL DEFAULT 'Ground Floor'"); } catch (_) {}
  try { await db.query("ALTER TABLE rooms ADD COLUMN block VARCHAR(255) NOT NULL DEFAULT 'Block A'"); } catch (_) {}
  try { await db.query("ALTER TABLE rooms ADD COLUMN roomType VARCHAR(255) NOT NULL DEFAULT 'Triple Sharing'"); } catch (_) {}

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

  try { await db.query("ALTER TABLE beds ADD COLUMN bedLabel VARCHAR(255)"); } catch (_) {}

  // 4. Students Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      userId INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      studentCustomId VARCHAR(255) UNIQUE,
      studentName VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL,
      parentName VARCHAR(255) NOT NULL,
      parentPhone VARCHAR(255) NOT NULL,
      emergencyContact VARCHAR(255),
      aadhaarNumber VARCHAR(255) UNIQUE,
      dateOfBirth DATE,
      gender VARCHAR(255),
      collegeName VARCHAR(255) NOT NULL,
      course VARCHAR(255) NOT NULL,
      year VARCHAR(255) NOT NULL,
      address TEXT,
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

  try { await db.query("ALTER TABLE students ADD COLUMN studentCustomId VARCHAR(255) UNIQUE"); } catch (_) {}
  try { await db.query("ALTER TABLE students ADD COLUMN dateOfBirth DATE"); } catch (_) {}
  try { await db.query("ALTER TABLE students ADD COLUMN gender VARCHAR(255)"); } catch (_) {}
  try { await db.query("ALTER TABLE students ADD COLUMN emergencyContact VARCHAR(255)"); } catch (_) {}

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

  // 10. Hostel Settings Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS hostelSettings (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

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

  // Check if standard Block A rooms exist
  const { rows: existingRooms } = await db.query("SELECT COUNT(*) as count FROM rooms WHERE roomNumber LIKE 'A-%'");
  if (parseInt(existingRooms[0].count) === 0) {
    // Clear legacy unformatted rooms if any
    await db.query('DELETE FROM rooms WHERE roomNumber NOT LIKE \'A-%\'');

    await db.query('BEGIN');
    try {
      const mockRooms = [
        // Ground Floor
        { roomNumber: 'A-101', capacity: 3, monthlyFee: 8500, floor: 'Ground Floor', block: 'Block A', roomType: 'Triple Sharing' },
        { roomNumber: 'A-102', capacity: 3, monthlyFee: 8500, floor: 'Ground Floor', block: 'Block A', roomType: 'Triple Sharing' },
        { roomNumber: 'A-103', capacity: 4, monthlyFee: 7500, floor: 'Ground Floor', block: 'Block A', roomType: 'Four Sharing' },
        { roomNumber: 'A-104', capacity: 2, monthlyFee: 10000, floor: 'Ground Floor', block: 'Block A', roomType: 'Double Sharing' },
        // First Floor
        { roomNumber: 'A-201', capacity: 3, monthlyFee: 8500, floor: 'First Floor', block: 'Block A', roomType: 'Triple Sharing' },
        { roomNumber: 'A-202', capacity: 3, monthlyFee: 8500, floor: 'First Floor', block: 'Block A', roomType: 'Triple Sharing' },
        { roomNumber: 'A-203', capacity: 4, monthlyFee: 7500, floor: 'First Floor', block: 'Block A', roomType: 'Four Sharing' },
        { roomNumber: 'A-204', capacity: 2, monthlyFee: 10000, floor: 'First Floor', block: 'Block A', roomType: 'Double Sharing' },
        // Second Floor
        { roomNumber: 'A-301', capacity: 3, monthlyFee: 8500, floor: 'Second Floor', block: 'Block A', roomType: 'Triple Sharing' },
        { roomNumber: 'A-302', capacity: 3, monthlyFee: 8500, floor: 'Second Floor', block: 'Block A', roomType: 'Triple Sharing' },
        { roomNumber: 'A-303', capacity: 4, monthlyFee: 7500, floor: 'Second Floor', block: 'Block A', roomType: 'Four Sharing' },
        { roomNumber: 'A-304', capacity: 2, monthlyFee: 10000, floor: 'Second Floor', block: 'Block A', roomType: 'Double Sharing' }
      ];

      for (const room of mockRooms) {
        const { rows: roomResult } = await db.query(
          `INSERT INTO rooms (roomNumber, capacity, monthlyFee, floor, block, roomType, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [room.roomNumber, room.capacity, room.monthlyFee, room.floor, room.block, room.roomType, 'active']
        );
        const roomId = roomResult[0].id;

        for (let b = 1; b <= room.capacity; b++) {
          const bedLabel = `${room.roomNumber}-${b}`;
          await db.query(
            `INSERT INTO beds (roomId, bedNumber, bedLabel, status) VALUES ($1, $2, $3, $4)`,
            [roomId, b, bedLabel, 'vacant']
          );
        }
      }
      await db.query('COMMIT');
      console.log('Seeded Block A rooms and generated beds.');
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Room Seeding Error:', err);
    }
  }

  // Seed sample students if empty
  const { rows: existingStudents } = await db.query("SELECT COUNT(*) as count FROM students WHERE studentCustomId LIKE 'AKS%'");
  if (parseInt(existingStudents[0].count) === 0) {
    await db.query('BEGIN');
    try {
      const mockStudents = [
        {
          studentCustomId: 'AKS2026001',
          name: 'Rahul Varma',
          email: 'rahul.varma.demo@gmail.com',
          password: 'Rahul@123',
          phone: '9000000001',
          parentName: 'Srinivas Varma',
          parentPhone: '9000000010',
          emergencyContact: '9000000010',
          aadhaar: '900000000001',
          dateOfBirth: '2004-05-15',
          gender: 'Male',
          college: 'Aurora Deemed University',
          course: 'B.Tech Computer Science',
          year: '2nd Year',
          roomNumber: 'A-101',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          studentCustomId: 'AKS2026002',
          name: 'Karthik Reddy',
          email: 'karthik.reddy.demo@gmail.com',
          password: 'Karthik@123',
          phone: '9000000002',
          parentName: 'Ramana Reddy',
          parentPhone: '9000000020',
          emergencyContact: '9000000020',
          aadhaar: '900000000002',
          dateOfBirth: '2005-08-20',
          gender: 'Male',
          college: 'Aurora Deemed University',
          course: 'B.Tech Artificial Intelligence',
          year: '1st Year',
          roomNumber: 'A-101',
          bedNum: 2,
          paymentStatus: 'paid'
        },
        {
          studentCustomId: 'AKS2026003',
          name: 'Sai Teja',
          email: 'sai.teja.demo@gmail.com',
          password: 'Sai@123',
          phone: '9000000003',
          parentName: 'Venkatesh Rao',
          parentPhone: '9000000030',
          emergencyContact: '9000000030',
          aadhaar: '900000000003',
          dateOfBirth: '2003-11-10',
          gender: 'Male',
          college: 'CBR Engineering College',
          course: 'B.Tech Electronics & Comm',
          year: '3rd Year',
          roomNumber: 'A-102',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          studentCustomId: 'AKS2026004',
          name: 'Arjun Kumar',
          email: 'arjun.kumar.demo@gmail.com',
          password: 'Arjun@123',
          phone: '9000000004',
          parentName: 'Pratap Kumar',
          parentPhone: '9000000040',
          emergencyContact: '9000000040',
          aadhaar: '900000000004',
          dateOfBirth: '2004-02-28',
          gender: 'Male',
          college: 'Aurora Deemed University',
          course: 'B.Tech Information Tech',
          year: '2nd Year',
          roomNumber: 'A-102',
          bedNum: 2,
          paymentStatus: 'paid'
        },
        {
          studentCustomId: 'AKS2026005',
          name: 'Nikhil Reddy',
          email: 'nikhil.reddy.demo@gmail.com',
          password: 'Nikhil@123',
          phone: '9000000005',
          parentName: 'Rajasekhar Reddy',
          parentPhone: '9000000050',
          emergencyContact: '9000000050',
          aadhaar: '900000000005',
          dateOfBirth: '2005-01-12',
          gender: 'Male',
          college: 'VNR VJIET',
          course: 'B.Tech Civil Engineering',
          year: '1st Year',
          roomNumber: 'A-103',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          studentCustomId: 'AKS2026006',
          name: 'Rohit Varma',
          email: 'rohit.varma.demo@gmail.com',
          password: 'Rohit@123',
          phone: '9000000006',
          parentName: 'Bhaskar Varma',
          parentPhone: '9000000060',
          emergencyContact: '9000000060',
          aadhaar: '900000000006',
          dateOfBirth: '2003-07-04',
          gender: 'Male',
          college: 'Gokaraju Rangaraju',
          course: 'B.Tech Mechanical Eng',
          year: '3rd Year',
          roomNumber: 'A-201',
          bedNum: 1,
          paymentStatus: 'paid'
        },
        {
          studentCustomId: 'AKS2026007',
          name: 'Abhinav Rao',
          email: 'abhinav.rao.demo@gmail.com',
          password: 'Abhinav@123',
          phone: '9000000007',
          parentName: 'Madhusudan Rao',
          parentPhone: '9000000070',
          emergencyContact: '9000000070',
          aadhaar: '900000000007',
          dateOfBirth: '2002-09-19',
          gender: 'Male',
          college: 'Aurora Deemed University',
          course: 'B.Tech Computer Science',
          year: '4th Year',
          roomNumber: 'A-201',
          bedNum: 2,
          paymentStatus: 'paid'
        },
        {
          studentCustomId: 'AKS2026008',
          name: 'Vivek Krishna',
          email: 'vivek.krishna.demo@gmail.com',
          password: 'Vivek@123',
          phone: '9000000008',
          parentName: 'Murali Krishna',
          parentPhone: '9000000080',
          emergencyContact: '9000000080',
          aadhaar: '900000000008',
          dateOfBirth: '2004-12-01',
          gender: 'Male',
          college: 'Aurora Deemed University',
          course: 'B.Tech Data Science',
          year: '2nd Year',
          roomNumber: 'A-202',
          bedNum: 1,
          paymentStatus: 'paid'
        }
      ];

      for (const stud of mockStudents) {
        const hashedPassword = await bcrypt.hash(stud.password, 10);
        
        // Remove existing user with same email or phone if any
        const { rows: existingUsers } = await db.query('SELECT id FROM users WHERE email = $1 OR phone = $2', [stud.email, stud.phone]);
        if (existingUsers.length > 0) {
          for (const u of existingUsers) {
            await db.query('DELETE FROM students WHERE userId = $1', [u.id]);
            await db.query('DELETE FROM users WHERE id = $1', [u.id]);
          }
        }

        const { rows: userResult } = await db.query(
          `INSERT INTO users (name, email, phone, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [stud.name, stud.email, stud.phone, hashedPassword, 'student']
        );
        const userId = userResult[0].id;
        const joinDate = new Date().toISOString().split('T')[0];

        const { rows: roomRows } = await db.query('SELECT id, monthlyFee FROM rooms WHERE roomNumber = $1', [stud.roomNumber]);
        const roomId = roomRows.length > 0 ? roomRows[0].id : null;
        const monthlyRent = roomRows.length > 0 ? parseFloat(roomRows[0].monthlyFee) : 8500;
        
        let bedId = null;
        if (roomId) {
          const { rows: bedRows } = await db.query('SELECT id FROM beds WHERE roomId = $1 AND bedNumber = $2', [roomId, stud.bedNum]);
          bedId = bedRows.length > 0 ? bedRows[0].id : null;
        }

        const { rows: studentResult } = await db.query(
          `INSERT INTO students (
            userId, studentCustomId, studentName, phone, parentName, parentPhone, emergencyContact,
            aadhaarNumber, dateOfBirth, gender, collegeName, course, year, address, photo, idProof,
            joinDate, status, monthlyRent, depositAmount, roomId, bedId, paymentStatus
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) RETURNING id`,
          [
            userId,
            stud.studentCustomId,
            stud.name,
            stud.phone,
            stud.parentName,
            stud.parentPhone,
            stud.emergencyContact,
            stud.aadhaar,
            stud.dateOfBirth,
            stud.gender,
            stud.college,
            stud.course,
            stud.year,
            'Hyderabad, Telangana',
            '/assets/avatar-placeholder.png',
            '',
            joinDate,
            'active',
            monthlyRent,
            8500,
            roomId,
            bedId,
            stud.paymentStatus
          ]
        );
        const studentId = studentResult[0].id;

        if (bedId && roomId) {
          await db.query(
            `UPDATE beds SET status = 'occupied', userId = $1 WHERE id = $2`,
            [userId, bedId]
          );

          await db.query(
            `INSERT INTO allocations (studentId, roomId, bedId, status) VALUES ($1, $2, $3, $4)`,
            [studentId, roomId, bedId, 'active']
          );
        }

        const { rows: paymentResult } = await db.query(
          `INSERT INTO payments (studentId, billingMonth, amountDue, amountPaid, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [studentId, '2026-09', monthlyRent, monthlyRent, 'paid']
        );

        await db.query(
          `INSERT INTO paymentHistory (paymentId, amount, paymentMode, referenceNumber, notes) VALUES ($1, $2, $3, $4, $5)`,
          [paymentResult[0].id, monthlyRent, 'upi', `TXN${Math.floor(10000000 + Math.random() * 90000000)}`, 'Monthly Rent Paid']
        );
      }
      await db.query('COMMIT');
      console.log('Seeded 8 sample students with room allocations.');
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
