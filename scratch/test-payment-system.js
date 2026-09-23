const http = require('http');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const isJson = res.headers['content-type'] && res.headers['content-type'].includes('application/json');
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: isJson ? JSON.parse(body) : body });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: body });
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

async function runPaymentSystemTests() {
  console.log('=== STARTING ONLINE PAYMENT SYSTEM VALIDATION TESTS ===\n');

  // 1. Admin Login
  console.log('1. Logging in as Admin...');
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
  console.log('  ✓ Admin logged in successfully.');

  // 2. Student Login (Arjun Reddy)
  console.log('\n2. Logging in as Student (Arjun Reddy)...');
  const studentRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'arjun.reddy.demo@gmail.com', password: 'Arjun@123' });

  if (!studentRes.data.success || !studentRes.data.token) {
    throw new Error('Student login failed: ' + JSON.stringify(studentRes.data));
  }
  const studentToken = studentRes.data.token;
  console.log('  ✓ Student logged in successfully.');

  // 3. Fetch Student Fees
  console.log('\n3. Fetching Student Fees Dashboard data...');
  const feesRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/payments/student/fees',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });

  if (!feesRes.data.success) {
    throw new Error('Fetch student fees failed: ' + JSON.stringify(feesRes.data));
  }
  const { currentFee, studentInfo } = feesRes.data;
  console.log(`  ✓ Student: ${studentInfo.name} (${studentInfo.email}), Room: ${studentInfo.roomNumber}, Bed: ${studentInfo.bedNumber}`);
  console.log(`  ✓ Current Fee: ${currentFee.billingMonth}, Amount: ₹${currentFee.amountDue}, Status: ${currentFee.status}`);

  // Ensure an unpaid fee invoice exists for testing
  let testFeeId = (currentFee.status !== 'paid') ? currentFee.id : null;

  if (!testFeeId) {
    const testMonth = `2026-${String(new Date().getMonth() + 2).padStart(2, '0')}`;
    console.log(`  Generating unpaid invoice for ${testMonth} for testing...`);
    
    await makeRequest({
      hostname: 'localhost',
      port: 8080,
      path: '/api/payments/admin/generate-monthly',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
    }, { billingMonth: testMonth });

    const refetchRes = await makeRequest({
      hostname: 'localhost',
      port: 8080,
      path: '/api/payments/student/fees',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });

    const unpaidFee = refetchRes.data.history.find(h => h.status !== 'paid');
    testFeeId = unpaidFee ? unpaidFee.id : refetchRes.data.history[0].id;
  }

  // 4. Create Payment Order
  console.log('\n4. Creating Razorpay Payment Order for Fee ID:', testFeeId);
  const orderRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/payments/create-order',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, { feeId: testFeeId });

  if (!orderRes.data.success || !orderRes.data.orderId) {
    throw new Error('Create payment order failed: ' + JSON.stringify(orderRes.data));
  }
  const orderData = orderRes.data;
  console.log(`  ✓ Order Created! Order ID: ${orderData.orderId}, Amount: ₹${orderData.amountRupees} (Key: ${orderData.keyId})`);

  // 5. Verify Payment Signature & Settle Invoice
  console.log('\n5. Verifying Payment with Backend...');
  const paymentId = `pay_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const crypto = require('crypto');
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test-secret').update(`${orderData.orderId}|${paymentId}`).digest('hex');
  const verifyRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/payments/verify',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, {
    feeId: testFeeId,
    razorpay_order_id: orderData.orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature
  });

  if (!verifyRes.data.success) {
    throw new Error('Payment verification failed: ' + JSON.stringify(verifyRes.data));
  }
  const verifyData = verifyRes.data;
  console.log(`  ✓ Payment Verified Successfully!`);
  console.log(`    Receipt Number: ${verifyData.receiptNumber}`);
  console.log(`    Payment ID: ${verifyData.transactionId}`);

  // 6. Test Duplicate Payment Protection
  console.log('\n6. Testing Duplicate Payment Protection...');
  const duplicateRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/payments/create-order',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, { feeId: testFeeId });

  if (duplicateRes.data.success) {
    throw new Error('Security vulnerability: System allowed creating order for already-paid fee!');
  }
  console.log(`  ✓ Duplicate payment correctly blocked: "${duplicateRes.data.message}"`);

  // 7. Test PDF Receipt Generation & Download Endpoint
  console.log('\n7. Testing PDF Receipt Generation Endpoint...');
  const pdfRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: `/api/payments/receipt/${verifyData.receiptNumber}/pdf?token=${studentToken}`,
    method: 'GET'
  });

  if (pdfRes.status !== 200 || !pdfRes.headers['content-type'] || !pdfRes.headers['content-type'].includes('application/pdf')) {
    throw new Error(`PDF generation failed: Status ${pdfRes.status}, Content-Type: ${pdfRes.headers['content-type']}`);
  }
  console.log(`  ✓ PDF Receipt generated cleanly! Size: ${pdfRes.data.length} bytes, Format: PDF`);

  // 8. Test Admin Payment Collection Dashboard
  console.log('\n8. Testing Admin Payment Management & Stats...');
  const statsRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/payments/admin/stats',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  const allPaymentsRes = await makeRequest({
    hostname: 'localhost',
    port: 8080,
    path: '/api/payments/admin/all',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  if (!statsRes.data.success || !allPaymentsRes.data.success) {
    throw new Error('Admin payment collection query failed.');
  }

  console.log(`  ✓ Admin Stats: Total Collected = ₹${statsRes.data.stats.totalCollected}, This Month = ₹${statsRes.data.stats.thisMonth}`);
  console.log(`  ✓ Admin Payments Ledger returned ${allPaymentsRes.data.payments.length} record(s).`);

  console.log('\n=== ALL ONLINE PAYMENT SYSTEM TESTS PASSED 100% ===');
}

runPaymentSystemTests().catch(err => {
  console.error('\n❌ Payment Validation Error:', err);
  process.exit(1);
});
