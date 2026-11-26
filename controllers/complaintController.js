const { getDb } = require('../config/db');
const { syncReqFilesToCloudinary } = require('../services/uploadService');
const { createNotification } = require('../services/notificationService');

/**
 * Generate formatted complaint number: CMP-YYYY-XXXXX
 */
async function generateComplaintNumber(db) {
  const currentYear = new Date().getFullYear();
  const prefix = `CMP-${currentYear}-`;
  const { rows } = await db.query(
    `SELECT complaintNumber FROM complaints 
     WHERE complaintNumber LIKE $1 
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let nextSequence = 1;
  const lastNum = rows.length > 0 ? (rows[0].complaintnumber || rows[0].complaintNumber) : null;
  if (lastNum) {
    const parts = lastNum.split('-');
    if (parts.length === 3) {
      const parsed = parseInt(parts[2], 10);
      if (!isNaN(parsed)) {
        nextSequence = parsed + 1;
      }
    }
  }

  let complaintNum = `${prefix}${String(nextSequence).padStart(5, '0')}`;
  let exists = true;
  while (exists) {
    const { rows: check } = await db.query('SELECT 1 FROM complaints WHERE complaintNumber = $1', [complaintNum]);
    if (check.length === 0) {
      exists = false;
    } else {
      nextSequence++;
      complaintNum = `${prefix}${String(nextSequence).padStart(5, '0')}`;
    }
  }

  return complaintNum;
}

/**
 * POST /api/complaints
 * Student submits a new complaint / maintenance ticket
 */
async function submitComplaint(req, res) {
  try {
    const db = await getDb();

    // 1. Authenticate student
    const { rows: studentRows } = await db.query(
      `SELECT id, studentName, studentCustomId, roomId, bedId 
       FROM students 
       WHERE userId = $1`,
      [req.user.id]
    );

    if (studentRows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Only registered hostel residents can submit complaints.'
      });
    }

    const student = studentRows[0];
    const { category, title, description, priority } = req.body;

    if (!category || !category.trim()) {
      return res.status(400).json({ success: false, message: 'Complaint category is required.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Complaint description is required.' });
    }

    // 2. Handle image upload if provided (Cloudinary sync or local)
    let imageUrl = null;
    if (req.file) {
      await syncReqFilesToCloudinary(req);
      if (req.file.path.startsWith('http://') || req.file.path.startsWith('https://')) {
        imageUrl = req.file.path;
      } else {
        const normalized = req.file.path.replace(/\\/g, '/');
        const uploadIdx = normalized.indexOf('uploads/');
        imageUrl = uploadIdx !== -1 ? '/' + normalized.substring(uploadIdx) : '/uploads/' + req.file.filename;
      }
    }

    const validPriority = ['Low', 'Medium', 'High', 'Emergency'].includes(priority) ? priority : 'Medium';
    const complaintNumber = await generateComplaintNumber(db);
    const complaintTitle = (title && title.trim()) ? title.trim() : `${category} Issue`;

    // 3. Insert complaint record
    const { rows: newComplaintRows } = await db.query(
      `INSERT INTO complaints (
        complaintNumber, studentId, roomId, bedId, category, 
        title, description, imageUrl, priority, status, 
        createdAt, updatedAt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        complaintNumber,
        student.id,
        student.roomId || null,
        student.bedId || null,
        category.trim(),
        complaintTitle,
        description.trim(),
        imageUrl,
        validPriority
      ]
    );

    const createdComplaint = newComplaintRows[0];

    // 4. Create notifications for Admin and Student
    await createNotification({
      type: 'COMPLAINT',
      category: 'COMPLAINT',
      title: 'New Complaint Ticket Raised',
      message: `New complaint ${complaintNumber} raised by ${student.studentName} (${category}).`,
      metadata: { complaintId: createdComplaint.id, complaintNumber, category }
    }).catch(() => {});

    await createNotification({
      studentId: student.id,
      userId: student.userId || req.user.id,
      type: 'COMPLAINT_UPDATE',
      category: 'COMPLAINT',
      title: `Complaint Ticket #${complaintNumber} Received`,
      message: `Your complaint regarding ${category} has been logged and assigned to administration for review.`,
      metadata: { complaintId: createdComplaint.id, complaintNumber, category }
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Complaint submitted successfully.',
      complaint: createdComplaint
    });
  } catch (err) {
    console.error('Error submitting complaint:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to submit complaint: ${err.message}`
    });
  }
}

