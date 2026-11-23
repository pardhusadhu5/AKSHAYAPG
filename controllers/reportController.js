const { getDb } = require('../config/db');
const crypto = require('crypto');

/**
 * Safely normalizes Google service account private keys from environment variables.
 * Handles wrapping quotes, Windows \r\n line endings, literal \n escapes, and trims whitespace.
 */
function normalizePrivateKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;

  let key = rawKey.trim();

  // Strip accidental outer single or double quotes
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }

  // Normalize line endings
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Convert literal escaped \n strings to real newlines
  key = key.replace(/\\n/g, '\n');

  // Validate PEM header and footer
  const hasBegin = key.includes('-----BEGIN PRIVATE KEY-----') || key.includes('-----BEGIN RSA PRIVATE KEY-----');
  const hasEnd = key.includes('-----END PRIVATE KEY-----') || key.includes('-----END RSA PRIVATE KEY-----');

  if (!hasBegin || !hasEnd) {
    return null;
  }

  return key;
}

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
    const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!clientEmail || !rawPrivateKey) {
      return res.status(400).json({
        success: false,
        configured: false,
        message: 'Google Sheets credentials are not configured in environment variables. Please set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY (or GOOGLE_SHEETS_WEBHOOK_URL) in .env.'
      });
    }

    const privateKey = normalizePrivateKey(rawPrivateKey);
    if (!privateKey) {
      return res.status(400).json({
        success: false,
        message: 'Invalid GOOGLE_PRIVATE_KEY format. The key must be a valid PEM formatted string starting with -----BEGIN PRIVATE KEY----- and ending with -----END PRIVATE KEY-----.'
      });
    }

    // Generate OAuth2 JWT & Token
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

    let jwt;
    try {
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(`${jwtHeader}.${jwtClaim}`);
      const signature = sign.sign(privateKey, 'base64url');
      jwt = `${jwtHeader}.${jwtClaim}.${signature}`;
    } catch (signErr) {
      console.error('Google Service Account Signing Error:', signErr.message);
      return res.status(400).json({
        success: false,
        message: `Google Service Account signing failed: ${signErr.message}. Ensure the private key is valid and uncorrupted.`
      });
    }

    let tokenData;
    try {
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
      });
      tokenData = await tokenRes.json().catch(() => ({}));

      if (!tokenRes.ok || !tokenData.access_token) {
        const oauthErr = tokenData.error_description || tokenData.error || `HTTP ${tokenRes.status}`;
        console.error('Google OAuth Authentication Error:', oauthErr);
        return res.status(401).json({
          success: false,
          message: `Google OAuth authentication failed: ${oauthErr}. Please verify your GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in Render.`
        });
      }
    } catch (tokenNetErr) {
      console.error('Google OAuth Connection Error:', tokenNetErr.message);
      return res.status(502).json({
        success: false,
        message: `Failed to connect to Google OAuth server: ${tokenNetErr.message}`
      });
    }

    const accessToken = tokenData.access_token;
    let spreadsheetId = process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID;

    // Create a new Google Sheet if no existing Sheet ID is configured
    if (!spreadsheetId) {
      try {
        const createSheetRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            properties: { title: sheetTitle },
            sheets: [{ properties: { title: 'Report Data' } }]
          })
        });

        const sheetObj = await createSheetRes.json().catch(() => ({}));
        if (!createSheetRes.ok || !sheetObj.spreadsheetId) {
          const createErrMsg = sheetObj.error?.message || `HTTP ${createSheetRes.status}`;
          console.error('Google Sheets Creation Error:', createErrMsg);
          return res.status(createSheetRes.status >= 400 && createSheetRes.status < 500 ? createSheetRes.status : 502).json({
            success: false,
            message: `Google Sheets creation failed: ${createErrMsg}`
          });
        }
        spreadsheetId = sheetObj.spreadsheetId;
      } catch (createNetErr) {
        console.error('Google Sheets Create Connection Error:', createNetErr.message);
        return res.status(502).json({
          success: false,
          message: `Failed to connect to Google Sheets API: ${createNetErr.message}`
        });
      }
    }

    // Append Rows Data to Spreadsheet
    try {
      const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [headers, ...rowsData]
        })
      });

      const appendObj = await appendRes.json().catch(() => ({}));
      if (!appendRes.ok) {
        const appendErrMsg = appendObj.error?.message || `HTTP ${appendRes.status}`;
        console.error('Google Sheets Append Error:', appendErrMsg);
        return res.status(appendRes.status >= 400 && appendRes.status < 500 ? appendRes.status : 502).json({
          success: false,
          message: `Google Sheets data append failed: ${appendErrMsg}`
        });
      }
    } catch (appendNetErr) {
      console.error('Google Sheets Append Connection Error:', appendNetErr.message);
      return res.status(502).json({
        success: false,
        message: `Failed to append data to Google Sheet: ${appendNetErr.message}`
      });
    }

    // Set public read permissions on newly created sheet (if permitted by domain)
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
      });
    } catch (permErr) {
      console.warn('Google Drive permission warning:', permErr.message);
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    return res.status(200).json({
      success: true,
      googleSheetUrl: sheetUrl,
      message: 'Google Sheet created successfully.'
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
