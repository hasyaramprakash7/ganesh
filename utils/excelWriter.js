const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Excel file path
const DATA_DIR = path.join(__dirname, '..', 'data');
const EXCEL_FILE = path.join(DATA_DIR, 'registrations.xlsx');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Append a registration row to the Excel sheet.
 * Creates the file with headers if it doesn't exist.
 */
function appendRegistration(data) {
  try {
    let workbook;
    let worksheet;
    let existingRows = [];

    // 1. If file exists, load it
    if (fs.existsSync(EXCEL_FILE)) {
      workbook = XLSX.readFile(EXCEL_FILE);
      worksheet = workbook.Sheets[workbook.SheetNames[0]];
      existingRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    } else {
      workbook = XLSX.utils.book_new();
    }

    // 2. Build new row
    const newRow = {
      'Token No': data.tokenNo,
      'Name': data.name,
      'Phone': data.phone,
      'Payment ID': data.paymentId,
      'Order ID': data.orderId,
      'Amount (₹)': 20,
      'Status': data.status,
      'Date & Time': new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };

    const allRows = [...existingRows, newRow];

    // 3. Convert to worksheet
    const newWorksheet = XLSX.utils.json_to_sheet(allRows, {
      header: [
        'Token No',
        'Name',
        'Phone',
        'Payment ID',
        'Order ID',
        'Amount (₹)',
        'Status',
        'Date & Time'
      ]
    });

    // 4. Auto-size columns
    newWorksheet['!cols'] = [
      { wch: 20 },
      { wch: 22 },
      { wch: 14 },
      { wch: 24 },
      { wch: 24 },
      { wch: 12 },
      { wch: 12 },
      { wch: 22 }
    ];

    // 5. Save
    workbook.Sheets['Registrations'] = newWorksheet;
    workbook.SheetNames = ['Registrations'];

    XLSX.writeFile(workbook, EXCEL_FILE);

    console.log(`✅ Excel updated: ${data.tokenNo} - ${data.name}`);
    return true;
  } catch (err) {
    console.error('❌ Excel write error:', err);
    return false;
  }
}

module.exports = { appendRegistration, EXCEL_FILE };