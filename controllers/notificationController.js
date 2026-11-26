const { getDb } = require('../config/db');
const { broadcastAnnouncement, createNotification } = require('../services/notificationService');

// 1. Get notifications for Admin
async function getNotifications(req, res) {
  try {
    const db = await getDb();
    const { category, unreadOnly, limit = 50 } = req.query;

    let query = `
      SELECT n.*, s.studentName, s.studentCustomId, r.roomNumber
      FROM notifications n
      LEFT JOIN students s ON n.studentId = s.id
      LEFT JOIN rooms r ON s.roomId = r.id
      WHERE (n.userId IS NULL OR n.userId = $1 OR n.category IN ('ADMISSION', 'PAYMENT', 'COMPLAINT', 'GENERAL'))
    `;
    const params = [req.user.id];

    if (category && category !== 'ALL') {
      params.push(category.toUpperCase());
      query += ` AND UPPER(n.category) = $${params.length}`;
    }

    if (unreadOnly === 'true' || unreadOnly === '1') {
      query += ` AND n.isRead = 0`;
    }

    query += ` ORDER BY n.id DESC LIMIT $${params.length + 1}`;
    params.push(Number(limit) || 50);

    const { rows: notifications } = await db.query(query, params);

    // Unread count for admin
    const { rows: unreadRows } = await db.query(`
      SELECT COUNT(*) as count 
      FROM notifications 
      WHERE (userId IS NULL OR userId = $1 OR category IN ('ADMISSION', 'PAYMENT', 'COMPLAINT', 'GENERAL'))
        AND isRead = 0
    `, [req.user.id]);

    const unreadCount = parseInt(unreadRows[0]?.count || 0, 10);

    res.status(200).json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (err) {
    console.error('Get Notifications Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 2. Get notifications for Logged-In Student
async function getMyNotifications(req, res) {
  try {
    const db = await getDb();
    
    // Find student mapped to user
    const { rows: studentRows } = await db.query(
      'SELECT id, studentName FROM students WHERE userId = $1',
      [req.user.id]
    );
    const student = studentRows[0] || null;
    const studentId = student ? student.id : null;

    let query = `
      SELECT n.*
      FROM notifications n
      WHERE (n.userId = $1 ${studentId ? 'OR n.studentId = $2' : ''} OR (n.userId IS NULL AND n.studentId IS NULL AND n.category IN ('ANNOUNCEMENT', 'MAINTENANCE', 'HOSTEL', 'DINING', 'GENERAL')))
      ORDER BY n.id DESC
      LIMIT 50
    `;
    const params = studentId ? [req.user.id, studentId] : [req.user.id];

    const { rows: notifications } = await db.query(query, params);

    let countQuery = `
      SELECT COUNT(*) as count
      FROM notifications n
      WHERE (n.userId = $1 ${studentId ? 'OR n.studentId = $2' : ''} OR (n.userId IS NULL AND n.studentId IS NULL AND n.category IN ('ANNOUNCEMENT', 'MAINTENANCE', 'HOSTEL', 'DINING', 'GENERAL')))
        AND n.isRead = 0
    `;
    const { rows: unreadRows } = await db.query(countQuery, params);
    const unreadCount = parseInt(unreadRows[0]?.count || 0, 10);

    res.status(200).json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (err) {
    console.error('Get My Notifications Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 3. Mark Single Notification as Read
async function markAsRead(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows, rowCount } = await db.query(
      'UPDATE notifications SET isRead = 1, readAt = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }

    res.status(200).json({ success: true, message: 'Notification marked as read.', notification: rows[0] });
  } catch (err) {
    console.error('Mark Read Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 4. Mark All Notifications as Read for current user
async function markAllAsRead(req, res) {
  try {
    const db = await getDb();
    const isStudent = req.user.role === 'student';

    if (isStudent) {
      const { rows: studentRows } = await db.query('SELECT id FROM students WHERE userId = $1', [req.user.id]);
      const studentId = studentRows[0]?.id;

      if (studentId) {
        await db.query(
          'UPDATE notifications SET isRead = 1, readAt = CURRENT_TIMESTAMP WHERE (userId = $1 OR studentId = $2) AND isRead = 0',
          [req.user.id, studentId]
        );
      } else {
        await db.query(
          'UPDATE notifications SET isRead = 1, readAt = CURRENT_TIMESTAMP WHERE userId = $1 AND isRead = 0',
          [req.user.id]
        );
      }
    } else {
      // Admin / Manager marks all admin notifications as read
      await db.query(
        'UPDATE notifications SET isRead = 1, readAt = CURRENT_TIMESTAMP WHERE (userId IS NULL OR userId = $1 OR category IN (\'ADMISSION\', \'PAYMENT\', \'COMPLAINT\', \'GENERAL\')) AND isRead = 0',
        [req.user.id]
      );
    }

    res.status(200).json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('Mark All Read Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 5. Delete a Notification
async function deleteNotification(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rowCount } = await db.query('DELETE FROM notifications WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }

    res.status(200).json({ success: true, message: 'Notification deleted successfully.' });
  } catch (err) {
    console.error('Delete Notification Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ==================== ANNOUNCEMENTS SECTION ==================== //

// 6. Get active announcements for students/residents
async function getActiveAnnouncements(req, res) {
  try {
    const db = await getDb();
    const { category, limit = 20 } = req.query;

    let query = `
      SELECT *
      FROM announcements
      WHERE isActive = true
    `;
    const params = [];

    if (category && category !== 'ALL') {
      params.push(category.toUpperCase());
      query += ` AND UPPER(category) = $${params.length}`;
    }

    query += `
      ORDER BY 
        CASE priority 
          WHEN 'Urgent' THEN 1 
          WHEN 'Important' THEN 2 
          ELSE 3 
        END,
        createdAt DESC
      LIMIT $${params.length + 1}
    `;
    params.push(Number(limit) || 20);

    const { rows: announcements } = await db.query(query, params);
    res.status(200).json({ success: true, announcements });
  } catch (err) {
    console.error('Get Active Announcements Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 7. Get all announcements for Admin
async function getAllAdminAnnouncements(req, res) {
  try {
    const db = await getDb();
    const { rows: announcements } = await db.query(
      'SELECT * FROM announcements ORDER BY createdAt DESC'
    );
    res.status(200).json({ success: true, announcements });
  } catch (err) {
    console.error('Get Admin Announcements Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 8. Create announcement (Admin)
async function createAnnouncement(req, res) {
  try {
    const {
      title,
      content,
      category = 'HOSTEL',
      priority = 'Normal',
      targetAudience = 'ALL',
      sendInAppNotification = true,
      sendEmailBroadcast = false
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Announcement title and content are required.' });
    }

    const db = await getDb();
    const postedBy = req.user.name || 'Hostel Administration';

    const { rows } = await db.query(`
      INSERT INTO announcements (title, content, category, priority, targetAudience, isActive, postedBy, createdAt, updatedAt)
      VALUES ($1, $2, $3, $4, $5, TRUE, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `, [title.trim(), content.trim(), category.toUpperCase(), priority, targetAudience, postedBy]);

    const newAnnouncement = rows[0];

    // Trigger broadcast if requested
    let broadcastResult = null;
    if (sendInAppNotification || sendEmailBroadcast || priority === 'Urgent') {
      broadcastResult = await broadcastAnnouncement({
        announcementId: newAnnouncement.id,
        title: newAnnouncement.title,
        content: newAnnouncement.content,
        category: newAnnouncement.category,
        priority: newAnnouncement.priority,
        targetAudience: newAnnouncement.targetaudience,
        sendEmailBroadcast: !!sendEmailBroadcast
      });
    }

    res.status(201).json({
      success: true,
      message: 'Announcement published successfully.',
      announcement: newAnnouncement,
      broadcast: broadcastResult
    });
  } catch (err) {
    console.error('Create Announcement Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 9. Update announcement
async function updateAnnouncement(req, res) {
  try {
    const { id } = req.params;
    const { title, content, category, priority, targetAudience, isActive } = req.body;

    const db = await getDb();
    const { rows, rowCount } = await db.query(`
      UPDATE announcements
      SET title = COALESCE($1, title),
          content = COALESCE($2, content),
          category = COALESCE($3, category),
          priority = COALESCE($4, priority),
          targetAudience = COALESCE($5, targetAudience),
          isActive = COALESCE($6, isActive),
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `, [
      title ? title.trim() : null,
      content ? content.trim() : null,
      category ? category.toUpperCase() : null,
      priority || null,
      targetAudience || null,
      isActive !== undefined ? isActive : null,
      id
    ]);

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }

    res.status(200).json({
      success: true,
      message: 'Announcement updated successfully.',
      announcement: rows[0]
    });
  } catch (err) {
    console.error('Update Announcement Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 10. Toggle announcement status
async function toggleAnnouncement(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rows, rowCount } = await db.query(`
      UPDATE announcements
      SET isActive = NOT isActive, updatedAt = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }

    res.status(200).json({
      success: true,
      message: `Announcement marked as ${rows[0].isactive ? 'Active' : 'Inactive'}.`,
      announcement: rows[0]
    });
  } catch (err) {
    console.error('Toggle Announcement Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 11. Delete announcement
async function deleteAnnouncement(req, res) {
  try {
    const { id } = req.params;
    const db = await getDb();

    const { rowCount } = await db.query('DELETE FROM announcements WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }

    res.status(200).json({ success: true, message: 'Announcement deleted successfully.' });
  } catch (err) {
    console.error('Delete Announcement Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ==================== BACKWARD COMPATIBILITY COMPLAINTS ==================== //
async function submitComplaint(req, res) {
  try {
    const complaintController = require('./complaintController');
    return complaintController.submitComplaint(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getMyComplaints(req, res) {
  try {
    const complaintController = require('./complaintController');
    return complaintController.getMyComplaints(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getAllComplaints(req, res) {
  try {
    const complaintController = require('./complaintController');
    return complaintController.getAllComplaints(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function resolveComplaint(req, res) {
  try {
    const complaintController = require('./complaintController');
    return complaintController.updateComplaintStatus(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  // In-app notifications
  getNotifications,
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,

  // Announcements
  getActiveAnnouncements,
  getAllAdminAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  toggleAnnouncement,
  deleteAnnouncement,

  // Backward-compat complaints
  submitComplaint,
  getMyComplaints,
  getAllComplaints,
  resolveComplaint
};
