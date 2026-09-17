const { google } = require('googleapis');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Registrations';
const KEY_FILE = path.join(__dirname, '..', 'google-service-account.json');

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

async function appendToGoogleSheet(data) {
  try {
    // 1. Read existing rows
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:H`
    });

    const rows = existing.data.values || [];

    // 2. If sheet is empty → add header row
    if (rows.length === 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'Token No',
            'Name',
            'Phone',
            'Payment ID',
            'Order ID',
            'Amount (₹)',
            'Status',
            'Date & Time'
          ]]
        }
      });
    }

    // 3. Append the new row
    const row = [
      data.tokenNo,
      data.name,
      data.phone,
      data.paymentId,
      data.orderId,
      20,
      data.status,
      new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });

    console.log(`✅ Google Sheet updated: ${data.tokenNo} - ${data.name}`);
    return true;
  } catch (err) {
    console.error('❌ Google Sheet error:', err.message);
    return false;
  }
}

module.exports = { appendToGoogleSheet };