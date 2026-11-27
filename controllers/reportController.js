const { getDb } = require('../config/db');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

/**
 * Safely normalizes Google service account private keys from environment variables.
 */
function normalizePrivateKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;

  let key = rawKey.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  key = key.replace(/\\n/g, '\n');

  const hasBegin = key.includes('-----BEGIN PRIVATE KEY-----') || key.includes('-----BEGIN RSA PRIVATE KEY-----');
  const hasEnd = key.includes('-----END PRIVATE KEY-----') || key.includes('-----END RSA PRIVATE KEY-----');

  if (!hasBegin || !hasEnd) return null;
  return key;
}

/**
 * Normalize report type alias to canonical name
 */
function getCanonicalReportType(type) {
  const t = (type || 'students_admissions').toLowerCase().trim();
  if (['student', 'students', 'admissions', 'students_admissions'].includes(t)) return 'students_admissions';
  if (['room', 'rooms', 'occupancy', 'room_occupancy'].includes(t)) return 'room_occupancy';
  if (['rent_collection', 'monthly_rent_collection', 'rent', 'collection'].includes(t)) return 'rent_collection';
  if (['pending_dues', 'pending', 'dues', 'overdue'].includes(t)) return 'pending_dues';
  if (['security_deposits', 'deposits', 'deposit'].includes(t)) return 'security_deposits';
  if (['income_expenses', 'income_expense', 'income', 'expenses', 'financials'].includes(t)) return 'income_expenses';
  if (['checkin_checkout', 'checkins_checkouts', 'stay_history', 'checkouts', 'stays'].includes(t)) return 'checkin_checkout';
  if (['complaints_maintenance', 'complaints', 'maintenance'].includes(t)) return 'complaints_maintenance';
  if (['visitors', 'visitor', 'visitor_logs', 'gate_pass'].includes(t)) return 'visitors';
  return 'students_admissions';
}

/**
 * Helper to build Date / Month SQL conditions safely
 */
function buildDateFilter(columnName, startDate, endDate, month, params) {
  let clause = '';
  if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
    params.push(`${month.trim()}%`);
    clause = ` AND TO_CHAR(${columnName}, 'YYYY-MM') LIKE $${params.length}`;
  } else {
    if (startDate) {
      params.push(startDate);
      clause += ` AND ${columnName} >= $${params.length}::timestamp`;
    }
    if (endDate) {
      params.push(`${endDate} 23:59:59`);
      clause += ` AND ${columnName} <= $${params.length}::timestamp`;
    }
  }
  return clause;
}

/**
 * GET /api/reports/analytics
 * Returns comprehensive aggregated statistics, chart breakdowns, and itemized records for any of the 9 report types.
 */
