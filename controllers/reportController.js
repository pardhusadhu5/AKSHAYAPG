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
    if (!['student', 'room', 'occupancy', 'income', 'pending', 'monthly_rent_collection', 'rent_collection'].includes(type)) {
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
    } else if (type === 'monthly_rent_collection' || type === 'rent_collection') {
      csvContent = 'Invoice Number,Student ID,Student Name,Phone,Room Number,Billing Month,Cycle Type,Amount Due,Late Fee,Amount Paid,Pending Balance,Advance Paid,Status,Due Date,Paid Date\n';
      const { rows: rentRecords } = await db.query(`
        SELECT p.invoiceNumber, p.studentId, s.studentName, s.phone, r.roomNumber, p.billingMonth,
               p.billingCycleType, p.amountDue, p.lateFee, p.amountPaid, p.advancePaid,
               (p.amountDue + p.lateFee - p.amountPaid) as pendingBalance,
               p.status, p.dueDate, p.paidAt
        FROM payments p
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY p.billingMonth DESC, p.id DESC
      `);
      rentRecords.forEach(p => {
        const due = parseFloat(p.amountdue || p.amountDue || 0);
        const late = parseFloat(p.latefee || p.lateFee || 0);
        const paid = parseFloat(p.amountpaid || p.amountPaid || 0);
        const advance = parseFloat(p.advancepaid || p.advancePaid || 0);
        const bal = Math.max(0, (due + late) - paid);
        const dueStr = p.duedate || p.dueDate ? new Date(p.duedate || p.dueDate).toLocaleDateString('en-IN') : '';
        const paidStr = p.paidat || p.paidAt ? new Date(p.paidat || p.paidAt).toLocaleDateString('en-IN') : '';
        csvContent += `"${p.invoicenumber || p.invoiceNumber || ''}","${p.studentid || p.studentId}","${p.studentname || p.studentName}","${p.phone || ''}","Room ${p.roomnumber || p.roomNumber || 'Unassigned'}","${p.billingmonth || p.billingMonth}","${p.billingcycletype || p.billingCycleType || 'CALENDAR_MONTH'}","${due}","${late}","${paid}","${bal}","${advance}","${p.status}","${dueStr}","${paidStr}"\n`;
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
    if (!['student', 'room', 'occupancy', 'income', 'pending', 'monthly_rent_collection', 'rent_collection'].includes(type)) {
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
    const spreadsheetId = (process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '').trim();

    if (!spreadsheetId) {
      return res.status(400).json({
        success: false,
        message: `GOOGLE_SHEET_ID is not configured in Render environment variables. Please set GOOGLE_SHEET_ID to your existing Google Spreadsheet ID and ensure the sheet is shared with "${clientEmail}" as Editor.`
      });
    }

    // Worksheet tab mapping for each report type
    const tabNameMap = {
      student: 'Student Details',
      room: 'Rooms',
      occupancy: 'Beds Occupancy',
      income: 'Income & Payments',
      pending: 'Pending Fee Dues'
    };
    const tabTitle = tabNameMap[type] || 'Report Data';

    // Verify access to existing spreadsheet and check/create the target worksheet tab
    let targetSheetId = null;
    try {
      const getSheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      const sheetData = await getSheetRes.json().catch(() => ({}));

      if (!getSheetRes.ok) {
        if (getSheetRes.status === 403) {
          console.error('Google Sheets Access Forbidden:', sheetData.error?.message);
          return res.status(403).json({
            success: false,
            message: `Google Sheets Permission Error: Service account (${clientEmail}) does not have edit access to spreadsheet "${spreadsheetId}". Please open your Google Sheet, click Share, and invite ${clientEmail} as Editor.`
          });
        }
        if (getSheetRes.status === 404) {
          return res.status(404).json({
            success: false,
            message: `Google Sheets Not Found: Spreadsheet ID "${spreadsheetId}" was not found. Please verify the GOOGLE_SHEET_ID configured in Render.`
          });
        }
        const errMsg = sheetData.error?.message || `HTTP ${getSheetRes.status}`;
        console.error('Google Sheets Access Error:', errMsg);
        return res.status(getSheetRes.status >= 400 && getSheetRes.status < 500 ? getSheetRes.status : 502).json({
          success: false,
          message: `Failed to access Google Spreadsheet: ${errMsg}`
        });
      }

      // Check if the specific worksheet tab exists
      const existingSheets = sheetData.sheets || [];
      const matchingSheet = existingSheets.find(s => s.properties?.title === tabTitle);

      if (matchingSheet) {
        targetSheetId = matchingSheet.properties?.sheetId;
      } else {
        // Tab does not exist yet; create it via batchUpdate
        const addSheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: {
                    title: tabTitle
                  }
                }
              }
            ]
          })
        });

        const addSheetData = await addSheetRes.json().catch(() => ({}));
        if (!addSheetRes.ok) {
          const addErrMsg = addSheetData.error?.message || `HTTP ${addSheetRes.status}`;
          console.error(`Failed to create worksheet tab "${tabTitle}":`, addErrMsg);
          return res.status(502).json({
            success: false,
            message: `Failed to create worksheet tab "${tabTitle}": ${addErrMsg}`
          });
        }

        targetSheetId = addSheetData.replies?.[0]?.addSheet?.properties?.sheetId;
      }
    } catch (accessNetErr) {
      console.error('Google Sheets Access Error:', accessNetErr.message);
      return res.status(502).json({
        success: false,
        message: `Network error connecting to Google Sheets API: ${accessNetErr.message}`
      });
    }

    // Append Rows Data to the specific worksheet tab
    try {
      const range = `${encodeURIComponent(tabTitle)}!A1`;
      const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`, {
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
        console.error(`Google Sheets Append Error for tab "${tabTitle}":`, appendErrMsg);
        return res.status(appendRes.status >= 400 && appendRes.status < 500 ? appendRes.status : 502).json({
          success: false,
          message: `Failed to append data to tab "${tabTitle}": ${appendErrMsg}`
        });
      }
    } catch (appendNetErr) {
      console.error('Google Sheets Append Connection Error:', appendNetErr.message);
      return res.status(502).json({
        success: false,
        message: `Network error appending to Google Sheet: ${appendNetErr.message}`
      });
    }

    const tabParam = targetSheetId !== null && targetSheetId !== undefined ? `#gid=${targetSheetId}` : '';
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${tabParam}`;
    return res.status(200).json({
      success: true,
      googleSheetUrl: sheetUrl,
      message: `Report exported successfully to tab "${tabTitle}" in your Google Sheet.`
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
