const http = require('http');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runValidationTests() {
  console.log('=== STARTING VALIDATION TESTS ===\n');

  // 1. Test Admin Login
  console.log('1. Testing Admin Login...');
  const adminRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'joelramireddy@gmail.com', password: 'Akshaya@2026' });

  if (!adminRes.data.success || !adminRes.data.token) {
    throw new Error('Admin login failed: ' + JSON.stringify(adminRes.data));
  }
  const adminToken = adminRes.data.token;
  console.log('✓ Admin login successful.');

  // 2. Test Student Logins for all 10 students
  const studentCredentials = [
    { email: 'arjun.reddy.demo@gmail.com', pass: 'Arjun@123', phone: '9876543210', expectedRoom: '101', expectedFloor: 'First Floor' },
    { email: 'rahul.varma.demo@gmail.com', pass: 'Rahul@123', phone: '9876543211', expectedRoom: '101', expectedFloor: 'First Floor' },
    { email: 'karthik.naidu.demo@gmail.com', pass: 'Karthik@123', phone: '9876543212', expectedRoom: '102', expectedFloor: 'First Floor' },
    { email: 'sai.teja.demo@gmail.com', pass: 'Sai@123', phone: '9876543213', expectedRoom: '102', expectedFloor: 'First Floor' },
    { email: 'aditya.kumar.demo@gmail.com', pass: 'Aditya@123', phone: '9876543214', expectedRoom: '201', expectedFloor: 'Second Floor' },
    { email: 'rohit.sharma.demo@gmail.com', pass: 'Rohit@123', phone: '9876543215', expectedRoom: '202', expectedFloor: 'Second Floor' },
    { email: 'vishal.reddy.demo@gmail.com', pass: 'Vishal@123', phone: '9876543216', expectedRoom: '202', expectedFloor: 'Second Floor' },
    { email: 'naveen.kumar.demo@gmail.com', pass: 'Naveen@123', phone: '9876543217', expectedRoom: '301', expectedFloor: 'Third Floor' },
    { email: 'abhishek.rao.demo@gmail.com', pass: 'Abhishek@123', phone: '9876543218', expectedRoom: '301', expectedFloor: 'Third Floor' },
    { email: 'manish.yadav.demo@gmail.com', pass: 'Manish@123', phone: '9876543219', expectedRoom: '302', expectedFloor: 'Third Floor' }
  ];

  console.log('\n2. Testing Student Logins & Profile Data for all 10 demo users...');
  for (const stud of studentCredentials) {
    // Login with email
    const loginRes = await makeRequest({
      hostname: 'localhost',
      port: 8080,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: stud.email, password: stud.pass });

    if (!loginRes.data.success) {
      throw new Error(`Login failed for ${stud.email}: ${JSON.stringify(loginRes.data)}`);
    }

    // Login with phone
    const phoneLoginRes = await makeRequest({
      hostname: 'localhost',
      port: 8080,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { phone: stud.phone, password: stud.pass });

    if (!phoneLoginRes.data.success) {
      throw new Error(`Phone login failed for ${stud.phone}: ${JSON.stringify(phoneLoginRes.data)}`);
    }

    // Check profile
    const profileRes = await makeRequest({
      hostname: 'localhost',
      port: 8080,
      path: '/api/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${loginRes.data.token}` }
    });

    if (!profileRes.data.success || !profileRes.data.profile) {
      throw new Error(`Profile fetch failed for ${stud.email}`);
    }
    const prof = profileRes.data.profile;
    if (prof.roomNumber !== stud.expectedRoom) {
      throw new Error(`Room mismatch for ${stud.email}: expected ${stud.expectedRoom}, got ${prof.roomNumber}`);
    }
    if (prof.floor !== stud.expectedFloor) {
      throw new Error(`Floor mismatch for ${stud.email}: expected ${stud.expectedFloor}, got ${prof.floor}`);
    }
    console.log(`  ✓ Verified ${stud.email}: Room ${prof.roomNumber}, Floor ${prof.floor}, Bed ${prof.bedNumber}`);
  }

  // 3. Admin Search Tests
  console.log('\n3. Testing Admin Search functionality...');
  const searchQueries = ['Arjun', 'Reddy', '101', 'arjun.reddy.demo@gmail.com', '9876543210'];
  for (const q of searchQueries) {
    const searchRes = await makeRequest({
      hostname: 'localhost',
      port: 8080,
      path: `/api/admin/students?search=${encodeURIComponent(q)}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (!searchRes.data.success || searchRes.data.students.length === 0) {
      throw new Error(`Admin search failed for query "${q}": ${JSON.stringify(searchRes.data)}`);
    }
    console.log(`  ✓ Search "${q}" returned ${searchRes.data.students.length} record(s): ${searchRes.data.students.map(s => s.studentName).join(', ')}`);
  }

  // 4. Room Allocation & Edit Occupancy Test
  console.log('\n4. Testing Room Allocation & Occupancy updates...');

  // Get Room 101 details
  const roomsRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/rooms',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  const room101 = roomsRes.data.rooms.find(r => r.roomNumber === '101');
  const room203 = roomsRes.data.rooms.find(r => r.roomNumber === '203');
  console.log(`  Room 101 initial status: ${room101.occupiedBeds} occupied, ${room101.vacantBeds} vacant`);
  console.log(`  Room 203 initial status: ${room203.occupiedBeds} occupied, ${room203.vacantBeds} vacant`);

  // Get Arjun Reddy student record
  const arjunSearch = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/admin/students?search=Arjun',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const arjun = arjunSearch.data.students[0];

  // Get vacant bed in Room 203
  const vacant203Res = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: `/api/rooms/${room203.id}/vacant`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const newBed203 = vacant203Res.data.beds[0];

  console.log(`\n  Moving Arjun Reddy from Room 101 to Room 203 (Bed ${newBed203.bedNumber})...`);
  const transferRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/rooms/transfer',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
  }, {
    studentId: arjun.id,
    targetRoomId: room203.id,
    targetBedId: newBed203.id
  });

  if (!transferRes.data.success) {
    throw new Error('Room transfer failed: ' + JSON.stringify(transferRes.data));
  }
  console.log('  ✓ Transfer API call succeeded.');

  // Verify updated room occupancies
  const roomsRes2 = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/rooms',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const room101After = roomsRes2.data.rooms.find(r => r.roomNumber === '101');
  const room203After = roomsRes2.data.rooms.find(r => r.roomNumber === '203');
  console.log(`  Room 101 updated status: ${room101After.occupiedBeds} occupied, ${room101After.vacantBeds} vacant`);
  console.log(`  Room 203 updated status: ${room203After.occupiedBeds} occupied, ${room203After.vacantBeds} vacant`);

  if (room101After.occupiedBeds !== 1 || room203After.occupiedBeds !== 1) {
    throw new Error('Occupancy counts did not update correctly after transfer!');
  }
  console.log('  ✓ Room occupancies updated accurately.');

  // Move Arjun back to Room 101 Bed 1 for original demo configuration
  const vacant101Res = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: `/api/rooms/${room101.id}/vacant`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const bed101 = vacant101Res.data.beds[0];

  await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/rooms/transfer',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
  }, {
    studentId: arjun.id,
    targetRoomId: room101.id,
    targetBedId: bed101.id
  });
  console.log('  ✓ Restored Arjun Reddy to Room 101.');

  console.log('\n=== ALL VALIDATION TESTS PASSED 100% ===');
}

runValidationTests().catch(err => {
  console.error('\n❌ Validation Error:', err);
  process.exit(1);
});
