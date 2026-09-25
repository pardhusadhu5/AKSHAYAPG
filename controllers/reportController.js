const { getDb } = require('../config/db');

// Export SQL queries data to CSV spreadsheet downloads directly
async function downloadReport(req, res) {
  try {
    const { type } = req.query; // 'student', 'room', 'occupancy', 'income', 'pending'
    if (!['student', 'room', 'occupancy', 'income', 'pending'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid report type requested.' });
    }

    const db = await getDb();
    let csvContent = '';
    let filename = `${type}_report_${new Date().toISOString().split('T')[0]}.csv`;

    if (type === 'student') {
      csvContent = 'ID,Name,Phone,Email,Aadhaar,College,Course,Year,JoinDate,MonthlyRent,Deposit,Status\n';
      const students = (await (async () => { let args = [
        `SELECT s.id, s.studentName, s.phone, u.email, s.aadhaarNumber, s.collegeName, s.course, s.year, s.joinDate, s.monthlyRent, s.depositAmount, s.status
         FROM students s
         JOIN users u ON s.userId = u.id
         ORDER BY s.id ASC`
      ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
      students.forEach(s => {
        csvContent += `"${s.id}","${s.studentName}","${s.phone}","${s.email}","${s.aadhaarNumber}","${s.collegeName}","${s.course}","${s.year}","${s.joinDate}","${s.monthlyRent}","${s.depositAmount}","${s.status}"\n`;
      });

    } else if (type === 'room') {
      csvContent = 'Room ID,Room Number,Capacity,Occupied Beds,Monthly Fee,Floor,Status\n';
      const rooms = (await (async () => { let args = [
        `SELECT r.id, r.roomNumber, r.capacity, r.monthlyFee, r.floor, r.status,
           (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupied
         FROM rooms r
         ORDER BY r.roomNumber ASC`
      ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
      rooms.forEach(r => {
        csvContent += `"${r.id}","${r.roomNumber}","${r.capacity}","${r.occupied}","${r.monthlyFee}","${r.floor}","${r.status}"\n`;
      });

    } else if (type === 'occupancy') {
      csvContent = 'Room Number,Floor,Bed Number,Status,Occupant Name,Occupant Phone\n';
      const beds = (await (async () => { let args = [
        `SELECT b.bedNumber, b.status, r.roomNumber, r.floor, u.name as occupantName, u.phone
         FROM beds b
         JOIN rooms r ON b.roomId = r.id
         LEFT JOIN users u ON b.userId = u.id
         ORDER BY r.roomNumber ASC, b.bedNumber ASC`
      ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
      beds.forEach(b => {
        csvContent += `"${b.roomNumber}","${b.floor}","${b.bedNumber}","${b.status}","${b.occupantName || 'N/A'}","${b.phone || 'N/A'}"\n`;
      });

    } else if (type === 'income') {
      csvContent = 'Payment Date,Student Name,Room,Amount Collected,Payment Mode,Reference Number,Notes\n';
      const history = (await (async () => { let args = [
        `SELECT h.paymentDate, h.amount, h.paymentMode, h.referenceNumber, h.notes, s.studentName, r.roomNumber
         FROM paymentHistory h
         JOIN payments p ON h.paymentId = p.id
         JOIN students s ON p.studentId = s.id
         LEFT JOIN rooms r ON s.roomId = r.id
         ORDER BY h.id DESC`
      ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
      history.forEach(h => {
        csvContent += `"${h.paymentDate}","${h.studentName}","Room ${h.roomNumber || 'N/A'}","${h.amount}","${h.paymentMode}","${h.referenceNumber}","${h.notes || ''}"\n`;
      });

    } else if (type === 'pending') {
      csvContent = 'Billing Month,Student Name,Phone,Room,Amount Due,Amount Paid,Outstanding Dues,Status\n';
      const pending = (await (async () => { let args = [
        `SELECT p.billingMonth, p.amountDue, p.amountPaid, p.status, s.studentName, s.phone, r.roomNumber
         FROM payments p
         JOIN students s ON p.studentId = s.id
         LEFT JOIN rooms r ON s.roomId = r.id
         WHERE p.status != 'paid'
         ORDER BY p.billingMonth ASC, s.studentName ASC`
      ]; const { rows } = await db.query(args[0], args.slice(1).length ? args.slice(1)[0] : []); return rows; })());
      pending.forEach(p => {
        const outstanding = p.amountDue - p.amountPaid;
        csvContent += `"${p.billingMonth}","${p.studentName}","${p.phone}","Room ${p.roomNumber || 'N/A'}","${p.amountDue}","${p.amountPaid}","${outstanding}","${p.status}"\n`;
      });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error('Download Report Error:', err);
    res.status(500).json({ success: false, message: `Failed to compile report: ${err.message}` });
  }
}

// Generate Google Sheet for report data
async function exportGoogleSheet(req, res) {
  try {
    const { type } = req.query; // 'student', 'room', 'occupancy', 'income', 'pending'
    if (!['student', 'room', 'occupancy', 'income', 'pending'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid report type requested.' });
    }

    const db = await getDb();
    const currentDateStr = new Date().toISOString().split('T')[0];
    let sheetTitle = `Akshaya Deluxe - ${type.charAt(0).toUpperCase() + type.slice(1)} Report - ${currentDateStr}`;
    let headers = [];
    let rowsData = [];

    if (type === 'student') {
      headers = ['ID', 'Name', 'Phone', 'Email', 'Aadhaar', 'College', 'Course', 'Year', 'Join Date', 'Monthly Rent', 'Deposit', 'Status'];
      const students = (await db.query(`
        SELECT s.id, s.studentName, s.phone, u.email, s.aadhaarNumber, s.collegeName, s.course, s.year, s.joinDate, s.monthlyRent, s.depositAmount, s.status
        FROM students s
        JOIN users u ON s.userId = u.id
        ORDER BY s.id ASC
      `)).rows;
      rowsData = students.map(s => [s.id, s.studentName, s.phone, s.email, s.aadhaarNumber || '', s.collegeName || '', s.course || '', s.year || '', s.joinDate || '', s.monthlyRent, s.depositAmount, s.status]);

    } else if (type === 'room') {
      headers = ['Room ID', 'Room Number', 'Capacity', 'Occupied Beds', 'Monthly Fee', 'Floor', 'Status'];
      const rooms = (await db.query(`
        SELECT r.id, r.roomNumber, r.capacity, r.monthlyFee, r.floor, r.status,
           (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupied
        FROM rooms r
        ORDER BY r.roomNumber ASC
      `)).rows;
      rowsData = rooms.map(r => [r.id, r.roomNumber, r.capacity, r.occupied, r.monthlyFee, r.floor, r.status]);

    } else if (type === 'occupancy') {
      headers = ['Room Number', 'Floor', 'Bed Number', 'Status', 'Occupant Name', 'Occupant Phone'];
      const beds = (await db.query(`
        SELECT b.bedNumber, b.status, r.roomNumber, r.floor, u.name as occupantName, u.phone
        FROM beds b
        JOIN rooms r ON b.roomId = r.id
        LEFT JOIN users u ON b.userId = u.id
        ORDER BY r.roomNumber ASC, b.bedNumber ASC
      `)).rows;
      rowsData = beds.map(b => [b.roomNumber, b.floor, b.bedNumber, b.status, b.occupantName || 'N/A', b.phone || 'N/A']);

    } else if (type === 'income') {
      headers = ['Payment Date', 'Student Name', 'Room', 'Amount Collected', 'Payment Mode', 'Reference Number', 'Notes'];
      const history = (await db.query(`
        SELECT h.paymentDate, h.amount, h.paymentMode, h.referenceNumber, h.notes, s.studentName, r.roomNumber
        FROM paymentHistory h
        JOIN payments p ON h.paymentId = p.id
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY h.id DESC
      `)).rows;
      rowsData = history.map(h => [h.paymentDate, h.studentName, `Room ${h.roomNumber || 'N/A'}`, h.amount, h.paymentMode, h.referenceNumber || '', h.notes || '']);

    } else if (type === 'pending') {
      headers = ['Billing Month', 'Student Name', 'Phone', 'Room', 'Amount Due', 'Amount Paid', 'Outstanding Dues', 'Status'];
      const pending = (await db.query(`
        SELECT p.billingMonth, p.amountDue, p.amountPaid, p.status, s.studentName, s.phone, r.roomNumber
        FROM payments p
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        WHERE p.status != 'paid'
        ORDER BY p.billingMonth ASC, s.studentName ASC
      `)).rows;
      rowsData = pending.map(p => [p.billingMonth, p.studentName, p.phone, `Room ${p.roomNumber || 'N/A'}`, p.amountDue, p.amountPaid, p.amountDue - p.amountPaid, p.status]);
    }

    // Check webhook URL configuration first
    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: sheetTitle, headers, rows: rowsData })
        });
        const resData = await response.json();
        if (resData.url || resData.googleSheetUrl) {
          return res.status(200).json({
            success: true,
            googleSheetUrl: resData.url || resData.googleSheetUrl,
            message: 'Google Sheet created successfully.'
          });
        }
      } catch (wErr) {
        console.error('Webhook Sheet Error:', wErr);
      }
    }

    // Check Google Service Account configuration
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (clientEmail && privateKey) {
      try {
        const tokenUrl = 'https://oauth2.googleapis.com/token';
        const jwtHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const jwtClaim = Buffer.from(JSON.stringify({
          iss: clientEmail,
          scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
          aud: tokenUrl,
          exp: now + 3600,
          iat: now
        })).toString('base64url');

        const crypto = require('crypto');
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(`${jwtHeader}.${jwtClaim}`);
        const signature = sign.sign(privateKey.replace(/\\n/g, '\n'), 'base64url');
        const jwt = `${jwtHeader}.${jwtClaim}.${signature}`;

        const tokenRes = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
        });
        const tokenData = await tokenRes.json();

        if (tokenData.access_token) {
          const createSheetRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              properties: { title: sheetTitle },
              sheets: [{ properties: { title: 'Report Data' } }]
            })
          });
          const sheetObj = await createSheetRes.json();
          if (sheetObj.spreadsheetId) {
            const spreadsheetId = sheetObj.spreadsheetId;
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                values: [headers, ...rowsData]
              })
            });

            await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ role: 'reader', type: 'anyone' })
            }).catch(() => {});

            const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
            return res.status(200).json({
              success: true,
              googleSheetUrl: sheetUrl,
              message: 'Google Sheet created successfully.'
            });
          }
        }
      } catch (gErr) {
        console.error('Google API Error:', gErr);
      }
    }

    return res.status(400).json({
      success: false,
      configured: false,
      message: 'Google Sheets credentials are not configured in environment variables. Please set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY (or GOOGLE_SHEETS_WEBHOOK_URL) in .env.'
    });

  } catch (err) {
    console.error('Google Sheet Export Error:', err);
    res.status(500).json({ success: false, message: `Failed to generate Google Sheet: ${err.message}` });
  }
}

module.exports = {
  downloadReport,
  exportGoogleSheet
};