/**
 * GET /api/complaints/my
 * Logged-in student retrieves their complaints
 */
async function getMyComplaints(req, res) {
  try {
    const db = await getDb();

    const { rows: studentRows } = await db.query(
      `SELECT id FROM students WHERE userId = $1`,
      [req.user.id]
    );

    if (studentRows.length === 0) {
      return res.status(403).json({ success: false, message: 'Student record not found.' });
    }

    const studentId = studentRows[0].id;

    const { rows: complaints } = await db.query(
      `SELECT c.*, 
              r.roomNumber, r.floor, r.block,
              b.bedLabel, b.bedNumber
       FROM complaints c
       LEFT JOIN rooms r ON c.roomId = r.id
       LEFT JOIN beds b ON c.bedId = b.id
       WHERE c.studentId = $1
       ORDER BY c.createdAt DESC, c.id DESC`,
      [studentId]
    );

    return res.status(200).json({
      success: true,
      complaints
    });
  } catch (err) {
    console.error('Error fetching student complaints:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch complaints: ${err.message}`
    });
  }
}

/**
 * GET /api/complaints/admin/all
 * Admin / Manager views all complaints with filters
 */
async function getAllComplaints(req, res) {
  try {
    const db = await getDb();
    const { status, category, search, priority } = req.query;

    let query = `
      SELECT c.*, 
             s.studentName, s.studentCustomId, s.phone, u.email,
             r.roomNumber, r.floor, r.block,
             b.bedLabel, b.bedNumber
      FROM complaints c
      JOIN students s ON c.studentId = s.id
      LEFT JOIN users u ON s.userId = u.id
      LEFT JOIN rooms r ON c.roomId = r.id
      LEFT JOIN beds b ON c.bedId = b.id
      WHERE 1=1
    `;
    const params = [];

    // Filter by status (Open, Assigned, In Progress, Resolved, Rejected)
    if (status && status !== 'ALL') {
      params.push(status);
      query += ` AND LOWER(c.status) = LOWER($${params.length})`;
    }

    // Filter by category
    if (category && category !== 'ALL') {
      params.push(category);
      query += ` AND LOWER(c.category) = LOWER($${params.length})`;
    }

    // Filter by priority
    if (priority && priority !== 'ALL') {
      params.push(priority);
      query += ` AND LOWER(c.priority) = LOWER($${params.length})`;
    }

    // Search filter across complaintNumber, studentName, studentCustomId, phone, roomNumber, title, description
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      const p = `$${params.length}`;
      query += ` AND (
        LOWER(c.complaintNumber) LIKE ${p} OR
        LOWER(s.studentName) LIKE ${p} OR
        LOWER(COALESCE(s.studentCustomId, '')) LIKE ${p} OR
        LOWER(s.phone) LIKE ${p} OR
        LOWER(COALESCE(r.roomNumber, '')) LIKE ${p} OR
        LOWER(COALESCE(c.title, '')) LIKE ${p} OR
        LOWER(c.description) LIKE ${p} OR
        LOWER(COALESCE(c.assignedTo, '')) LIKE ${p}
      )`;
    }

    query += ` ORDER BY c.createdAt DESC, c.id DESC`;

    const { rows: complaints } = await db.query(query, params);

    return res.status(200).json({
      success: true,
      complaints,
      count: complaints.length
    });
  } catch (err) {
    console.error('Error fetching admin complaints:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch complaints: ${err.message}`
    });
  }
}

/**
 * GET /api/complaints/admin/stats
 * Admin / Manager overview counts and maintenance repair spend
 */
