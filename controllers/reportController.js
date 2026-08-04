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
      const students = await db.all(
        `SELECT s.id, s.studentName, s.phone, u.email, s.aadhaarNumber, s.collegeName, s.course, s.year, s.joinDate, s.monthlyRent, s.depositAmount, s.status
         FROM students s
         JOIN users u ON s.userId = u.id
         ORDER BY s.id ASC`
      );
      students.forEach(s => {
        csvContent += `"${s.id}","${s.studentName}","${s.phone}","${s.email}","${s.aadhaarNumber}","${s.collegeName}","${s.course}","${s.year}","${s.joinDate}","${s.monthlyRent}","${s.depositAmount}","${s.status}"\n`;
      });

    } else if (type === 'room') {
      csvContent = 'Room ID,Room Number,Capacity,Occupied Beds,Monthly Fee,Floor,Status\n';
      const rooms = await db.all(
        `SELECT r.id, r.roomNumber, r.capacity, r.monthlyFee, r.floor, r.status,
           (SELECT COUNT(*) FROM beds b WHERE b.roomId = r.id AND b.status = 'occupied') as occupied
         FROM rooms r
         ORDER BY r.roomNumber ASC`
      );
      rooms.forEach(r => {
        csvContent += `"${r.id}","${r.roomNumber}","${r.capacity}","${r.occupied}","${r.monthlyFee}","${r.floor}","${r.status}"\n`;
      });

    } else if (type === 'occupancy') {
      csvContent = 'Room Number,Floor,Bed Number,Status,Occupant Name,Occupant Phone\n';
      const beds = await db.all(
        `SELECT b.bedNumber, b.status, r.roomNumber, r.floor, u.name as occupantName, u.phone
         FROM beds b
         JOIN rooms r ON b.roomId = r.id
         LEFT JOIN users u ON b.userId = u.id
         ORDER BY r.roomNumber ASC, b.bedNumber ASC`
      );
      beds.forEach(b => {
        csvContent += `"${b.roomNumber}","${b.floor}","${b.bedNumber}","${b.status}","${b.occupantName || 'N/A'}","${b.phone || 'N/A'}"\n`;
      });

    } else if (type === 'income') {
      csvContent = 'Payment Date,Student Name,Room,Amount Collected,Payment Mode,Reference Number,Notes\n';
      const history = await db.all(
        `SELECT h.paymentDate, h.amount, h.paymentMode, h.referenceNumber, h.notes, s.studentName, r.roomNumber
         FROM paymentHistory h
         JOIN payments p ON h.paymentId = p.id
         JOIN students s ON p.studentId = s.id
         LEFT JOIN rooms r ON s.roomId = r.id
         ORDER BY h.id DESC`
      );
      history.forEach(h => {
        csvContent += `"${h.paymentDate}","${h.studentName}","Room ${h.roomNumber || 'N/A'}","${h.amount}","${h.paymentMode}","${h.referenceNumber}","${h.notes || ''}"\n`;
      });

    } else if (type === 'pending') {
      csvContent = 'Billing Month,Student Name,Phone,Room,Amount Due,Amount Paid,Outstanding Dues,Status\n';
      const pending = await db.all(
        `SELECT p.billingMonth, p.amountDue, p.amountPaid, p.status, s.studentName, s.phone, r.roomNumber
         FROM payments p
         JOIN students s ON p.studentId = s.id
         LEFT JOIN rooms r ON s.roomId = r.id
         WHERE p.status != 'paid'
         ORDER BY p.billingMonth ASC, s.studentName ASC`
      );
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

module.exports = {
  downloadReport
};