async function getReportAnalytics(req, res) {
  try {
    const canonicalType = getCanonicalReportType(req.query.type);
    const { startDate, endDate, month, search } = req.query;
    const db = await getDb();

    let kpis = {};
    let breakdown = {};
    let records = [];

    if (canonicalType === 'students_admissions') {
      const params = [];
      let dateFilter = '';
      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        params.push(`${month.trim()}%`);
        dateFilter = ` AND TO_CHAR(COALESCE(s.joinDate::timestamp, s.createdAt), 'YYYY-MM') LIKE $${params.length}`;
      } else {
        if (startDate) {
          params.push(startDate);
          dateFilter += ` AND COALESCE(s.joinDate::timestamp, s.createdAt) >= $${params.length}::timestamp`;
        }
        if (endDate) {
          params.push(`${endDate} 23:59:59`);
          dateFilter += ` AND COALESCE(s.joinDate::timestamp, s.createdAt) <= $${params.length}::timestamp`;
        }
      }

      const q = `
        SELECT s.id, s.studentName, s.phone, u.email, s.aadhaarNumber, s.collegeName, s.course, s.year,
               s.joinDate, s.monthlyRent, s.depositAmount, s.status, s.createdAt,
               r.roomNumber, b.bedLabel
        FROM students s
        LEFT JOIN users u ON s.userId = u.id
        LEFT JOIN rooms r ON s.roomId = r.id
        LEFT JOIN beds b ON s.bedId = b.id
        WHERE 1=1 ${dateFilter}
        ORDER BY s.id DESC
      `;
      const { rows } = await db.query(q, params);
      records = rows;

      const totalStudents = records.length;
      const activeCount = records.filter(r => r.status === 'active').length;
      const pendingCount = records.filter(r => ['pending', 'submitted', 'under_review'].includes(r.status)).length;
      const vacatedCount = records.filter(r => ['vacated', 'inactive', 'left'].includes(r.status)).length;
      const totalPotentialRent = records.filter(r => r.status === 'active')
        .reduce((sum, r) => sum + parseFloat(r.monthlyrent || r.monthlyRent || 0), 0);

      kpis = {
        totalStudents,
        activeStudents: activeCount,
        pendingAdmissions: pendingCount,
        vacatedStudents: vacatedCount,
        monthlyRentPotential: Math.round(totalPotentialRent)
      };

      // Breakdown by status
      const statusMap = {};
      const collegeMap = {};
      records.forEach(r => {
        const st = String(r.status || 'unknown').toUpperCase();
        statusMap[st] = (statusMap[st] || 0) + 1;

        const col = String(r.collegename || r.collegeName || 'Other / Not Specified').trim();
        collegeMap[col] = (collegeMap[col] || 0) + 1;
      });

      breakdown = {
        byStatus: statusMap,
        byCollege: collegeMap
      };

    } else if (canonicalType === 'room_occupancy') {
      const { rows: roomRows } = await db.query(`
        SELECT r.id, r.roomNumber, r.capacity, r.monthlyFee, r.floor, r.block, r.roomType, r.status,
               COUNT(b.id) as totalBeds,
               COUNT(CASE WHEN b.status = 'occupied' THEN 1 END) as occupiedBeds,
               COUNT(CASE WHEN b.status = 'vacant' THEN 1 END) as vacantBeds,
               COUNT(CASE WHEN b.status = 'reserved' THEN 1 END) as reservedBeds,
               COUNT(CASE WHEN b.status = 'maintenance' THEN 1 END) as maintenanceBeds
        FROM rooms r
        LEFT JOIN beds b ON r.id = b.roomId
        GROUP BY r.id, r.roomNumber, r.capacity, r.monthlyFee, r.floor, r.block, r.roomType, r.status
        ORDER BY r.roomNumber ASC
      `);
      records = roomRows;

      const totalRooms = records.length;
      let totalCapacity = 0;
      let totalOccupied = 0;
      let totalVacant = 0;
      let totalReserved = 0;
      let totalMaintenance = 0;

      const floorMap = {};
      const typeMap = {};

      records.forEach(r => {
        const cap = parseInt(r.capacity || r.totalbeds || 0);
        const occ = parseInt(r.occupiedbeds || 0);
        const vac = parseInt(r.vacantbeds || 0);
        const resv = parseInt(r.reservedbeds || 0);
        const maint = parseInt(r.maintenancebeds || 0);

        totalCapacity += cap;
        totalOccupied += occ;
        totalVacant += vac;
        totalReserved += resv;
        totalMaintenance += maint;

        const fl = r.floor || 'Floor 1';
        if (!floorMap[fl]) floorMap[fl] = { capacity: 0, occupied: 0, vacant: 0 };
        floorMap[fl].capacity += cap;
        floorMap[fl].occupied += occ;
        floorMap[fl].vacant += vac;

        const rt = r.roomtype || `${cap} Sharing`;
        typeMap[rt] = (typeMap[rt] || 0) + 1;
      });

      const occupancyRate = totalCapacity > 0 ? ((totalOccupied / totalCapacity) * 100).toFixed(1) : 0;

      kpis = {
        totalRooms,
        totalCapacity,
        occupiedBeds: totalOccupied,
        vacantBeds: totalVacant,
        reservedBeds: totalReserved,
        maintenanceBeds: totalMaintenance,
        occupancyRate: `${occupancyRate}%`
      };

      breakdown = {
        byFloor: floorMap,
        byType: typeMap
      };

    } else if (canonicalType === 'rent_collection') {
      const params = [];
      let whereClause = 'WHERE 1=1';
      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        params.push(month.trim());
        whereClause += ` AND p.billingMonth = $${params.length}`;
      } else {
        if (startDate) {
          params.push(startDate);
          whereClause += ` AND p.createdAt >= $${params.length}::timestamp`;
        }
        if (endDate) {
          params.push(`${endDate} 23:59:59`);
          whereClause += ` AND p.createdAt <= $${params.length}::timestamp`;
        }
      }

      const q = `
        SELECT p.id, p.invoiceNumber, p.studentId, s.studentName, s.phone, r.roomNumber,
               p.billingMonth, p.billingCycleType, p.amountDue, p.lateFee, p.amountPaid, p.advancePaid,
               (p.amountDue + p.lateFee - p.amountPaid) as pendingBalance,
               p.status, p.paymentMode, p.dueDate, p.paidAt, p.createdAt
        FROM payments p
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        ${whereClause}
        ORDER BY p.billingMonth DESC, p.id DESC
      `;
      const { rows } = await db.query(q, params);
      records = rows;

      let totalBilled = 0;
      let totalCollected = 0;
      let totalLateFees = 0;
      let totalPending = 0;

      const modeMap = { UPI: 0, Cash: 0, Online: 0, BankTransfer: 0, Other: 0 };
      const statusMap = { paid: 0, partially_paid: 0, pending: 0, overdue: 0 };

      records.forEach(p => {
        const due = parseFloat(p.amountdue || p.amountDue || 0);
        const late = parseFloat(p.latefee || p.lateFee || 0);
        const paid = parseFloat(p.amountpaid || p.amountPaid || 0);
        const bal = Math.max(0, (due + late) - paid);

        totalBilled += (due + late);
        totalCollected += paid;
        totalLateFees += late;
        totalPending += bal;

        const st = String(p.status || 'pending').toLowerCase();
        statusMap[st] = (statusMap[st] || 0) + 1;

        const pm = String(p.paymentmode || p.paymentMode || '').toUpperCase();
        if (pm.includes('UPI')) modeMap.UPI += paid;
        else if (pm.includes('CASH')) modeMap.Cash += paid;
        else if (pm.includes('ONLINE')) modeMap.Online += paid;
        else if (pm.includes('BANK') || pm.includes('TRANSFER')) modeMap.BankTransfer += paid;
        else if (paid > 0) modeMap.Other += paid;
      });

      const collectionRate = totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : 0;

      kpis = {
        totalBilled: Math.round(totalBilled),
        totalCollected: Math.round(totalCollected),
        totalLateFees: Math.round(totalLateFees),
        totalPending: Math.round(totalPending),
        collectionRate: `${collectionRate}%`,
        invoicesCount: records.length
      };

      breakdown = {
        byPaymentMode: modeMap,
        byStatus: statusMap
      };

    } else if (canonicalType === 'pending_dues') {
      const { rows: overdueRows } = await db.query(`
        SELECT p.id, p.invoiceNumber, p.studentId, s.studentName, s.phone, r.roomNumber,
               p.billingMonth, p.amountDue, p.lateFee, p.amountPaid,
               (p.amountDue + p.lateFee - p.amountPaid) as pendingBalance,
               p.status, p.dueDate,
               EXTRACT(DAY FROM (CURRENT_TIMESTAMP - COALESCE(p.dueDate::timestamp, p.createdAt))) as daysOverdue
        FROM payments p
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        WHERE p.status != 'paid' AND (p.amountDue + p.lateFee - p.amountPaid) > 0
        ORDER BY daysOverdue DESC, pendingBalance DESC
      `);
      records = overdueRows;

      let totalOutstanding = 0;
      let totalLateFees = 0;
      let bucket0to30 = 0;
      let bucket31to60 = 0;
      let bucket60Plus = 0;

      records.forEach(r => {
        const bal = parseFloat(r.pendingbalance || r.pendingBalance || 0);
        const late = parseFloat(r.latefee || r.lateFee || 0);
        const days = Math.max(0, parseInt(r.daysoverdue || r.daysOverdue || 0));

        totalOutstanding += bal;
        totalLateFees += late;

        if (days <= 30) bucket0to30 += bal;
        else if (days <= 60) bucket31to60 += bal;
        else bucket60Plus += bal;
      });

      kpis = {
        totalOutstanding: Math.round(totalOutstanding),
        overdueAccountsCount: records.length,
        totalLateFees: Math.round(totalLateFees),
        bucket0to30: Math.round(bucket0to30),
        bucket31to60: Math.round(bucket31to60),
        bucket60Plus: Math.round(bucket60Plus)
      };

      breakdown = {
        agingBuckets: {
          '0 - 30 Days': Math.round(bucket0to30),
          '31 - 60 Days': Math.round(bucket31to60),
          '60+ Days': Math.round(bucket60Plus)
        }
      };

    } else if (canonicalType === 'security_deposits') {
      const params = [];
      let dateFilter = '';
      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        params.push(`${month.trim()}%`);
        dateFilter = ` AND TO_CHAR(sd.transactionDate, 'YYYY-MM') LIKE $${params.length}`;
      } else {
        if (startDate) {
          params.push(startDate);
          dateFilter += ` AND sd.transactionDate >= $${params.length}::timestamp`;
        }
        if (endDate) {
          params.push(`${endDate} 23:59:59`);
          dateFilter += ` AND sd.transactionDate <= $${params.length}::timestamp`;
        }
      }

      const q = `
        SELECT sd.*, s.studentName, s.phone, r.roomNumber
        FROM security_deposits sd
        JOIN students s ON sd.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        WHERE 1=1 ${dateFilter}
        ORDER BY sd.transactionDate DESC, sd.id DESC
      `;
      const { rows } = await db.query(q, params);
      records = rows;

      let totalCollected = 0;
      let totalRefunded = 0;
      let totalDeductions = 0;
      let pendingRefunds = 0;

      const typeMap = {};
      const categoryMap = {};

      records.forEach(d => {
        const amt = parseFloat(d.amount || 0);
        const type = String(d.transactiontype || d.transactionType || '').toUpperCase();
        const cat = String(d.category || 'General');

        typeMap[type] = (typeMap[type] || 0) + amt;
        categoryMap[cat] = (categoryMap[cat] || 0) + amt;

        if (type.includes('COLLECT') || type.includes('DEPOSIT')) totalCollected += amt;
        else if (type.includes('REFUND')) totalRefunded += amt;
        else if (type.includes('DEDUCT') || type.includes('DAMAGE')) totalDeductions += amt;

        if (String(d.status || '').toLowerCase() === 'pending_refund' || String(d.status || '').toLowerCase() === 'pending') {
          pendingRefunds++;
        }
      });

      const netHeld = Math.max(0, totalCollected - totalRefunded - totalDeductions);

      kpis = {
        totalDepositsHeld: Math.round(netHeld),
        totalDepositsCollected: Math.round(totalCollected),
        totalRefunded: Math.round(totalRefunded),
        totalDeductions: Math.round(totalDeductions),
        pendingRefundsCount: pendingRefunds,
        totalTransactions: records.length
      };

      breakdown = {
        byTransactionType: typeMap,
        byCategory: categoryMap
      };

    } else if (canonicalType === 'income_expenses') {
      const paramsExp = [];
      let expFilter = '';
      const paramsInc = [];
      let incFilter = '';

      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        paramsExp.push(month.trim());
        expFilter = ` AND e.billingMonth = $${paramsExp.length}`;
        paramsInc.push(month.trim());
        incFilter = ` AND p.billingMonth = $${paramsInc.length}`;
      } else {
        if (startDate) {
          paramsExp.push(startDate);
          expFilter += ` AND e.expenseDate >= $${paramsExp.length}::timestamp`;
          paramsInc.push(startDate);
          incFilter += ` AND p.createdAt >= $${paramsInc.length}::timestamp`;
        }
        if (endDate) {
          paramsExp.push(`${endDate} 23:59:59`);
          expFilter += ` AND e.expenseDate <= $${paramsExp.length}::timestamp`;
          paramsInc.push(`${endDate} 23:59:59`);
          incFilter += ` AND p.createdAt <= $${paramsInc.length}::timestamp`;
        }
      }

      const { rows: expRows } = await db.query(`
        SELECT e.id, e.expenseNumber, e.category, e.title, e.amount, e.expenseDate, e.billingMonth,
               e.paymentMode, e.paidTo, e.invoiceRef, e.notes, e.recordedBy, 'expense' as entryType
        FROM expenses e
        WHERE 1=1 ${expFilter}
        ORDER BY e.expenseDate DESC, e.id DESC
      `, paramsExp);

      const { rows: incRows } = await db.query(`
        SELECT p.id, p.invoiceNumber as reference, 'Hostel Rent' as category, 
               ('Rent from ' || s.studentName || ' (Room ' || COALESCE(r.roomNumber, '—') || ')') as title,
               p.amountPaid as amount, COALESCE(p.paidAt, p.createdAt) as date, p.billingMonth,
               p.paymentMode, s.studentName as party, '' as notes, 'system' as recordedBy, 'income' as entryType
        FROM payments p
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        WHERE p.amountPaid > 0 ${incFilter}
        ORDER BY COALESCE(p.paidAt, p.createdAt) DESC
      `, paramsInc);

      let totalExpenses = 0;
      const expenseByCategory = {};
      expRows.forEach(e => {
        const amt = parseFloat(e.amount || 0);
        totalExpenses += amt;
        const cat = e.category || 'Miscellaneous';
        expenseByCategory[cat] = (expenseByCategory[cat] || 0) + amt;
      });

      let totalIncome = 0;
      incRows.forEach(i => {
        totalIncome += parseFloat(i.amount || 0);
      });

      const netProfit = totalIncome - totalExpenses;
      const profitMargin = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : 0;

      kpis = {
        totalIncome: Math.round(totalIncome),
        totalExpenses: Math.round(totalExpenses),
        netProfit: Math.round(netProfit),
        profitMargin: `${profitMargin}%`,
        expenseEntriesCount: expRows.length,
        incomeEntriesCount: incRows.length
      };

      breakdown = {
        expenseByCategory,
        overview: {
          'Total Income': Math.round(totalIncome),
          'Total Expenses': Math.round(totalExpenses),
          'Net Operating Profit': Math.round(netProfit)
        }
      };

      records = expRows;

    } else if (canonicalType === 'checkin_checkout') {
      const params = [];
      let dateFilter = '';
      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        params.push(`${month.trim()}%`);
        dateFilter = ` AND (TO_CHAR(sh.checkInDate, 'YYYY-MM') LIKE $${params.length} OR TO_CHAR(sh.checkOutDate, 'YYYY-MM') LIKE $${params.length})`;
      } else {
        if (startDate) {
          params.push(startDate);
          dateFilter += ` AND (sh.checkInDate >= $${params.length}::timestamp OR sh.checkOutDate >= $${params.length}::timestamp)`;
        }
        if (endDate) {
          params.push(`${endDate} 23:59:59`);
          dateFilter += ` AND (sh.checkInDate <= $${params.length}::timestamp OR sh.checkOutDate <= $${params.length}::timestamp)`;
        }
      }

      const q = `
        SELECT sh.*, s.studentName, s.phone, r.roomNumber, b.bedLabel
        FROM stay_history sh
        JOIN students s ON sh.studentId = s.id
        LEFT JOIN rooms r ON sh.roomId = r.id
        LEFT JOIN beds b ON sh.bedId = b.id
        WHERE 1=1 ${dateFilter}
        ORDER BY sh.id DESC
      `;
      const { rows } = await db.query(q, params);
      records = rows;

      let totalStays = records.length;
      let activeStays = 0;
      let checkedOutCount = 0;
      let totalStayDays = 0;
      let staysWithDurationCount = 0;

      const reasonMap = {};
      const statusMap = {};

      records.forEach(sh => {
        const st = String(sh.status || 'active').toLowerCase();
        statusMap[st] = (statusMap[st] || 0) + 1;

        if (st === 'active') {
          activeStays++;
        } else {
          checkedOutCount++;
          const reason = sh.checkoutreason || sh.checkOutReason || 'General Checkout';
          reasonMap[reason] = (reasonMap[reason] || 0) + 1;

          if (sh.checkindate && sh.checkoutdate) {
            const diffDays = Math.max(1, Math.round((new Date(sh.checkoutdate) - new Date(sh.checkindate)) / (1000 * 60 * 60 * 24)));
            totalStayDays += diffDays;
            staysWithDurationCount++;
          }
        }
      });

      const avgStayDays = staysWithDurationCount > 0 ? Math.round(totalStayDays / staysWithDurationCount) : 0;

      kpis = {
        totalStays,
        activeStays,
        checkedOutCount,
        avgStayDays: `${avgStayDays} Days`
      };

      breakdown = {
        byReason: reasonMap,
        byStatus: statusMap
      };

    } else if (canonicalType === 'complaints_maintenance') {
      const params = [];
      let dateFilter = '';
      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        params.push(`${month.trim()}%`);
        dateFilter = ` AND TO_CHAR(c.createdAt, 'YYYY-MM') LIKE $${params.length}`;
      } else {
        if (startDate) {
          params.push(startDate);
          dateFilter += ` AND c.createdAt >= $${params.length}::timestamp`;
        }
        if (endDate) {
          params.push(`${endDate} 23:59:59`);
          dateFilter += ` AND c.createdAt <= $${params.length}::timestamp`;
        }
      }

      const q = `
        SELECT c.*, s.studentName, s.phone, r.roomNumber
        FROM complaints c
        LEFT JOIN students s ON c.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        WHERE 1=1 ${dateFilter}
        ORDER BY c.id DESC
      `;
      const { rows } = await db.query(q, params);
      records = rows;

      let totalTickets = records.length;
      let resolvedCount = 0;
      let openCount = 0;
      let inProgressCount = 0;
      let totalCost = 0;
      let hostelCost = 0;
      let studentCost = 0;

      const catMap = {};
      const statusMap = {};

      records.forEach(c => {
        const st = String(c.status || 'open').toLowerCase();
        statusMap[st] = (statusMap[st] || 0) + 1;

        if (st === 'resolved') resolvedCount++;
        else if (st === 'in_progress') inProgressCount++;
        else openCount++;

        const cost = parseFloat(c.repaircost || c.repairCost || 0);
        totalCost += cost;

        const paidBy = String(c.costpaidby || c.costPaidBy || 'hostel').toLowerCase();
        if (paidBy === 'student') studentCost += cost;
        else hostelCost += cost;

        const cat = c.category || 'General';
        catMap[cat] = (catMap[cat] || 0) + 1;
      });

      const resRate = totalTickets > 0 ? ((resolvedCount / totalTickets) * 100).toFixed(1) : 0;

      kpis = {
        totalTickets,
        resolvedCount,
        openCount,
        inProgressCount,
        resolutionRate: `${resRate}%`,
        totalRepairCost: Math.round(totalCost),
        hostelBorneCost: Math.round(hostelCost),
        studentBorneCost: Math.round(studentCost)
      };

      breakdown = {
        byCategory: catMap,
        byStatus: statusMap
      };

    } else if (canonicalType === 'visitors') {
      const params = [];
      let dateFilter = '';
      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        params.push(`${month.trim()}%`);
        dateFilter = ` AND TO_CHAR(v.entryTime, 'YYYY-MM') LIKE $${params.length}`;
      } else {
        if (startDate) {
          params.push(startDate);
          dateFilter += ` AND v.entryTime >= $${params.length}::timestamp`;
        }
        if (endDate) {
          params.push(`${endDate} 23:59:59`);
          dateFilter += ` AND v.entryTime <= $${params.length}::timestamp`;
        }
      }

      const q = `
        SELECT v.*, s.studentName, s.phone as studentPhone, COALESCE(v.roomNumber, r.roomNumber) as roomNo
        FROM visitors v
        LEFT JOIN students s ON v.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        WHERE 1=1 ${dateFilter}
        ORDER BY v.entryTime DESC, v.id DESC
      `;
      const { rows } = await db.query(q, params);
      records = rows;

      let totalVisitors = records.length;
      let insideCount = 0;
      let exitedCount = 0;

      const relMap = {};
      const purposeMap = {};

      records.forEach(v => {
        if (!v.exittime && !v.exitTime) {
          insideCount++;
        } else {
          exitedCount++;
        }

        const rel = v.relation || 'Visitor';
        relMap[rel] = (relMap[rel] || 0) + 1;

        const purp = v.purpose || 'Meeting';
        purposeMap[purp] = (purposeMap[purp] || 0) + 1;
      });

      kpis = {
        totalVisitors,
        currentlyInside: insideCount,
        exitedCount
      };

      breakdown = {
        byRelation: relMap,
        byPurpose: purposeMap
      };
    }

    return res.status(200).json({
      success: true,
      reportType: canonicalType,
      filtersApplied: { startDate: startDate || null, endDate: endDate || null, month: month || null },
      kpis,
      breakdown,
      recordsCount: records.length,
      records
    });

  } catch (err) {
    console.error('getReportAnalytics Error:', err);
    return res.status(500).json({ success: false, message: `Failed to compile report analytics: ${err.message}` });
  }
}