async function getComplaintStats(req, res) {
  try {
    const db = await getDb();

    const { rows } = await db.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE LOWER(status) = 'open')::int as open,
        COUNT(*) FILTER (WHERE LOWER(status) = 'assigned')::int as assigned,
        COUNT(*) FILTER (WHERE LOWER(status) = 'in progress' OR LOWER(status) = 'in_progress')::int as in_progress,
        COUNT(*) FILTER (WHERE LOWER(status) = 'resolved')::int as resolved,
        COUNT(*) FILTER (WHERE LOWER(status) = 'rejected')::int as rejected,
        COALESCE(SUM(repairCost), 0)::numeric as total_repair_cost,
        COALESCE(SUM(repairCost) FILTER (WHERE LOWER(costPaidBy) = 'hostel'), 0)::numeric as hostel_repair_cost,
        COALESCE(SUM(repairCost) FILTER (WHERE LOWER(costPaidBy) = 'student'), 0)::numeric as student_repair_cost
      FROM complaints
    `);

    const stats = rows[0] || {
      total: 0,
      open: 0,
      assigned: 0,
      in_progress: 0,
      resolved: 0,
      rejected: 0,
      total_repair_cost: 0,
      hostel_repair_cost: 0,
      student_repair_cost: 0
    };

    return res.status(200).json({
      success: true,
      stats: {
        total: parseInt(stats.total) || 0,
        open: parseInt(stats.open) || 0,
        assigned: parseInt(stats.assigned) || 0,
        inProgress: parseInt(stats.in_progress) || 0,
        resolved: parseInt(stats.resolved) || 0,
        rejected: parseInt(stats.rejected) || 0,
        totalRepairCost: parseFloat(stats.total_repair_cost) || 0,
        hostelRepairCost: parseFloat(stats.hostel_repair_cost) || 0,
        studentRepairCost: parseFloat(stats.student_repair_cost) || 0
      }
    });
  } catch (err) {
    console.error('Error fetching complaint stats:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch stats: ${err.message}`
    });
  }
}

/**
 * GET /api/complaints/:id
 * Retrieve full details of a specific complaint
 */
async function getComplaintDetails(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows } = await db.query(
      `SELECT c.*, 
              s.studentName, s.studentCustomId, s.phone, u.email,
              r.roomNumber, r.floor, r.block,
              b.bedLabel, b.bedNumber
       FROM complaints c
       JOIN students s ON c.studentId = s.id
       LEFT JOIN users u ON s.userId = u.id
       LEFT JOIN rooms r ON c.roomId = r.id
       LEFT JOIN beds b ON c.bedId = b.id
       WHERE c.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Complaint not found.' });
    }

    const complaint = rows[0];

    // Check permission: student can only view their own complaint
    if (req.user.role === 'student') {
      const { rows: studentRows } = await db.query(
        `SELECT id FROM students WHERE userId = $1`,
        [req.user.id]
      );
      if (studentRows.length === 0 || studentRows[0].id !== complaint.studentid) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
    }

    return res.status(200).json({
      success: true,
      complaint
    });
  } catch (err) {
    console.error('Error fetching complaint details:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch complaint details: ${err.message}`
    });
  }
}

/**
 * PUT /api/complaints/:id/assign
 * Admin / Manager assigns complaint to a technician/staff member
 */
async function assignComplaint(req, res) {
  try {
    const { id } = req.params;
    const { assignedTo, assignedPhone, adminRemarks, status } = req.body;

    if (!assignedTo || !assignedTo.trim()) {
      return res.status(400).json({ success: false, message: 'Technician / Staff name is required.' });
    }

    const db = await getDb();

    // Check complaint exists
    const { rows: checkRows } = await db.query(`SELECT * FROM complaints WHERE id = $1`, [id]);
    if (checkRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Complaint not found.' });
    }

    const current = checkRows[0];
    const newStatus = status || (current.status === 'Open' ? 'Assigned' : current.status);

    const { rows: updatedRows } = await db.query(
      `UPDATE complaints 
       SET assignedTo = $1,
           assignedPhone = $2,
           assignedAt = CURRENT_TIMESTAMP,
           status = $3,
           adminRemarks = COALESCE($4, adminRemarks),
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [
        assignedTo.trim(),
        assignedPhone ? assignedPhone.trim() : null,
        newStatus,
        adminRemarks ? adminRemarks.trim() : null,
        id
      ]
    );

    // Dispatch in-app & email notification to student
    createNotification({
      studentId: current.studentid,
      type: 'COMPLAINT_UPDATE',
      category: 'COMPLAINT',
      title: `Maintenance Ticket #${current.complaintnumber} Assigned`,
      message: `Your complaint ticket #${current.complaintnumber} has been assigned to ${assignedTo.trim()}. Status: ${newStatus}.`,
      sendEmail: true,
      emailOptions: {
        ticketNumber: current.complaintnumber,
        category: current.category,
        status: newStatus,
        assignedTo: assignedTo.trim(),
        adminRemarks: adminRemarks || current.adminremarks
      }
    }).catch(e => console.error('Notification error on assign complaint:', e.message));

    return res.status(200).json({
      success: true,
      message: `Complaint assigned to ${assignedTo.trim()}.`,
      complaint: updatedRows[0]
    });
  } catch (err) {
    console.error('Error assigning complaint:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to assign complaint: ${err.message}`
    });
  }
}

/**
 * PUT /api/complaints/:id/status
 * Admin / Manager updates complaint status, remarks, resolution notes, and repair costs
 */
async function updateComplaintStatus(req, res) {
  try {
    const { id } = req.params;
    const { 
      status, 
      adminRemarks, 
      resolutionNotes, 
      repairCost, 
      costPaidBy, 
      invoiceRef 
    } = req.body;

    const validStatuses = ['Open', 'Assigned', 'In Progress', 'Resolved', 'Rejected'];
    if (!status || !validStatuses.map(s => s.toLowerCase()).includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Normalize status string matching case
    const matchedStatus = validStatuses.find(s => s.toLowerCase() === status.toLowerCase());

    const db = await getDb();

    const { rows: existingRows } = await db.query(`SELECT * FROM complaints WHERE id = $1`, [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Complaint not found.' });
    }

    const current = existingRows[0];
    const isResolving = matchedStatus === 'Resolved';
    const resolvedAt = isResolving ? (current.resolvedAt || new Date()) : null;

    const parsedRepairCost = repairCost !== undefined && repairCost !== null ? Math.max(0, parseFloat(repairCost) || 0) : current.repaircost;
    const validPaidBy = ['Hostel', 'Student', 'Shared'].includes(costPaidBy) ? costPaidBy : (current.costpaidby || 'Hostel');

    const { rows: updatedRows } = await db.query(
      `UPDATE complaints 
       SET status = $1,
           adminRemarks = COALESCE($2, adminRemarks),
           resolutionNotes = COALESCE($3, resolutionNotes),
           repairCost = $4,
           costPaidBy = $5,
           invoiceRef = COALESCE($6, invoiceRef),
           resolvedAt = $7,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        matchedStatus,
        adminRemarks !== undefined ? adminRemarks : current.adminremarks,
        resolutionNotes !== undefined ? resolutionNotes : current.resolutionnotes,
        parsedRepairCost,
        validPaidBy,
        invoiceRef !== undefined ? invoiceRef : current.invoiceref,
        resolvedAt,
        id
      ]
    );

    return res.status(200).json({
      success: true,
      message: `Complaint ${updatedRows[0].complaintnumber} updated to status '${matchedStatus}'.`,
      complaint: updatedRows[0]
    });
  } catch (err) {
    console.error('Error updating complaint status:', err);
    return res.status(500).json({
      success: false,
      message: `Failed to update complaint: ${err.message}`
    });
  }
}

module.exports = {
  submitComplaint,
  getMyComplaints,
  getAllComplaints,
  getComplaintStats,
  getComplaintDetails,
  assignComplaint,
  updateComplaintStatus
};
