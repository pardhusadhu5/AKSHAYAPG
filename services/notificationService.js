const { getDb } = require('../config/db');
const emailService = require('./emailService');

/**
 * Unified notification helper
 * Creates an in-app notification row and optionally dispatches non-blocking transactional email
 */
async function createNotification({
  userId = null,
  studentId = null,
  type = 'GENERAL',
  title = '',
  message = '',
  category = 'GENERAL',
  channel = 'IN_APP',
  metadata = null,
  sendEmail = false,
  emailOptions = null
}) {
  try {
    const db = await getDb();

    let resolvedUserId = userId;
    let resolvedStudentId = studentId;
    let recipientEmail = emailOptions?.to || null;
    let studentName = emailOptions?.studentName || null;

    // Resolve missing userId / studentId / email if needed
    if (!resolvedUserId && resolvedStudentId) {
      const { rows } = await db.query(
        'SELECT s.userId, s.studentName, u.email as uEmail FROM students s LEFT JOIN users u ON s.userId = u.id WHERE s.id = $1',
        [resolvedStudentId]
      );
      if (rows.length > 0) {
        resolvedUserId = rows[0].userid;
        if (!recipientEmail) recipientEmail = rows[0].uemail;
        if (!studentName) studentName = rows[0].studentname;
      }
    } else if (resolvedUserId && !resolvedStudentId) {
      const { rows } = await db.query(
        'SELECT s.id as studentId, s.studentName, u.email FROM users u LEFT JOIN students s ON s.userId = u.id WHERE u.id = $1',
        [resolvedUserId]
      );
      if (rows.length > 0) {
        resolvedStudentId = rows[0].studentid;
        if (!recipientEmail) recipientEmail = rows[0].email;
        if (!studentName) studentName = rows[0].studentname;
      }
    }

    const jsonMetadata = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

    const { rows: inserted } = await db.query(`
      INSERT INTO notifications (userId, studentId, type, title, message, category, channel, metadata, isRead, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, CURRENT_TIMESTAMP)
      RETURNING *
    `, [resolvedUserId, resolvedStudentId, type, title, message, category, channel, jsonMetadata]);

    const created = inserted[0];

    // Trigger non-blocking transactional email if requested
    if (sendEmail && recipientEmail) {
      const emailPayload = {
        to: recipientEmail,
        studentName: studentName || 'Resident',
        ...(emailOptions || {})
      };

      setImmediate(async () => {
        try {
          const emailType = emailOptions?.emailType || type;
          if (emailType === 'ADMISSION' || emailType === 'admission_status') {
            await emailService.sendAdmissionStatusEmail(emailPayload);
          } else if (emailType === 'RENT_DUE' || emailType === 'RENT_OVERDUE' || emailType === 'rent_reminder') {
            await emailService.sendRentReminderEmail(emailPayload);
          } else if (emailType === 'STAY_CHECKIN' || emailType === 'STAY_CHECKOUT' || emailType === 'stay_status') {
            await emailService.sendStayStatusEmail(emailPayload);
          } else if (emailType === 'COMPLAINT_UPDATE' || emailType === 'complaint_status') {
            await emailService.sendComplaintStatusEmail(emailPayload);
          } else if (emailType === 'ANNOUNCEMENT' || emailType === 'announcement') {
            await emailService.sendAnnouncementEmail(emailPayload);
          }
        } catch (emailErr) {
          console.error('[NotificationService] Async Email Dispatch Error:', emailErr.message);
        }
      });
    }

    return created;
  } catch (err) {
    console.error('[NotificationService] Error creating notification:', err.message);
    return null;
  }
}

/**
 * Broadcast announcement to active students
 */
async function broadcastAnnouncement({
  announcementId,
  title,
  content,
  category = 'HOSTEL',
  priority = 'Normal',
  targetAudience = 'ALL',
  sendEmailBroadcast = false
}) {
  try {
    const db = await getDb();
    
    // Fetch target active students
    let studentQuery = `
      SELECT s.id as studentId, s.userId, s.studentName, u.email as uEmail, r.roomNumber
      FROM students s
      JOIN users u ON s.userId = u.id
      LEFT JOIN rooms r ON s.roomId = r.id
      WHERE s.status = 'active'
    `;

    if (targetAudience === 'FLOOR_1') {
      studentQuery += ` AND r.floor ILIKE '%Floor 1%'`;
    } else if (targetAudience === 'FLOOR_2') {
      studentQuery += ` AND r.floor ILIKE '%Floor 2%'`;
    } else if (targetAudience === 'PENTHOUSE') {
      studentQuery += ` AND (r.floor ILIKE '%Floor 3%' OR r.floor ILIKE '%Penthouse%')`;
    }

    const { rows: students } = await db.query(studentQuery);

    for (const s of students) {
      await createNotification({
        userId: s.userid,
        studentId: s.studentid,
        type: 'ANNOUNCEMENT',
        title: `${priority === 'Urgent' ? '⚠️ [Urgent] ' : ''}${title}`,
        message: content,
        category: category.toUpperCase(),
        channel: 'IN_APP',
        metadata: { announcementId, priority, targetAudience },
        sendEmail: sendEmailBroadcast || priority === 'Urgent',
        emailOptions: {
          to: s.uemail,
          studentName: s.studentname,
          emailType: 'announcement',
          title,
          content,
          category,
          priority
        }
      });
    }

    return { totalNotified: students.length };
  } catch (err) {
    console.error('[NotificationService] Broadcast announcement error:', err.message);
    return { totalNotified: 0, error: err.message };
  }
}

module.exports = {
  createNotification,
  broadcastAnnouncement
};