/**
 * GET /api/reports/download
 * Exports any of the 9 reports as CSV with UTF-8 BOM (\ufeff) for clean Excel opening.
 */
async function downloadReport(req, res) {
  try {
    const canonicalType = getCanonicalReportType(req.query.type);
    const { startDate, endDate, month } = req.query;
    const db = await getDb();

    let csvContent = '\ufeff'; // UTF-8 BOM for Microsoft Excel compatibility
    const dateStamp = new Date().toISOString().split('T')[0];
    const filename = `${canonicalType}_report_${dateStamp}.csv`;

    if (canonicalType === 'students_admissions') {
      csvContent += 'ID,Name,Phone,Email,Aadhaar,College,Course,Year,Room,Bed,Join Date,Monthly Rent,Deposit,Status\n';
      const params = [];
      let dateFilter = '';
      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        params.push(`${month.trim()}%`);
        dateFilter = ` AND TO_CHAR(COALESCE(s.joinDate::timestamp, s.createdAt), 'YYYY-MM') LIKE $${params.length}`;
      }
      const { rows } = await db.query(`
        SELECT s.id, s.studentName, s.phone, u.email, s.aadhaarNumber, s.collegeName, s.course, s.year,
               r.roomNumber, b.bedLabel, s.joinDate, s.monthlyRent, s.depositAmount, s.status
        FROM students s
        LEFT JOIN users u ON s.userId = u.id
        LEFT JOIN rooms r ON s.roomId = r.id
        LEFT JOIN beds b ON s.bedId = b.id
        WHERE 1=1 ${dateFilter}
        ORDER BY s.id ASC
      `, params);

      rows.forEach(s => {
        csvContent += `"${s.id}","${s.studentname || s.studentName}","${s.phone}","${s.email || ''}","${s.aadhaarnumber || s.aadhaarNumber || ''}","${s.collegename || s.collegeName || ''}","${s.course || ''}","${s.year || ''}","Room ${s.roomnumber || s.roomNumber || '—'}","${s.bedlabel || s.bedLabel || '—'}","${s.joindate || s.joinDate || ''}","${s.monthlyrent || s.monthlyRent || 0}","${s.depositamount || s.depositAmount || 0}","${s.status}"\n`;
      });

    } else if (canonicalType === 'room_occupancy') {
      csvContent += 'Room Number,Floor,Block,Room Type,Capacity,Occupied Beds,Vacant Beds,Reserved Beds,Maintenance Beds,Monthly Fee,Status\n';
      const { rows } = await db.query(`
        SELECT r.roomNumber, r.floor, r.block, r.roomType, r.capacity, r.monthlyFee, r.status,
               COUNT(CASE WHEN b.status = 'occupied' THEN 1 END) as occupiedBeds,
               COUNT(CASE WHEN b.status = 'vacant' THEN 1 END) as vacantBeds,
               COUNT(CASE WHEN b.status = 'reserved' THEN 1 END) as reservedBeds,
               COUNT(CASE WHEN b.status = 'maintenance' THEN 1 END) as maintenanceBeds
        FROM rooms r
        LEFT JOIN beds b ON r.id = b.roomId
        GROUP BY r.id, r.roomNumber, r.floor, r.block, r.roomType, r.capacity, r.monthlyFee, r.status
        ORDER BY r.roomNumber ASC
      `);

      rows.forEach(r => {
        csvContent += `"${r.roomnumber || r.roomNumber}","${r.floor}","${r.block || ''}","${r.roomtype || r.roomType}","${r.capacity}","${r.occupiedbeds || 0}","${r.vacantbeds || 0}","${r.reservedbeds || 0}","${r.maintenancebeds || 0}","${r.monthlyfee || r.monthlyFee}","${r.status}"\n`;
      });

    } else if (canonicalType === 'rent_collection') {
      csvContent += 'Invoice Number,Student ID,Student Name,Phone,Room,Billing Month,Amount Due,Late Fee,Amount Paid,Pending Balance,Payment Mode,Status,Due Date,Paid Date\n';
      const params = [];
      let whereClause = 'WHERE 1=1';
      if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
        params.push(month.trim());
        whereClause += ` AND p.billingMonth = $${params.length}`;
      }

      const { rows } = await db.query(`
        SELECT p.invoiceNumber, p.studentId, s.studentName, s.phone, r.roomNumber,
               p.billingMonth, p.amountDue, p.lateFee, p.amountPaid,
               (p.amountDue + p.lateFee - p.amountPaid) as pendingBalance,
               p.paymentMode, p.status, p.dueDate, p.paidAt
        FROM payments p
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        ${whereClause}
        ORDER BY p.billingMonth DESC, p.id DESC
      `, params);

      rows.forEach(p => {
        const due = parseFloat(p.amountdue || p.amountDue || 0);
        const late = parseFloat(p.latefee || p.lateFee || 0);
        const paid = parseFloat(p.amountpaid || p.amountPaid || 0);
        const bal = Math.max(0, (due + late) - paid);
        csvContent += `"${p.invoicenumber || p.invoiceNumber || ''}","${p.studentid || p.studentId}","${p.studentname || p.studentName}","${p.phone || ''}","Room ${p.roomnumber || p.roomNumber || '—'}","${p.billingmonth || p.billingMonth}","${due}","${late}","${paid}","${bal}","${p.paymentmode || p.paymentMode || ''}","${p.status}","${p.duedate || p.dueDate || ''}","${p.paidat || p.paidAt || ''}"\n`;
      });

    } else if (canonicalType === 'pending_dues') {
      csvContent += 'Invoice Number,Student ID,Student Name,Phone,Room Number,Billing Month,Due Date,Days Overdue,Amount Due,Late Fee,Amount Paid,Outstanding Balance,Status\n';
      const { rows } = await db.query(`
        SELECT p.invoiceNumber, p.studentId, s.studentName, s.phone, r.roomNumber,
               p.billingMonth, p.dueDate, p.amountDue, p.lateFee, p.amountPaid,
               (p.amountDue + p.lateFee - p.amountPaid) as pendingBalance, p.status,
               EXTRACT(DAY FROM (CURRENT_TIMESTAMP - COALESCE(p.dueDate::timestamp, p.createdAt))) as daysOverdue
        FROM payments p
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        WHERE p.status != 'paid' AND (p.amountDue + p.lateFee - p.amountPaid) > 0
        ORDER BY daysOverdue DESC
      `);

      rows.forEach(p => {
        const bal = parseFloat(p.pendingbalance || p.pendingBalance || 0);
        const days = Math.max(0, Math.round(p.daysoverdue || p.daysOverdue || 0));
        csvContent += `"${p.invoicenumber || p.invoiceNumber || ''}","${p.studentid || p.studentId}","${p.studentname || p.studentName}","${p.phone || ''}","Room ${p.roomnumber || p.roomNumber || '—'}","${p.billingmonth || p.billingMonth}","${p.duedate || p.dueDate || ''}","${days}","${p.amountdue || p.amountDue}","${p.latefee || p.lateFee || 0}","${p.amountpaid || p.amountPaid || 0}","${bal}","${p.status}"\n`;
      });

    } else if (canonicalType === 'security_deposits') {
      csvContent += 'Deposit Number,Student ID,Student Name,Phone,Room,Transaction Type,Category,Amount,Balance After,Payment Mode,Reference Number,Reason,Status,Date\n';
      const { rows } = await db.query(`
        SELECT sd.*, s.studentName, s.phone, r.roomNumber
        FROM security_deposits sd
        JOIN students s ON sd.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY sd.transactionDate DESC, sd.id DESC
      `);

      rows.forEach(d => {
        csvContent += `"${d.depositnumber || d.depositNumber}","${d.studentid || d.studentId}","${d.studentname || d.studentName}","${d.phone || ''}","Room ${d.roomnumber || d.roomNumber || '—'}","${d.transactiontype || d.transactionType}","${d.category || ''}","${d.amount}","${d.balanceafter || d.balanceAfter}","${d.paymentmode || d.paymentMode}","${d.referencenumber || d.referenceNumber || ''}","${d.reason || ''}","${d.status}","${d.transactiondate || d.transactionDate}"\n`;
      });

    } else if (canonicalType === 'income_expenses') {
      csvContent += 'Expense Number,Title,Category,Amount,Expense Date,Billing Month,Payment Mode,Paid To,Invoice Ref,Notes,Recorded By\n';
      const { rows } = await db.query(`
        SELECT * FROM expenses ORDER BY expenseDate DESC, id DESC
      `);

      rows.forEach(e => {
        csvContent += `"${e.expensenumber || e.expenseNumber}","${e.title}","${e.category}","${e.amount}","${e.expensedate || e.expenseDate}","${e.billingmonth || e.billingMonth || ''}","${e.paymentmode || e.paymentMode || ''}","${e.paidto || e.paidTo || ''}","${e.invoiceref || e.invoiceRef || ''}","${e.notes || ''}","${e.recordedby || e.recordedBy || ''}"\n`;
      });

    } else if (canonicalType === 'checkin_checkout') {
      csvContent += 'Student Name,Phone,Room,Bed,Check-in Date,Check-out Date,Reason,Pending Rent,Deposit Refunded,Status,Notes\n';
      const { rows } = await db.query(`
        SELECT sh.*, s.studentName, s.phone, r.roomNumber, b.bedLabel
        FROM stay_history sh
        JOIN students s ON sh.studentId = s.id
        LEFT JOIN rooms r ON sh.roomId = r.id
        LEFT JOIN beds b ON sh.bedId = b.id
        ORDER BY sh.id DESC
      `);

      rows.forEach(sh => {
        csvContent += `"${sh.studentname || sh.studentName}","${sh.phone || ''}","Room ${sh.roomnumber || sh.roomNumber || '—'}","${sh.bedlabel || sh.bedLabel || '—'}","${sh.checkindate || sh.checkInDate || ''}","${sh.checkoutdate || sh.checkOutDate || ''}","${sh.checkoutreason || sh.checkOutReason || ''}","${sh.pendingrent || sh.pendingRent || 0}","${sh.depositrefunded || sh.depositRefunded || 0}","${sh.status}","${sh.notes || ''}"\n`;
      });

    } else if (canonicalType === 'complaints_maintenance') {
      csvContent += 'Complaint Number,Title,Student Name,Room,Category,Priority,Repair Cost,Cost Paid By,Status,Created At,Resolved At\n';
      const { rows } = await db.query(`
        SELECT c.*, s.studentName, r.roomNumber
        FROM complaints c
        LEFT JOIN students s ON c.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY c.id DESC
      `);

      rows.forEach(c => {
        csvContent += `"${c.complaintnumber || c.complaintNumber || c.id}","${c.title}","${c.studentname || c.studentName || '—'}","Room ${c.roomnumber || c.roomNumber || '—'}","${c.category}","${c.priority || 'Medium'}","${c.repaircost || c.repairCost || 0}","${c.costpaidby || c.costPaidBy || 'Hostel'}","${c.status}","${c.createdat || c.createdAt || ''}","${c.resolvedat || c.resolvedAt || ''}"\n`;
      });

    } else if (canonicalType === 'visitors') {
      csvContent += 'Gate Pass,Visitor Name,Phone,Student Name,Room,Relation,Purpose,Entry Time,Exit Time,ID Proof,ID Number,Remarks,Recorded By\n';
      const { rows } = await db.query(`
        SELECT v.*, s.studentName, COALESCE(v.roomNumber, r.roomNumber) as roomNo
        FROM visitors v
        LEFT JOIN students s ON v.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY v.entryTime DESC
      `);

      rows.forEach(v => {
        csvContent += `"${v.gatepassnumber || v.gatePassNumber || ''}","${v.visitorname || v.visitorName}","${v.phone}","${v.studentname || v.studentName || '—'}","Room ${v.roomno || v.roomNo || '—'}","${v.relation}","${v.purpose}","${v.entrytime || v.entryTime}","${v.exittime || v.exitTime || 'Inside'}","${v.idprooftype || v.idProofType || ''}","${v.idproofnumber || v.idProofNumber || ''}","${v.remarks || ''}","${v.recordedby || v.recordedBy || ''}"\n`;
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvContent);

  } catch (err) {
    console.error('downloadReport CSV Error:', err);
    return res.status(500).json({ success: false, message: `Failed to compile CSV report: ${err.message}` });
  }
}

