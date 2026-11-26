const nodemailer = require('nodemailer');

/**
 * Send payment receipt email to student
 * @param {Object} options Email options
 * @param {string} options.to Student email
 * @param {string} options.studentName Student name
 * @param {string} options.billingMonth Billing month (e.g. '2026-09')
 * @param {number} options.amount Paid amount
 * @param {string} options.receiptNumber Receipt number
 * @param {string} options.gatewayPaymentId Gateway payment ID
 * @param {Buffer} [options.pdfBuffer] Optional PDF attachment buffer
 */
async function sendPaymentReceiptEmail(options) {
  try {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || '"Akshaya Deluxe Hostel" <no-reply@akshayapg.com>';

    if (!host || !user || !pass) {
      console.log(`[EmailService] SMTP credentials not configured. Skipping email to ${options.to}.`);
      return { success: false, message: 'SMTP not configured' };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #004D47; padding: 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px;">Akshaya Deluxe Boys Hostel</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">Payment Confirmation Receipt</p>
        </div>
        <div style="padding: 24px; background-color: #ffffff;">
          <p style="font-size: 16px; color: #1e293b;">Dear <strong>${options.studentName}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">
            Thank you for your payment! We have received your hostel fee payment for <strong>${options.billingMonth}</strong>.
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px; color: #334155;">
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Receipt Number:</td>
                <td style="padding: 6px 0; text-align: right; color: #004D47; font-weight: bold;">${options.receiptNumber}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">Billing Cycle:</td>
                <td style="padding: 6px 0; text-align: right;">${options.billingMonth}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">Amount Paid:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #10b981;">₹${Number(options.amount).toLocaleString('en-IN')}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">Payment ID:</td>
                <td style="padding: 6px 0; text-align: right;">${options.gatewayPaymentId || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">Payment Status:</td>
                <td style="padding: 6px 0; text-align: right;"><span style="background-color: #ecfdf5; color: #065f46; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">PAID</span></td>
              </tr>
            </table>
          </div>
          <p style="color: #64748B; font-size: 13px; line-height: 1.4;">
            Your PDF receipt is attached to this email and is also available for download anytime in your 
            <a href="http://localhost:8080/student/dashboard.html" style="color: #004D47; font-weight: bold;">Student Portal</a>.
          </p>
        </div>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #64748B; font-size: 12px;">
          Akshaya Deluxe Boys Hostel • Opp. Aurora Engineering College, Avushapur, Ghatkesar<br>
          For queries, call +91 98852 97517.
        </div>
      </div>
    `;

    const mailOptions = {
      from,
      to: options.to,
      subject: `Hostel Fee Payment Receipt - ${options.billingMonth}`,
      html: htmlContent,
      attachments: options.pdfBuffer ? [
        {
          filename: `Receipt-${options.receiptNumber}.pdf`,
          content: options.pdfBuffer,
          contentType: 'application/pdf'
        }
      ] : []
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailService] Receipt email sent successfully to ${options.to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Email Delivery Error (Non-blocking):', err.message);
    return { success: false, error: err.message };
  }
}


/**
 * Send password reset email to student
 * @param {Object} options Email options
 * @param {string} options.to Student email
 * @param {string} options.studentName Student name
 * @param {string} options.resetUrl Password reset link
 */
async function sendPasswordResetEmail(options) {
  try {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || '"Akshaya Deluxe Hostel" <no-reply@akshayapg.com>';

    if (!host || !user || !pass) {
      console.log(`[EmailService] SMTP credentials not configured. Skipping password reset email to ${options.to}.`);
      return { success: false, message: 'SMTP not configured' };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #004D47; padding: 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px;">Akshaya Deluxe Boys Hostel</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">Password Reset Request</p>
        </div>
        <div style="padding: 24px; background-color: #ffffff;">
          <p style="font-size: 16px; color: #1e293b;">Hello <strong>${options.studentName || 'Student'}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            We received a request to reset the password for your Akshaya Deluxe Hostel account. Click the button below to choose a new password:
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${options.resetUrl}" style="background-color: #007a71; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 15px; display: inline-block;">
              Reset My Password
            </a>
          </div>
          <p style="color: #64748B; font-size: 13px; line-height: 1.5;">
            This link is valid for <strong>30 minutes</strong> and can only be used once. If you did not request a password reset, please ignore this email; your account remains secure.
          </p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="color: #94a3b8; font-size: 12px; word-break: break-all;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${options.resetUrl}" style="color: #007a71;">${options.resetUrl}</a>
          </p>
        </div>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #64748B; font-size: 12px;">
          Akshaya Deluxe Boys Hostel • Opp. Aurora Engineering College, Avushapur, Ghatkesar<br>
          For assistance, contact hostel management.
        </div>
      </div>
    `;

    const mailOptions = {
      from,
      to: options.to,
      subject: 'Password Reset Instructions - Akshaya Deluxe Hostel',
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailService] Password reset email sent to ${options.to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Password Reset Email Delivery Error:', err.message);
    return { success: false, error: err.message };
  }
}


/**
 * Send admission application status notification email
 * @param {Object} options Email options
 * @param {string} options.to Student email
 * @param {string} options.studentName Student name
 * @param {string} options.status Admission status ('APPROVED', 'REJECTED', 'CORRECTION_REQUIRED', 'CONFIRMED')
 * @param {string} [options.reason] Reason for rejection or correction details
 * @param {string} [options.roomNumber] Allocated room number
 * @param {string} [options.bedLabel] Allocated bed label
 * @param {string} [options.applicationId] Application ID
 */
async function sendAdmissionStatusEmail(options) {
  try {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || '"Akshaya Deluxe Hostel" <no-reply@akshayapg.com>';

    if (!host || !user || !pass) {
      console.log(`[EmailService] SMTP not configured. Skipping admission status email to ${options.to}.`);
      return { success: false, message: 'SMTP not configured' };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });

    const statusUpper = (options.status || '').toUpperCase();
    let badgeColor = '#0284c7';
    let statusTitle = 'Application Status Update';
    let statusMessage = '';

    if (statusUpper === 'APPROVED') {
      badgeColor = '#10b981';
      statusTitle = 'Admission Application Approved!';
      statusMessage = 'Congratulations! Your hostel admission application has been approved by the hostel administration. You can now log into your Student Portal to view your admission invoice and complete initial payment.';
    } else if (statusUpper === 'REJECTED') {
      badgeColor = '#ef4444';
      statusTitle = 'Admission Application Update';
      statusMessage = `We regret to inform you that your hostel admission application could not be approved at this time. Reason: ${options.reason || 'Criteria not met.'}`;
    } else if (statusUpper === 'CORRECTION_REQUIRED') {
      badgeColor = '#f59e0b';
      statusTitle = 'Application Action Required - Correction Needed';
      statusMessage = `Additional details or document corrections are required for your admission application: ${options.reason || 'Please verify your uploaded documents and details.'} Kindly update your details in the Student Portal.`;
    } else if (statusUpper === 'CONFIRMED' || statusUpper === 'ADMISSION_CONFIRMED') {
      badgeColor = '#004D47';
      statusTitle = 'Hostel Admission Confirmed & Room Allocated!';
      statusMessage = `Your admission has been officially confirmed! Room ${options.roomNumber || 'Assigned'} (Bed ${options.bedLabel || 'Assigned'}) has been allocated to you. Welcome to Akshaya Deluxe Hostel!`;
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #004D47; padding: 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px;">Akshaya Deluxe Boys Hostel</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">${statusTitle}</p>
        </div>
        <div style="padding: 24px; background-color: #ffffff;">
          <p style="font-size: 16px; color: #1e293b;">Dear <strong>${options.studentName || 'Student'}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">${statusMessage}</p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px; color: #334155;">
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Application ID:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold;">${options.applicationId || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">Status:</td>
                <td style="padding: 6px 0; text-align: right;">
                  <span style="background-color: ${badgeColor}15; color: ${badgeColor}; padding: 3px 10px; border-radius: 4px; font-weight: bold; font-size: 13px;">
                    ${statusUpper}
                  </span>
                </td>
              </tr>
              ${options.roomNumber ? `
              <tr>
                <td style="padding: 6px 0;">Assigned Room:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #004D47;">Room ${options.roomNumber} (${options.bedLabel || 'Bed'})</td>
              </tr>` : ''}
            </table>
          </div>
          <div style="text-align: center; margin: 24px 0;">
            <a href="http://localhost:8080/student-login.html" style="background-color: #004D47; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
              Access Student Portal
            </a>
          </div>
        </div>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #64748B; font-size: 12px;">
          Akshaya Deluxe Boys Hostel • Opp. Aurora Engineering College, Avushapur, Ghatkesar<br>
          For assistance, contact +91 98852 97517.
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from,
      to: options.to,
      subject: `${statusTitle} - Akshaya Deluxe Hostel`,
      html: htmlContent
    });
    console.log(`[EmailService] Admission status email sent to ${options.to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Admission Status Email Delivery Error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send monthly rent reminder or overdue notice email
 * @param {Object} options Email options
 * @param {string} options.to Student email
 * @param {string} options.studentName Student name
 * @param {string} options.billingMonth Billing month (e.g. '2026-10')
 * @param {number} options.amountDue Pending amount due
 * @param {string} [options.dueDate] Rent due date
 * @param {boolean} [options.isOverdue] Whether the payment is past due
 * @param {number} [options.lateFee] Late fee amount
 * @param {string} [options.invoiceNumber] Invoice number
 */
async function sendRentReminderEmail(options) {
  try {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || '"Akshaya Deluxe Hostel" <no-reply@akshayapg.com>';

    if (!host || !user || !pass) {
      console.log(`[EmailService] SMTP not configured. Skipping rent reminder email to ${options.to}.`);
      return { success: false, message: 'SMTP not configured' };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });

    const isOverdue = !!options.isOverdue;
    const subject = isOverdue
      ? `⚠️ URGENT: Overdue Hostel Rent Notice - ${options.billingMonth}`
      : `Hostel Rent Payment Reminder - ${options.billingMonth}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: ${isOverdue ? '#b91c1c' : '#004D47'}; padding: 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px;">Akshaya Deluxe Boys Hostel</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">
            ${isOverdue ? 'Overdue Rent Payment Notice' : 'Monthly Rent Payment Reminder'}
          </p>
        </div>
        <div style="padding: 24px; background-color: #ffffff;">
          <p style="font-size: 16px; color: #1e293b;">Dear <strong>${options.studentName || 'Resident'}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">
            ${isOverdue 
              ? `Your monthly hostel fee for <strong>${options.billingMonth}</strong> is currently overdue. Please clear your dues immediately to avoid disruption of hostel amenities.`
              : `This is a gentle reminder that your monthly hostel rent for <strong>${options.billingMonth}</strong> is due for payment.`}
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px; color: #334155;">
              ${options.invoiceNumber ? `
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Invoice Number:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #004D47;">${options.invoiceNumber}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 6px 0;">Billing Month:</td>
                <td style="padding: 6px 0; text-align: right;">${options.billingMonth}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">Amount Due:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold; color: ${isOverdue ? '#dc2626' : '#004D47'}; font-size: 16px;">
                  ₹${Number(options.amountDue).toLocaleString('en-IN')}
                </td>
              </tr>
              ${options.lateFee && Number(options.lateFee) > 0 ? `
              <tr>
                <td style="padding: 6px 0; color: #dc2626;">Late Fee Included:</td>
                <td style="padding: 6px 0; text-align: right; color: #dc2626; font-weight: bold;">₹${Number(options.lateFee).toLocaleString('en-IN')}</td>
              </tr>` : ''}
              ${options.dueDate ? `
              <tr>
                <td style="padding: 6px 0;">Due Date:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold;">${options.dueDate}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 6px 0;">Status:</td>
                <td style="padding: 6px 0; text-align: right;">
                  <span style="background-color: ${isOverdue ? '#fee2e2' : '#fef3c7'}; color: ${isOverdue ? '#b91c1c' : '#b45309'}; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">
                    ${isOverdue ? 'OVERDUE' : 'DUE SOON'}
                  </span>
                </td>
              </tr>
            </table>
          </div>
          <div style="text-align: center; margin: 24px 0;">
            <a href="http://localhost:8080/student/dashboard.html" style="background-color: ${isOverdue ? '#dc2626' : '#004D47'}; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
              Pay Now via Student Portal
            </a>
          </div>
          <p style="color: #64748B; font-size: 13px; line-height: 1.4;">
            Payments can be completed online via UPI, NetBanking, Credit/Debit Cards, or offline at the hostel management desk.
          </p>
        </div>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #64748B; font-size: 12px;">
          Akshaya Deluxe Boys Hostel • Opp. Aurora Engineering College, Avushapur, Ghatkesar<br>
          For queries, call +91 98852 97517.
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from,
      to: options.to,
      subject,
      html: htmlContent
    });
    console.log(`[EmailService] Rent reminder email sent to ${options.to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Rent Reminder Email Delivery Error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send Check-In or Check-Out notification email
 * @param {Object} options Email options
 * @param {string} options.to Student email
 * @param {string} options.studentName Student name
 * @param {string} options.type 'CHECK_IN' or 'CHECK_OUT'
 * @param {string} options.date Event date
 * @param {string} [options.roomNumber] Room number
 * @param {string} [options.bedLabel] Bed label
 * @param {number} [options.settlementAmount] Net refund or pending charges
 * @param {string} [options.depositStatus] Deposit status
 * @param {string} [options.notes] Remarks or notes
 */
async function sendStayStatusEmail(options) {
  try {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || '"Akshaya Deluxe Hostel" <no-reply@akshayapg.com>';

    if (!host || !user || !pass) {
      console.log(`[EmailService] SMTP not configured. Skipping stay notification email to ${options.to}.`);
      return { success: false, message: 'SMTP not configured' };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });

    const isCheckIn = options.type === 'CHECK_IN';
    const title = isCheckIn ? 'Hostel Check-In Confirmation' : 'Hostel Check-Out & Settlement Summary';

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #004D47; padding: 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px;">Akshaya Deluxe Boys Hostel</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">${title}</p>
        </div>
        <div style="padding: 24px; background-color: #ffffff;">
          <p style="font-size: 16px; color: #1e293b;">Dear <strong>${options.studentName || 'Student'}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">
            ${isCheckIn 
              ? `Welcome! Your check-in to Akshaya Deluxe Hostel has been successfully recorded. Your room is active and ready for occupancy.`
              : `Your hostel departure and checkout have been successfully processed. Thank you for your stay with us!`}
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px; color: #334155;">
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Date:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold;">${options.date || new Date().toLocaleDateString('en-IN')}</td>
              </tr>
              ${options.roomNumber ? `
              <tr>
                <td style="padding: 6px 0;">Room & Bed:</td>
                <td style="padding: 6px 0; text-align: right;">Room ${options.roomNumber} (${options.bedLabel || 'Bed'})</td>
              </tr>` : ''}
              ${options.depositStatus ? `
              <tr>
                <td style="padding: 6px 0;">Security Deposit Status:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold;">${options.depositStatus}</td>
              </tr>` : ''}
              ${options.settlementAmount !== undefined ? `
              <tr>
                <td style="padding: 6px 0;">Settlement Net Refund:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #10b981;">₹${Number(options.settlementAmount).toLocaleString('en-IN')}</td>
              </tr>` : ''}
              ${options.notes ? `
              <tr>
                <td style="padding: 6px 0;">Remarks:</td>
                <td style="padding: 6px 0; text-align: right; color: #64748B;">${options.notes}</td>
              </tr>` : ''}
            </table>
          </div>
          <div style="text-align: center; margin: 24px 0;">
            <a href="http://localhost:8080/student/dashboard.html" style="background-color: #004D47; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
              View in Student Portal
            </a>
          </div>
        </div>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #64748B; font-size: 12px;">
          Akshaya Deluxe Boys Hostel • Opp. Aurora Engineering College, Avushapur, Ghatkesar<br>
          For queries, call +91 98852 97517.
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from,
      to: options.to,
      subject: `${title} - Akshaya Deluxe Hostel`,
      html: htmlContent
    });
    console.log(`[EmailService] Stay notification email sent to ${options.to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Stay Notification Email Delivery Error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send complaint status update notification email
 * @param {Object} options Email options
 * @param {string} options.to Student email
 * @param {string} options.studentName Student name
 * @param {string} options.ticketNumber Complaint ticket number
 * @param {string} options.category Category of complaint
 * @param {string} options.status Updated status
 * @param {string} [options.adminRemarks] Admin remarks / resolution notes
 * @param {string} [options.assignedTo] Assigned staff name
 */
async function sendComplaintStatusEmail(options) {
  try {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || '"Akshaya Deluxe Hostel" <no-reply@akshayapg.com>';

    if (!host || !user || !pass) {
      console.log(`[EmailService] SMTP not configured. Skipping complaint status email to ${options.to}.`);
      return { success: false, message: 'SMTP not configured' };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });

    const statusUpper = (options.status || '').toUpperCase();
    let badgeColor = '#3b82f6';
    if (statusUpper === 'RESOLVED') badgeColor = '#10b981';
    else if (statusUpper === 'REJECTED') badgeColor = '#ef4444';
    else if (statusUpper === 'IN_PROGRESS' || statusUpper === 'IN PROGRESS') badgeColor = '#f59e0b';

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #004D47; padding: 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px;">Akshaya Deluxe Boys Hostel</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">Maintenance Ticket Status Update</p>
        </div>
        <div style="padding: 24px; background-color: #ffffff;">
          <p style="font-size: 16px; color: #1e293b;">Dear <strong>${options.studentName || 'Resident'}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">
            There has been a status update on your maintenance complaint ticket <strong>#${options.ticketNumber}</strong>.
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px; color: #334155;">
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Ticket Number:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #004D47;">#${options.ticketNumber}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">Category:</td>
                <td style="padding: 6px 0; text-align: right;">${options.category || 'General'}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0;">Status:</td>
                <td style="padding: 6px 0; text-align: right;">
                  <span style="background-color: ${badgeColor}15; color: ${badgeColor}; padding: 3px 10px; border-radius: 4px; font-weight: bold; font-size: 12px;">
                    ${statusUpper}
                  </span>
                </td>
              </tr>
              ${options.assignedTo ? `
              <tr>
                <td style="padding: 6px 0;">Assigned To:</td>
                <td style="padding: 6px 0; text-align: right;">${options.assignedTo}</td>
              </tr>` : ''}
              ${options.adminRemarks ? `
              <tr>
                <td style="padding: 6px 0; font-weight: bold;">Staff Remarks:</td>
                <td style="padding: 6px 0; text-align: right; color: #1e293b;">${options.adminRemarks}</td>
              </tr>` : ''}
            </table>
          </div>
          <div style="text-align: center; margin: 24px 0;">
            <a href="http://localhost:8080/student/dashboard.html" style="background-color: #004D47; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
              View Ticket Details
            </a>
          </div>
        </div>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #64748B; font-size: 12px;">
          Akshaya Deluxe Boys Hostel • Opp. Aurora Engineering College, Avushapur, Ghatkesar<br>
          For queries, call +91 98852 97517.
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from,
      to: options.to,
      subject: `Maintenance Ticket #${options.ticketNumber} Status: ${statusUpper} - Akshaya Deluxe Hostel`,
      html: htmlContent
    });
    console.log(`[EmailService] Complaint status email sent to ${options.to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Complaint Status Email Delivery Error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send Hostel Announcement email
 * @param {Object} options Email options
 * @param {string} options.to Student email
 * @param {string} options.studentName Student name
 * @param {string} options.title Announcement title
 * @param {string} options.content Announcement content
 * @param {string} [options.category] Announcement category
 * @param {string} [options.priority] Priority
 * @param {string} [options.postedBy] Author
 */
async function sendAnnouncementEmail(options) {
  try {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || '"Akshaya Deluxe Hostel" <no-reply@akshayapg.com>';

    if (!host || !user || !pass) {
      console.log(`[EmailService] SMTP not configured. Skipping announcement email to ${options.to}.`);
      return { success: false, message: 'SMTP not configured' };
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass }
    });

    const isUrgent = (options.priority || '').toUpperCase() === 'URGENT';

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: ${isUrgent ? '#b91c1c' : '#004D47'}; padding: 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px;">Akshaya Deluxe Boys Hostel</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">
            ${isUrgent ? 'URGENT NOTICE' : 'Hostel Board Announcement'}
          </p>
        </div>
        <div style="padding: 24px; background-color: #ffffff;">
          <p style="font-size: 16px; color: #1e293b;">Dear <strong>${options.studentName || 'Resident'}</strong>,</p>
          <div style="background-color: #f8fafc; border-left: 4px solid ${isUrgent ? '#dc2626' : '#004D47'}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
            <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 16px;">${options.title}</h3>
            <p style="margin: 0; color: #334155; font-size: 14px; line-height: 1.6; white-space: pre-line;">${options.content}</p>
          </div>
          <p style="color: #64748B; font-size: 12px; margin-top: 12px;">
            Category: <strong>${options.category || 'General'}</strong> | Posted by: <strong>${options.postedBy || 'Hostel Administration'}</strong>
          </p>
        </div>
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #64748B; font-size: 12px;">
          Akshaya Deluxe Boys Hostel • Opp. Aurora Engineering College, Avushapur, Ghatkesar<br>
          For queries, call +91 98852 97517.
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from,
      to: options.to,
      subject: `${isUrgent ? '[URGENT] ' : ''}${options.title} - Akshaya Deluxe Hostel`,
      html: htmlContent
    });
    console.log(`[EmailService] Announcement email sent to ${options.to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EmailService] Announcement Email Delivery Error:', err.message);
    return { success: false, error: err.message };
  }
}


module.exports = {
  sendPaymentReceiptEmail,
  sendPasswordResetEmail,
  sendAdmissionStatusEmail,
  sendRentReminderEmail,
  sendStayStatusEmail,
  sendComplaintStatusEmail,
  sendAnnouncementEmail
};

