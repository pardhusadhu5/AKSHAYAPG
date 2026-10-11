/**
 * WhatsApp Messaging Service for Akshaya Deluxe Hostel
 * Supports:
 * 1. Meta WhatsApp Business Cloud API (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)
 * 2. Twilio WhatsApp Messaging (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER)
 * 3. Generic WhatsApp Gateway / Webhook (WHATSAPP_API_URL, WHATSAPP_API_KEY)
 * 
 * Includes status tracking, phone normalization (+91), deduplication, and error resilience.
 */

const { getDb } = require('../config/db');

/**
 * Format phone number for WhatsApp with +91 country code
 * @param {string} rawPhone 
 * @returns {string} E.164 formatted number e.g. "919885297517"
 */
function normalizeWhatsAppPhone(rawPhone) {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  return digits;
}

/**
 * Send WhatsApp Welcome Message to an approved student
 * @param {object} student 
 * @returns {Promise<{ success: boolean, status: string, messageId?: string, error?: string }>}
 */
async function sendWelcomeWhatsApp(student) {
  if (!student || !student.id) {
    return { success: false, status: 'INVALID_STUDENT', error: 'Student record missing' };
  }

  const db = await getDb();
  const studentId = student.id;
  const rawPhone = student.phone || student.mobile;
  const phone = normalizeWhatsAppPhone(rawPhone);
  const studentName = student.studentName || student.studentname || student.name || 'Student';
  const appId = student.applicationId || student.applicationid || `AKS-APP-${studentId}`;

  if (!phone || phone.length < 10) {
    const errorMsg = 'Invalid phone number format for WhatsApp delivery.';
    await db.query(
      `UPDATE students SET whatsappStatus = 'FAILED', whatsappError = $1, updatedAt = CURRENT_TIMESTAMP WHERE id = $2`,
      [errorMsg, studentId]
    ).catch(() => {});
    return { success: false, status: 'FAILED', error: errorMsg };
  }

  // Idempotency check: verify welcome message hasn't already been sent
  const { rows: existingRows } = await db.query(
    `SELECT whatsappStatus FROM students WHERE id = $1`,
    [studentId]
  );
  if (existingRows.length > 0 && existingRows[0].whatsappstatus === 'SENT') {
    console.log(`[WhatsApp] Welcome message already sent to student #${studentId} (${phone}). Skipping duplicate.`);
    return { success: true, status: 'ALREADY_SENT', message: 'Welcome message already sent' };
  }

  const welcomeMessage = `Welcome to Akshaya Deluxe Hostel, ${studentName}! 🎉\n\nYour admission application (${appId}) has been APPROVED by the hostel administration.\n\nYou can now log in to the Student Portal using your registered mobile number (${rawPhone}) and password:\nhttps://akshayapg.onrender.com/student-login.html\n\nWe look forward to welcoming you! For queries, contact hostel support at +91 98852 97517.`;

  // Detect configured messaging provider
  const metaToken = process.env.WHATSAPP_TOKEN || process.env.META_WHATSAPP_TOKEN;
  const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

  const genericUrl = process.env.WHATSAPP_API_URL;
  const genericKey = process.env.WHATSAPP_API_KEY;

  let providerStatus = 'PENDING_PROVIDER_SETUP';
  let messageId = null;
  let deliveryError = null;

  try {
    if (metaToken && metaPhoneId) {
      // 1. Meta WhatsApp Cloud API
      const response = await fetch(`https://graph.facebook.com/v20.0/${metaPhoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${metaToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'text',
          text: { preview_url: true, body: welcomeMessage }
        })
      });

      const resData = await response.json();
      if (response.ok && resData.messages && resData.messages[0]) {
        providerStatus = 'SENT';
        messageId = resData.messages[0].id;
      } else {
        providerStatus = 'FAILED';
        deliveryError = (resData.error && resData.error.message) || JSON.stringify(resData);
      }
    } else if (twilioSid && twilioAuth) {
      // 2. Twilio WhatsApp API
      const twilioEndpoint = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const formParams = new URLSearchParams();
      formParams.append('From', twilioFrom.startsWith('whatsapp:') ? twilioFrom : `whatsapp:${twilioFrom}`);
      formParams.append('To', `whatsapp:+${phone}`);
      formParams.append('Body', welcomeMessage);

      const response = await fetch(twilioEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formParams.toString()
      });

      const resData = await response.json();
      if (response.ok && resData.sid) {
        providerStatus = 'SENT';
        messageId = resData.sid;
      } else {
        providerStatus = 'FAILED';
        deliveryError = resData.message || JSON.stringify(resData);
      }
    } else if (genericUrl) {
      // 3. Generic WhatsApp Gateway
      const response = await fetch(genericUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(genericKey ? { 'Authorization': `Bearer ${genericKey}` } : {})
        },
        body: JSON.stringify({
          phone: `+${phone}`,
          message: welcomeMessage
        })
      });

      const resData = await response.json().catch(() => ({}));
      if (response.ok) {
        providerStatus = 'SENT';
        messageId = resData.messageId || resData.id || `MSG-${Date.now()}`;
      } else {
        providerStatus = 'FAILED';
        deliveryError = resData.error || `HTTP ${response.status}`;
      }
    } else {
      // No external provider configured in environment
      providerStatus = 'PENDING_PROVIDER_SETUP';
      deliveryError = 'WhatsApp provider credentials not configured. Configure WHATSAPP_TOKEN & WHATSAPP_PHONE_NUMBER_ID or TWILIO credentials in environment.';
      console.log(`[WhatsApp Service] ${deliveryError}`);
    }
  } catch (err) {
    providerStatus = 'FAILED';
    deliveryError = err.message;
    console.error('[WhatsApp Service] Delivery Exception:', err);
  }

  // Record delivery status in database
  try {
    await db.query(
      `UPDATE students 
       SET whatsappStatus = $1, 
           whatsappSentAt = ${providerStatus === 'SENT' ? 'CURRENT_TIMESTAMP' : 'NULL'}, 
           whatsappMessageId = $2, 
           whatsappError = $3, 
           updatedAt = CURRENT_TIMESTAMP 
       WHERE id = $4`,
      [providerStatus, messageId, deliveryError, studentId]
    );

    // Record in reminders table for audit trail
    await db.query(
      `INSERT INTO reminders (studentId, title, message, channel, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        studentId,
        'Welcome & Admission Approval',
        welcomeMessage,
        'whatsapp',
        providerStatus.toLowerCase()
      ]
    );
  } catch (dbErr) {
    console.error('[WhatsApp Service] Error recording status in database:', dbErr);
  }

  return {
    success: providerStatus === 'SENT',
    status: providerStatus,
    messageId,
    error: deliveryError
  };
}

module.exports = {
  sendWelcomeWhatsApp,
  normalizeWhatsAppPhone
};
