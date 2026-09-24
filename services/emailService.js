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

module.exports = { sendPaymentReceiptEmail };
