const crypto = require('crypto');
const https = require('https');
const http = require('http');

/**
 * Normalizes any Indian mobile phone number into a uniform 10-digit format.
 * Examples: "+91 8142638659" -> "8142638659", "08142638659" -> "8142638659"
 */
function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).replace(/\D/g, '');
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 */
function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Sends SMS OTP using configured environment credentials (Fast2SMS, Twilio, MSG91, or custom webhook).
 * If no SMS API key is configured in dev environment, logs OTP to server output.
 */
async function sendSms(phone, otp) {
  const normalized = normalizePhone(phone);
  const messageText = `Your Akshaya Deluxe Hostel OTP is ${otp}. Valid for 5 minutes. Do not share it with anyone.`;

  console.log(`[OTP Service] Dispatching OTP for +91 ${normalized}`);

  // 1. Fast2SMS Integration (Indian SMS Gateway)
  if (process.env.FAST2SMS_API_KEY) {
    try {
      const payload = JSON.stringify({
        route: 'otp',
        variables_values: otp,
        numbers: normalized
      });

      await makeHttpRequest({
        hostname: 'www.fast2sms.com',
        path: '/dev/bulkV2',
        method: 'POST',
        headers: {
          'authorization': process.env.FAST2SMS_API_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, payload);

      console.log(`[OTP Service] Fast2SMS dispatched successfully to +91 ${normalized}`);
      return { success: true, provider: 'Fast2SMS' };
    } catch (err) {
      console.error('[OTP Service] Fast2SMS dispatch failed:', err.message);
    }
  }

  // 2. Custom SMS Webhook Integration
  if (process.env.SMS_PROVIDER_URL) {
    try {
      const url = new URL(process.env.SMS_PROVIDER_URL);
      const payload = JSON.stringify({ phone: normalized, otp, message: messageText });
      const client = url.protocol === 'https:' ? https : http;

      await new Promise((resolve, reject) => {
        const req = client.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });

      console.log(`[OTP Service] Custom SMS webhook dispatched to +91 ${normalized}`);
      return { success: true, provider: 'CustomWebhook' };
    } catch (err) {
      console.error('[OTP Service] Custom SMS webhook dispatch failed:', err.message);
    }
  }

  // 3. Server Console Log (For Development / Testing when SMS Gateway keys not set in .env)
  console.log(`====================================================`);
  console.log(`[OTP SERVICE LOG] Real OTP generated for +91 ${normalized}: ${otp}`);
  console.log(`====================================================`);

  return { success: true, provider: 'ConsoleLog' };
}

function makeHttpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

module.exports = {
  normalizePhone,
  generateOtp,
  sendSms
};