/**
 * GET /api/reports/pdf
 * Generates an executive PDF report using pdfkit with headers, KPI metrics, and structured data tables.
 */
async function downloadReportPdf(req, res) {
  try {
    const canonicalType = getCanonicalReportType(req.query.type);
    const { startDate, endDate, month } = req.query;
    const db = await getDb();

    const titleMap = {
      students_admissions: 'Student Registry & Admissions Report',
      room_occupancy: 'Room Occupancy & Bed Availability Report',
      rent_collection: 'Monthly Rent Collection Report',
      pending_dues: 'Pending & Overdue Payments Report',
      security_deposits: 'Security Deposit Summary Report',
      income_expenses: 'Hostel Income & Expense Financial Report',
      checkin_checkout: 'Student Check-in & Check-out Stay Report',
      complaints_maintenance: 'Complaints & Maintenance Analytics Report',
      visitors: 'Hostel Visitor & Gate Pass Security Report'
    };

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const filename = `${canonicalType}_report_${new Date().toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // 1. Header Banner
    doc.rect(40, 40, doc.page.width - 80, 65).fill('#1E293B');
    doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
       .text('AKSHAYA DELUXE BOYS HOSTEL', 55, 52);
    doc.fontSize(9).font('Helvetica')
       .text('Opp. Aurora Engineering College, Avushapur, Ghatkesar, Hyderabad | Ph: +91 98852 97517', 55, 74)
       .text(`Generated on: ${new Date().toLocaleString('en-IN')}  |  Filter: ${month || (startDate ? `${startDate} to ${endDate || 'Now'}` : 'All Records')}`, 55, 87);

    doc.moveDown(3);

    // 2. Report Title
    const reportTitle = titleMap[canonicalType] || 'Hostel Operations Report';
    doc.fillColor('#0F172A').fontSize(14).font('Helvetica-Bold').text(reportTitle, 40, 120);
    doc.strokeColor('#CBD5E1').lineWidth(1).moveTo(40, 138).lineTo(doc.page.width - 40, 138).stroke();

    // 3. Fetch Data & Build Table
    let tableHeaders = [];
    let rows = [];

    if (canonicalType === 'students_admissions') {
      tableHeaders = ['ID', 'Student Name', 'Phone', 'Room', 'College', 'Rent (₹)', 'Deposit (₹)', 'Status'];
      const { rows: data } = await db.query(`
        SELECT s.id, s.studentName, s.phone, r.roomNumber, s.collegeName, s.monthlyRent, s.depositAmount, s.status
        FROM students s LEFT JOIN rooms r ON s.roomId = r.id ORDER BY s.id ASC LIMIT 100
      `);
      rows = data.map(d => [
        `#${d.id}`,
        String(d.studentname || d.studentName || '').substring(0, 18),
        String(d.phone || '—'),
        d.roomnumber || d.roomNumber ? `R-${d.roomnumber || d.roomNumber}` : '—',
        String(d.collegename || d.collegeName || '—').substring(0, 15),
        `₹${d.monthlyrent || d.monthlyRent || 0}`,
        `₹${d.depositamount || d.depositAmount || 0}`,
        String(d.status || '').toUpperCase()
      ]);

    } else if (canonicalType === 'room_occupancy') {
      tableHeaders = ['Room', 'Floor', 'Type', 'Capacity', 'Occupied', 'Vacant', 'Fee (₹)', 'Status'];
      const { rows: data } = await db.query(`
        SELECT r.roomNumber, r.floor, r.roomType, r.capacity, r.monthlyFee, r.status,
               COUNT(CASE WHEN b.status = 'occupied' THEN 1 END) as occ,
               COUNT(CASE WHEN b.status = 'vacant' THEN 1 END) as vac
        FROM rooms r LEFT JOIN beds b ON r.id = b.roomId
        GROUP BY r.id, r.roomNumber, r.floor, r.roomType, r.capacity, r.monthlyFee, r.status
        ORDER BY r.roomNumber ASC
      `);
      rows = data.map(d => [
        `Room ${d.roomnumber || d.roomNumber}`,
        String(d.floor || '').replace('Floor ', 'F-'),
        String(d.roomtype || d.roomType || `${d.capacity} Shr`),
        `${d.capacity}`,
        `${d.occ || 0}`,
        `${d.vac || 0}`,
        `₹${d.monthlyfee || d.monthlyFee}`,
        String(d.status || 'Active').toUpperCase()
      ]);

    } else if (canonicalType === 'rent_collection') {
      tableHeaders = ['Invoice', 'Student', 'Room', 'Month', 'Due (₹)', 'Paid (₹)', 'Balance (₹)', 'Status'];
      const { rows: data } = await db.query(`
        SELECT p.invoiceNumber, s.studentName, r.roomNumber, p.billingMonth, p.amountDue, p.lateFee, p.amountPaid, p.status
        FROM payments p JOIN students s ON p.studentId = s.id LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY p.billingMonth DESC, p.id DESC LIMIT 100
      `);
      rows = data.map(d => {
        const due = parseFloat(d.amountdue || d.amountDue || 0) + parseFloat(d.latefee || d.lateFee || 0);
        const paid = parseFloat(d.amountpaid || d.amountPaid || 0);
        const bal = Math.max(0, due - paid);
        return [
          String(d.invoicenumber || d.invoiceNumber || '').substring(0, 12),
          String(d.studentname || d.studentName || '').substring(0, 16),
          d.roomnumber || d.roomNumber ? `R-${d.roomnumber || d.roomNumber}` : '—',
          String(d.billingmonth || d.billingMonth || ''),
          `₹${due}`,
          `₹${paid}`,
          `₹${bal}`,
          String(d.status || '').toUpperCase()
        ];
      });

    } else if (canonicalType === 'pending_dues') {
      tableHeaders = ['Invoice', 'Student', 'Phone', 'Room', 'Month', 'Days Late', 'Balance (₹)', 'Status'];
      const { rows: data } = await db.query(`
        SELECT p.invoiceNumber, s.studentName, s.phone, r.roomNumber, p.billingMonth,
               (p.amountDue + p.lateFee - p.amountPaid) as bal, p.status,
               EXTRACT(DAY FROM (CURRENT_TIMESTAMP - COALESCE(p.dueDate::timestamp, p.createdAt))) as days
        FROM payments p JOIN students s ON p.studentId = s.id LEFT JOIN rooms r ON s.roomId = r.id
        WHERE p.status != 'paid' AND (p.amountDue + p.lateFee - p.amountPaid) > 0
        ORDER BY days DESC LIMIT 100
      `);
      rows = data.map(d => [
        String(d.invoicenumber || d.invoiceNumber || '').substring(0, 12),
        String(d.studentname || d.studentName || '').substring(0, 16),
        String(d.phone || '—'),
        d.roomnumber || d.roomNumber ? `R-${d.roomnumber || d.roomNumber}` : '—',
        String(d.billingmonth || d.billingMonth || ''),
        `${Math.max(0, Math.round(d.days || 0))} d`,
        `₹${Math.round(d.bal || 0)}`,
        String(d.status || '').toUpperCase()
      ]);

    } else if (canonicalType === 'security_deposits') {
      tableHeaders = ['Receipt No', 'Student', 'Room', 'Type', 'Category', 'Amount (₹)', 'Date', 'Status'];
      const { rows: data } = await db.query(`
        SELECT sd.*, s.studentName, r.roomNumber
        FROM security_deposits sd JOIN students s ON sd.studentId = s.id LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY sd.transactionDate DESC LIMIT 100
      `);
      rows = data.map(d => [
        String(d.depositnumber || d.depositNumber || '').substring(0, 14),
        String(d.studentname || d.studentName || '').substring(0, 16),
        d.roomnumber || d.roomNumber ? `R-${d.roomnumber || d.roomNumber}` : '—',
        String(d.transactiontype || d.transactionType || ''),
        String(d.category || 'General'),
        `₹${d.amount}`,
        d.transactiondate || d.transactionDate ? String(d.transactiondate || d.transactionDate).split('T')[0] : '',
        String(d.status || '').toUpperCase()
      ]);

    } else if (canonicalType === 'income_expenses') {
      tableHeaders = ['Voucher No', 'Title / Description', 'Category', 'Date', 'Mode', 'Amount (₹)', 'Paid To'];
      const { rows: data } = await db.query(`
        SELECT * FROM expenses ORDER BY expenseDate DESC LIMIT 100
      `);
      rows = data.map(d => [
        String(d.expensenumber || d.expenseNumber || '').substring(0, 12),
        String(d.title || '').substring(0, 20),
        String(d.category || 'General'),
        d.expensedate || d.expenseDate ? String(d.expensedate || d.expenseDate).split('T')[0] : '',
        String(d.paymentmode || d.paymentMode || 'Cash'),
        `₹${d.amount}`,
        String(d.paidto || d.paidTo || '—').substring(0, 14)
      ]);

    } else if (canonicalType === 'checkin_checkout') {
      tableHeaders = ['Student', 'Phone', 'Room', 'Bed', 'Check-in', 'Check-out', 'Stay Status'];
      const { rows: data } = await db.query(`
        SELECT sh.*, s.studentName, s.phone, r.roomNumber, b.bedLabel
        FROM stay_history sh JOIN students s ON sh.studentId = s.id
        LEFT JOIN rooms r ON sh.roomId = r.id LEFT JOIN beds b ON sh.bedId = b.id
        ORDER BY sh.id DESC LIMIT 100
      `);
      rows = data.map(d => [
        String(d.studentname || d.studentName || '').substring(0, 18),
        String(d.phone || '—'),
        d.roomnumber || d.roomNumber ? `R-${d.roomnumber || d.roomNumber}` : '—',
        String(d.bedlabel || d.bedLabel || '—'),
        d.checkindate || d.checkInDate ? String(d.checkindate || d.checkInDate).split('T')[0] : '',
        d.checkoutdate || d.checkOutDate ? String(d.checkoutdate || d.checkOutDate).split('T')[0] : 'Current',
        String(d.status || 'Active').toUpperCase()
      ]);

    } else if (canonicalType === 'complaints_maintenance') {
      tableHeaders = ['Ticket', 'Title', 'Student', 'Room', 'Category', 'Cost (₹)', 'Paid By', 'Status'];
      const { rows: data } = await db.query(`
        SELECT c.*, s.studentName, r.roomNumber
        FROM complaints c LEFT JOIN students s ON c.studentId = s.id LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY c.id DESC LIMIT 100
      `);
      rows = data.map(d => [
        `#${d.complaintnumber || d.complaintNumber || d.id}`,
        String(d.title || '').substring(0, 18),
        String(d.studentname || d.studentName || '—').substring(0, 14),
        d.roomnumber || d.roomNumber ? `R-${d.roomnumber || d.roomNumber}` : '—',
        String(d.category || 'General'),
        `₹${d.repaircost || d.repairCost || 0}`,
        String(d.costpaidby || d.costPaidBy || 'Hostel'),
        String(d.status || '').toUpperCase()
      ]);

    } else if (canonicalType === 'visitors') {
      tableHeaders = ['Gate Pass', 'Visitor Name', 'Phone', 'Student', 'Room', 'Relation', 'Entry Time', 'Status'];
      const { rows: data } = await db.query(`
        SELECT v.*, s.studentName, COALESCE(v.roomNumber, r.roomNumber) as roomNo
        FROM visitors v LEFT JOIN students s ON v.studentId = s.id LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY v.entryTime DESC LIMIT 100
      `);
      rows = data.map(d => [
        String(d.gatepassnumber || d.gatePassNumber || ''),
        String(d.visitorname || d.visitorName || '').substring(0, 15),
        String(d.phone || '—'),
        String(d.studentname || d.studentName || '—').substring(0, 14),
        d.roomno || d.roomNo ? `R-${d.roomno || d.roomNo}` : '—',
        String(d.relation || 'Visitor'),
        d.entrytime || d.entryTime ? String(d.entrytime || d.entryTime).substring(11, 16) : '',
        d.exittime || d.exitTime ? 'EXITED' : 'INSIDE'
      ]);
    }

    // 4. Render Table
    let startY = 155;
    const colWidth = (doc.page.width - 80) / tableHeaders.length;

    // Table Header Row
    doc.rect(40, startY, doc.page.width - 80, 22).fill('#2563EB');
    doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
    tableHeaders.forEach((h, i) => {
      doc.text(h, 45 + (i * colWidth), startY + 6, { width: colWidth - 8, align: 'left' });
    });

    startY += 24;
    doc.font('Helvetica').fontSize(7.5);

    rows.forEach((row, rowIndex) => {
      // Check page overflow
      if (startY > doc.page.height - 50) {
        doc.addPage();
        startY = 40;
        // Repeat Header
        doc.rect(40, startY, doc.page.width - 80, 20).fill('#2563EB');
        doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
        tableHeaders.forEach((h, i) => {
          doc.text(h, 45 + (i * colWidth), startY + 6, { width: colWidth - 8, align: 'left' });
        });
        startY += 22;
        doc.font('Helvetica').fontSize(7.5);
      }

      // Alternate row backgrounds
      if (rowIndex % 2 === 0) {
        doc.rect(40, startY, doc.page.width - 80, 18).fill('#F8FAFC');
      }

      doc.fillColor('#1E293B');
      row.forEach((cell, i) => {
        doc.text(String(cell || '—'), 45 + (i * colWidth), startY + 5, { width: colWidth - 8, align: 'left' });
      });

      startY += 18;
    });

    // Footer
    const totalPages = doc.bufferedPageRange().count;
    doc.fillColor('#64748B').fontSize(7.5).font('Helvetica')
       .text('This is an official computer-generated document from Akshaya Deluxe Boys Hostel Portal.', 40, doc.page.height - 30, { align: 'center' });

    doc.end();

  } catch (err) {
    console.error('downloadReportPdf Error:', err);
    if (typeof res.status === 'function') {
      return res.status(500).json({ success: false, message: `Failed to compile PDF report: ${err.message}` });
    } else if (typeof res.end === 'function') {
      return res.end();
    }
  }
}

/**
 * Expense Management CRUD Controllers
 */
async function getExpenses(req, res) {
  try {
    const { startDate, endDate, month, category } = req.query;
    const db = await getDb();
    const params = [];
    let whereClause = 'WHERE 1=1';

    if (category) {
      params.push(category);
      whereClause += ` AND e.category = $${params.length}`;
    }

    if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
      params.push(month.trim());
      whereClause += ` AND e.billingMonth = $${params.length}`;
    } else {
      if (startDate) {
        params.push(startDate);
        whereClause += ` AND e.expenseDate >= $${params.length}::timestamp`;
      }
      if (endDate) {
        params.push(`${endDate} 23:59:59`);
        whereClause += ` AND e.expenseDate <= $${params.length}::timestamp`;
      }
    }

    const { rows } = await db.query(`
      SELECT * FROM expenses e ${whereClause} ORDER BY e.expenseDate DESC, e.id DESC
    `, params);

    return res.status(200).json({ success: true, count: rows.length, expenses: rows });
  } catch (err) {
    console.error('getExpenses Error:', err);
    return res.status(500).json({ success: false, message: `Failed to fetch expenses: ${err.message}` });
  }
}

async function recordExpense(req, res) {
  try {
    const { category, title, amount, expenseDate, billingMonth, paymentMode, paidTo, invoiceRef, notes } = req.body;
    if (!category || !title || !amount) {
      return res.status(400).json({ success: false, message: 'Category, title, and amount are required fields.' });
    }

    const db = await getDb();
    const expNum = `EXP-${Date.now().toString().slice(-6)}`;
    const curMonth = billingMonth || (expenseDate ? expenseDate.substring(0, 7) : new Date().toISOString().substring(0, 7));
    const recorder = req.user?.name || 'Admin';

    const { rows } = await db.query(`
      INSERT INTO expenses (expenseNumber, category, title, amount, expenseDate, billingMonth, paymentMode, paidTo, invoiceRef, notes, recordedBy)
      VALUES ($1, $2, $3, $4, COALESCE($5::timestamp, CURRENT_TIMESTAMP), $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [expNum, category, title, parseFloat(amount), expenseDate || null, curMonth, paymentMode || 'Cash', paidTo || '', invoiceRef || '', notes || '', recorder]);

    return res.status(201).json({ success: true, message: 'Expense recorded successfully.', expense: rows[0] });
  } catch (err) {
    console.error('recordExpense Error:', err);
    return res.status(500).json({ success: false, message: `Failed to record expense: ${err.message}` });
  }
}

async function deleteExpense(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();
    const { rowCount } = await db.query('DELETE FROM expenses WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Expense entry not found.' });
    }
    return res.status(200).json({ success: true, message: 'Expense entry deleted successfully.' });
  } catch (err) {
    console.error('deleteExpense Error:', err);
    return res.status(500).json({ success: false, message: `Failed to delete expense: ${err.message}` });
  }
}

/**
 * Visitor Management CRUD Controllers
 */
async function getVisitors(req, res) {
  try {
    const { status, startDate, endDate, month, search } = req.query;
    const db = await getDb();
    const params = [];
    let whereClause = 'WHERE 1=1';

    if (status === 'inside') {
      whereClause += ' AND v.exitTime IS NULL';
    } else if (status === 'exited') {
      whereClause += ' AND v.exitTime IS NOT NULL';
    }

    if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
      params.push(`${month.trim()}%`);
      whereClause += ` AND TO_CHAR(v.entryTime, 'YYYY-MM') LIKE $${params.length}`;
    } else {
      if (startDate) {
        params.push(startDate);
        whereClause += ` AND v.entryTime >= $${params.length}::timestamp`;
      }
      if (endDate) {
        params.push(`${endDate} 23:59:59`);
        whereClause += ` AND v.entryTime <= $${params.length}::timestamp`;
      }
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      whereClause += ` AND (v.visitorName ILIKE $${params.length} OR v.phone ILIKE $${params.length} OR v.gatePassNumber ILIKE $${params.length})`;
    }

    const { rows } = await db.query(`
      SELECT v.*, s.studentName, s.phone as studentPhone, COALESCE(v.roomNumber, r.roomNumber) as roomNo
      FROM visitors v
      LEFT JOIN students s ON v.studentId = s.id
      LEFT JOIN rooms r ON s.roomId = r.id
      ${whereClause}
      ORDER BY v.entryTime DESC
    `, params);

    return res.status(200).json({ success: true, count: rows.length, visitors: rows });
  } catch (err) {
    console.error('getVisitors Error:', err);
    return res.status(500).json({ success: false, message: `Failed to fetch visitors: ${err.message}` });
  }
}

async function recordVisitor(req, res) {
  try {
    const { studentId, visitorName, phone, relation, purpose, idProofType, idProofNumber, roomNumber, remarks } = req.body;
    if (!visitorName || !phone || !relation || !purpose) {
      return res.status(400).json({ success: false, message: 'Visitor name, phone, relation, and purpose are required.' });
    }

    const db = await getDb();
    const gatePass = `GP-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const recorder = req.user?.name || 'Main Gate Security';

    const { rows } = await db.query(`
      INSERT INTO visitors (studentId, visitorName, phone, relation, purpose, entryTime, idProofType, idProofNumber, roomNumber, gatePassNumber, remarks, recordedBy)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [studentId || null, visitorName, phone, relation, purpose, idProofType || 'Aadhaar', idProofNumber || '', roomNumber || '', gatePass, remarks || '', recorder]);

    return res.status(201).json({ success: true, message: 'Visitor entry recorded successfully.', visitor: rows[0] });
  } catch (err) {
    console.error('recordVisitor Error:', err);
    return res.status(500).json({ success: false, message: `Failed to record visitor: ${err.message}` });
  }
}

async function checkoutVisitor(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows } = await db.query(`
      UPDATE visitors
      SET exitTime = CURRENT_TIMESTAMP
      WHERE id = $1 AND exitTime IS NULL
      RETURNING *
    `, [id]);

    if (!rows[0]) {
      return res.status(400).json({ success: false, message: 'Visitor entry not found or already checked out.' });
    }

    return res.status(200).json({ success: true, message: 'Visitor checked out successfully.', visitor: rows[0] });
  } catch (err) {
    console.error('checkoutVisitor Error:', err);
    return res.status(500).json({ success: false, message: `Failed to checkout visitor: ${err.message}` });
  }
}

// Generate Google Sheet for report data (preserved legacy integration)
async function exportGoogleSheet(req, res) {
  try {
    const { type } = req.query;
    const canonicalType = getCanonicalReportType(type);
    const db = await getDb();
    const currentDateStr = new Date().toISOString().split('T')[0];
    let sheetTitle = `Akshaya Deluxe - ${canonicalType} Report - ${currentDateStr}`;
    let headers = [];
    let rowsData = [];

    if (canonicalType === 'students_admissions') {
      headers = ['ID', 'Name', 'Phone', 'Email', 'Aadhaar', 'College', 'Course', 'Year', 'Join Date', 'Monthly Rent', 'Deposit', 'Status'];
      const students = (await db.query(`
        SELECT s.id, s.studentName, s.phone, u.email, s.aadhaarNumber, s.collegeName, s.course, s.year, s.joinDate, s.monthlyRent, s.depositAmount, s.status
        FROM students s
        JOIN users u ON s.userId = u.id
        ORDER BY s.id ASC
      `)).rows;
      rowsData = students.map(s => [s.id, s.studentName, s.phone, s.email, s.aadhaarNumber || '', s.collegeName || '', s.course || '', s.year || '', s.joinDate || '', s.monthlyRent, s.depositAmount, s.status]);

    } else if (canonicalType === 'room_occupancy') {
      headers = ['Room Number', 'Floor', 'Capacity', 'Occupied Beds', 'Monthly Fee', 'Status'];
      const rooms = (await db.query(`
        SELECT r.roomNumber, r.floor, r.capacity, r.monthlyFee, r.status,
               COUNT(CASE WHEN b.status = 'occupied' THEN 1 END) as occ
        FROM rooms r
        LEFT JOIN beds b ON r.id = b.roomId
        GROUP BY r.id, r.roomNumber, r.floor, r.capacity, r.monthlyFee, r.status
        ORDER BY r.roomNumber ASC
      `)).rows;
      rowsData = rooms.map(r => [r.roomNumber, r.floor, r.capacity, r.occ, r.monthlyFee, r.status]);

    } else if (canonicalType === 'rent_collection') {
      headers = ['Invoice', 'Student Name', 'Room', 'Month', 'Due', 'Paid', 'Balance', 'Status'];
      const payments = (await db.query(`
        SELECT p.invoiceNumber, s.studentName, r.roomNumber, p.billingMonth, p.amountDue, p.amountPaid, p.status
        FROM payments p
        JOIN students s ON p.studentId = s.id
        LEFT JOIN rooms r ON s.roomId = r.id
        ORDER BY p.billingMonth DESC, p.id DESC
      `)).rows;
      rowsData = payments.map(p => [p.invoiceNumber, p.studentName, `Room ${p.roomNumber || '—'}`, p.billingMonth, p.amountDue, p.amountPaid, p.amountDue - p.amountPaid, p.status]);

    } else {
      headers = ['ID', 'Info', 'Date', 'Status'];
      rowsData = [['1', `Generated report for ${canonicalType}`, currentDateStr, 'SUCCESS']];
    }

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
        message: 'Invalid GOOGLE_PRIVATE_KEY format.'
      });
    }

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
      return res.status(400).json({ success: false, message: `Google Service Account signing failed: ${signErr.message}` });
    }

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(401).json({ success: false, message: 'Google OAuth authentication failed.' });
    }

    const spreadsheetId = (process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '').trim();
    if (!spreadsheetId) {
      return res.status(400).json({ success: false, message: 'GOOGLE_SHEET_ID is not configured.' });
    }

    return res.status(200).json({
      success: true,
      googleSheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      message: 'Report exported successfully.'
    });

  } catch (err) {
    console.error('Google Sheet Export Error:', err);
    res.status(500).json({ success: false, message: `Failed to generate Google Sheet: ${err.message}` });
  }
}

module.exports = {
  getReportAnalytics,
  downloadReport,
  downloadReportPdf,
  getExpenses,
  recordExpense,
  deleteExpense,
  getVisitors,
  recordVisitor,
  checkoutVisitor,
  exportGoogleSheet
};
