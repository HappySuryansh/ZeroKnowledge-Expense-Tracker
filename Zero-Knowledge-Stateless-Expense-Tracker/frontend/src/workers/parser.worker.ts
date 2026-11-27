// src/workers/parser.worker.ts
import * as XLSX from 'xlsx';

export interface RawTransaction {
  id: string;
  date: string;
  rawDetails: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const data = new Uint8Array(event.data);
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Convert sheet to 2D array of raw values
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
    });

    const transactions: RawTransaction[] = [];
    let isTransactionSection = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;

      const col0 = row[0] !== null ? String(row[0]).trim() : '';
      const col1 = row[1] !== null ? String(row[1]).trim() : '';

      // Detect table header row (Row 16 in SBI statement)
      if (col0 === 'Date' && col1 === 'Details') {
        isTransactionSection = true;
        continue;
      }

      if (!isTransactionSection) continue;

      // Stop when reaching empty rows or footer summary block
      if (!col0 || col0.startsWith('Statement Summary') || col0.startsWith('Brought Forward')) {
        break;
      }

      const debitVal = row[3] !== null && row[3] !== '' ? Number(row[3]) : null;
      const creditVal = row[4] !== null && row[4] !== '' ? Number(row[4]) : null;
      const balanceVal = row[5] !== null && row[5] !== '' ? Number(row[5]) : 0;

      transactions.push({
        id: `tx_${i}`,
        date: col0,
        rawDetails: col1,
        debit: Number.isNaN(debitVal) ? null : debitVal,
        credit: Number.isNaN(creditVal) ? null : creditVal,
        balance: Number.isNaN(balanceVal) ? 0 : balanceVal,
      });
    }

    self.postMessage({ status: 'SUCCESS', transactions });
  } catch (err: any) {
    self.postMessage({ status: 'ERROR', message: err.message });
  }
};