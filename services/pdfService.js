const PDFDocument = require('pdfkit');

/**
 * Generate a PDF receipt for a hostel fee payment
 * @param {Object} data Payment receipt details
 * @returns {Promise<Buffer>} PDF Buffer
 */
function generateReceiptPDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];

      doc.on('data', buffer => buffers.push(buffer));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', err => reject(err));

      // Brand Color Palette
      const primaryColor = '#004D47';
      const accentColor = '#D4AF37';
      const darkSlate = '#1E293B';
      const lightBg = '#F8FAFC';

      // Header Banner Box
      doc
        .rect(0, 0, doc.page.width, 110)
        .fill(primaryColor);

      // Hostel Name & Subtitle
      doc
        .fillColor('#FFFFFF')
        .fontSize(22)
        .font('Helvetica-Bold')
        .text('AKSHAYA DELUXE BOYS HOSTEL', 50, 30, { align: 'left' });

      doc
        .fontSize(10)
        .font('Helvetica')
        .text('Opp. Aurora Engineering College, Avushapur, Ghatkesar, Hyderabad', 50, 60)
        .text('Contact: +91 98852 97517 | Email: support@akshayapg.com', 50, 75);

      // Title Banner Badge
      doc
        .fillColor(accentColor)
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('FEE PAYMENT RECEIPT', 50, 35, { align: 'right' });

      doc
        .fillColor('#FFFFFF')
        .fontSize(10)
        .font('Helvetica')
        .text(`Receipt #: ${data.receiptNumber || 'N/A'}`, 50, 60, { align: 'right' })
        .text(`Date: ${data.date || new Date().toISOString().split('T')[0]}`, 50, 75, { align: 'right' });

      doc.moveDown(4);

      // Status Badge Box
      const statusY = 130;
      doc
        .rect(50, statusY, doc.page.width - 100, 36)
        .fill('#ECFDF5')
        .stroke('#10B981');

      doc
        .fillColor('#065F46')
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(`STATUS: ${data.status ? data.status.toUpperCase() : 'PAID'}`, 65, statusY + 12);

      doc
        .fillColor('#047857')
        .fontSize(10)
        .font('Helvetica')
        .text(`Verified Gateway Payment`, 50, statusY + 13, { align: 'right', width: doc.page.width - 115 });

      // Student & Stay Details Section
      const studentY = 185;
      doc
        .fillColor(darkSlate)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text('STUDENT & ROOM INFORMATION', 50, studentY);

      doc
        .moveTo(50, studentY + 18)
        .lineTo(doc.page.width - 50, studentY + 18)
        .strokeColor('#E2E8F0')
        .stroke();

      const details = [
        { label: 'Student Name:', val: data.studentName || 'N/A' },
        { label: 'Student ID / Reg No:', val: `STU-${data.studentId || 'N/A'}` },
        { label: 'Mobile Number:', val: data.phone || 'N/A' },
        { label: 'Room & Bed:', val: `Room ${data.roomNumber || 'N/A'} (Bed ${data.bedNumber || 'N/A'})` },
        { label: 'Floor:', val: data.floor || 'Ground Floor' },
        { label: 'College / Institute:', val: data.collegeName || 'N/A' }
      ];

      let currentY = studentY + 28;
      details.forEach((item, index) => {
        const xOffset = index % 2 === 0 ? 50 : 310;
        if (index % 2 === 0 && index !== 0) currentY += 20;

        doc
          .fillColor('#64748B')
          .fontSize(9)
          .font('Helvetica-Bold')
          .text(item.label, xOffset, currentY, { width: 100 });

        doc
          .fillColor(darkSlate)
          .fontSize(9)
          .font('Helvetica')
          .text(item.val, xOffset + 105, currentY, { width: 140 });
      });

      // Payment Details Section
      const paymentY = currentY + 40;
      doc
        .fillColor(darkSlate)
        .fontSize(13)
        .font('Helvetica-Bold')
        .text('PAYMENT TRANSACTION DETAILS', 50, paymentY);

      doc
        .moveTo(50, paymentY + 18)
        .lineTo(doc.page.width - 50, paymentY + 18)
        .strokeColor('#E2E8F0')
        .stroke();

      // Table Header Box
      const tableY = paymentY + 28;
      doc
        .rect(50, tableY, doc.page.width - 100, 24)
        .fill(lightBg);

      doc
        .fillColor('#475569')
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Description', 60, tableY + 7)
        .text('Billing Month', 240, tableY + 7)
        .text('Payment Method', 360, tableY + 7)
        .text('Amount (INR)', 450, tableY + 7, { align: 'right' });

      // Table Item Row
      const rowY = tableY + 32;
      doc
        .fillColor(darkSlate)
        .fontSize(10)
        .font('Helvetica')
        .text('Hostel Room Rent Fee', 60, rowY)
        .text(data.billingMonth || 'N/A', 240, rowY)
        .text(data.paymentMethod || 'Online (Razorpay)', 360, rowY)
        .font('Helvetica-Bold')
        .text(`₹${Number(data.amountPaid || data.amountDue || 0).toLocaleString('en-IN')}`, 450, rowY, { align: 'right' });

      doc
        .moveTo(50, rowY + 20)
        .lineTo(doc.page.width - 50, rowY + 20)
        .strokeColor('#CBD5E1')
        .stroke();

      // Summary Total Row
      const totalY = rowY + 30;
      doc
        .fillColor(primaryColor)
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('TOTAL AMOUNT PAID:', 280, totalY)
        .text(`₹${Number(data.amountPaid || data.amountDue || 0).toLocaleString('en-IN')}`, 450, totalY, { align: 'right' });

      // Transaction Reference Box
      const refY = totalY + 40;
      doc
        .rect(50, refY, doc.page.width - 100, 50)
        .fill('#F1F5F9');

      doc
        .fillColor('#475569')
        .fontSize(8)
        .font('Helvetica-Bold')
        .text('GATEWAY ORDER ID:', 65, refY + 12)
        .text('GATEWAY PAYMENT ID:', 65, refY + 28);

      doc
        .fillColor(darkSlate)
        .font('Helvetica')
        .text(data.gatewayOrderId || 'order_N/A', 170, refY + 12)
        .text(data.gatewayPaymentId || data.transactionId || 'pay_N/A', 170, refY + 28);

      // Authorized Seal / Sign Footer
      const footerY = doc.page.height - 130;
      doc
        .moveTo(50, footerY)
        .lineTo(doc.page.width - 50, footerY)
        .strokeColor('#E2E8F0')
        .stroke();

      doc
        .fillColor('#64748B')
        .fontSize(8)
        .font('Helvetica')
        .text('This is a computer-generated official receipt issued by Akshaya Deluxe Boys Hostel.', 50, footerY + 12, { align: 'center' })
        .text('Thank you for your payment!', 50, footerY + 26, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateReceiptPDF };
