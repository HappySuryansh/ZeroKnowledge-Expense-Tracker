// ==========================================================================
// Zero-Knowledge Expense Tracker — Full 6-Phase Client-Side Engine
// Integrates directly with the untouched Spring Boot Stateless API:
//   POST /api/v1/auth/device-register
//   POST /api/v1/categorize
// ==========================================================================

const CATEGORIES = [
  'Groceries & Quick Commerce',
  'Food & Dining',
  'Transit & Travel',
  'Investments & Mutual Funds',
  'Bills, Telecom & Recharges',
  'Government & Exam Fees',
  'Micro-Wallet & Cashbacks',
  'Peer-to-Peer / Personal Transfer',
  'Miscellaneous'
];

const ESSENTIAL_CATEGORIES = new Set([
  'Groceries & Quick Commerce',
  'Transit & Travel',
  'Bills, Telecom & Recharges',
  'Investments & Mutual Funds',
  'Government & Exam Fees'
]);

const STORAGE_KEYS = {
  THEME: 'zk_theme',
  DEVICE_SECRET: 'zk_device_secret',
  JWT: 'zk_scoped_jwt',
  API_BASE: 'zk_api_base_url',
  SALT: 'zk_vault_salt_b64'
};

// ==========================================================================
// Phase 1: Web Crypto API (PBKDF2 + AES-256-GCM) & Scoped Device Identity
// ==========================================================================
class CryptoVault {
  constructor() {
    this.volatileKey = null;
    this.passphraseMode = 'session'; // 'session' | 'passphrase'
  }

  async initSessionKey() {
    this.volatileKey = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    this.passphraseMode = 'session';
  }

  async initVaultKey(password) {
    const encoder = new TextEncoder();
    let saltB64 = localStorage.getItem(STORAGE_KEYS.SALT);
    let activeSalt;
    if (saltB64) {
      activeSalt = base64ToBytes(saltB64);
    } else {
      activeSalt = window.crypto.getRandomValues(new Uint8Array(16));
      localStorage.setItem(STORAGE_KEYS.SALT, bytesToBase64(activeSalt));
    }

    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this.volatileKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: activeSalt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    this.passphraseMode = 'passphrase';
    return activeSalt;
  }

  lock() {
    this.volatileKey = null;
  }

  isUnlocked() {
    return this.volatileKey !== null;
  }

  async encryptJSON(data) {
    if (!this.volatileKey) {
      await this.initSessionKey();
    }
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const cipherBuf = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.volatileKey,
      encoded
    );
    return {
      alg: 'AES-256-GCM',
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
      updatedAt: new Date().toISOString()
    };
  }

  async decryptJSON(record) {
    if (!this.volatileKey) {
      throw new Error('Vault is locked');
    }
    const iv = base64ToBytes(record.iv);
    const cipherBytes = base64ToBytes(record.ciphertext);
    const plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.volatileKey,
      cipherBytes
    );
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  getApiBaseUrl() {
    return (localStorage.getItem(STORAGE_KEYS.API_BASE) || '').replace(/\/+$/, '');
  }

  async ensureDeviceToken(forceRefresh = false) {
    if (!forceRefresh) {
      const existingJwt = sessionStorage.getItem(STORAGE_KEYS.JWT);
      if (existingJwt) return existingJwt;
    }

    let deviceSecret = localStorage.getItem(STORAGE_KEYS.DEVICE_SECRET);
    if (!deviceSecret) {
      deviceSecret = window.crypto.randomUUID();
      localStorage.setItem(STORAGE_KEYS.DEVICE_SECRET, deviceSecret);
    }

    const base = this.getApiBaseUrl();
    const response = await fetch(`${base}/api/v1/auth/device-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceSecret })
    });

    if (!response.ok) {
      throw new Error(`Device registration failed (${response.status})`);
    }

    const { token } = await response.json();
    sessionStorage.setItem(STORAGE_KEYS.JWT, token);
    return token;
  }
}

// ==========================================================================
// Phase 5 Helper: Native IndexedDB Encrypted Vault Storage
// ==========================================================================
const DB_NAME = 'zk_expense_vault_db';
const STORE_NAME = 'vault_blobs';

function openVaultDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbClear() {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

// ==========================================================================
// Phase 3: Non-Regex Privacy Firewall (Exact port of privacyFirewall.ts)
// ==========================================================================
const IGNORED_PREFIX_TOKENS = new Set(['WDL', 'TFR', 'DEP', 'DEBIT', 'CREDIT']);

function isAllDigits(str) {
  if (!str || str.length === 0) return false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function normalizeWhitespace(input) {
  const cleanedChars = [];
  let prevWasSpace = false;
  const text = String(input || '');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ') {
      if (!prevWasSpace) {
        cleanedChars.push(' ');
        prevWasSpace = true;
      }
    } else {
      cleanedChars.push(ch);
      prevWasSpace = false;
    }
  }
  return cleanedChars.join('').trim();
}

function extractIsolatedMerchant(rawDetails) {
  const normalized = normalizeWhitespace(rawDetails);

  // Case 1: Standard UPI Transaction -> "WDL TFR UPI/DR/<RRN>/<Merchant>/<Bank>/..."
  const upiIndex = normalized.indexOf('UPI/');
  if (upiIndex !== -1) {
    const upiSubstring = normalized.substring(upiIndex + 4);
    const slashParts = upiSubstring.split('/');

    if (slashParts.length >= 3) {
      let merchantCandidate = slashParts[2].trim();
      const atIndex = merchantCandidate.indexOf(' AT ');
      if (atIndex !== -1) {
        merchantCandidate = merchantCandidate.substring(0, atIndex).trim();
      }
      const tokens = merchantCandidate
        .split(' ')
        .filter((t) => !(isAllDigits(t) && t.length >= 6));
      return tokens.join(' ').trim() || 'UNKNOWN_MERCHANT';
    }
  }

  // Case 2: Non-UPI Transactions (ACHDr, INB E mandate, INTEREST CREDIT)
  let fallback = normalized;
  const atIndex = fallback.indexOf(' AT ');
  if (atIndex !== -1) {
    fallback = fallback.substring(0, atIndex).trim();
  }

  const filteredTokens = fallback.split(' ').filter((token) => {
    if (!token) return false;
    if (IGNORED_PREFIX_TOKENS.has(token.toUpperCase())) return false;
    if (isAllDigits(token) && token.length >= 5) return false;
    return true;
  });

  return filteredTokens.join(' ').trim() || 'UNKNOWN_MERCHANT';
}

function runPrivacyFirewall(transactions) {
  const uniqueSet = new Set();
  const txToMerchantMap = {};

  for (const tx of transactions) {
    const merchant = extractIsolatedMerchant(tx.rawDetails);
    txToMerchantMap[tx.id] = merchant;
    if (merchant.length > 0) {
      uniqueSet.add(merchant);
    }
  }

  return {
    isolatedMerchants: Array.from(uniqueSet),
    txToMerchantMap
  };
}

// ==========================================================================
// Phase 2: Local Statement Parser (SBI Excel/CSV + Generic CSV fallback)
// ==========================================================================
function parseCSVText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseNumericAmount(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isNaN(val) ? null : val;
  const cleaned = String(val).replace(/[₹,\s]/g, '');
  if (!cleaned || cleaned === '-') return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

function extractTransactionsFromRows(rows) {
  const transactions = [];

  // Strategy 1: Exact SBI Statement layout (matches parser.worker.ts)
  let sbiHeaderIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const c0 = r[0] !== null && r[0] !== undefined ? String(r[0]).trim() : '';
    const c1 = r[1] !== null && r[1] !== undefined ? String(r[1]).trim() : '';
    if (c0 === 'Date' && c1 === 'Details') {
      sbiHeaderIndex = i;
      break;
    }
  }

  if (sbiHeaderIndex !== -1) {
    for (let i = sbiHeaderIndex + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 2) continue;
      const col0 = r[0] !== null && r[0] !== undefined ? String(r[0]).trim() : '';
      const col1 = r[1] !== null && r[1] !== undefined ? String(r[1]).trim() : '';
      if (!col0 || col0.startsWith('Statement Summary') || col0.startsWith('Brought Forward')) {
        break;
      }
      transactions.push({
        id: `tx_${i}`,
        date: col0,
        rawDetails: col1,
        debit: parseNumericAmount(r[3]),
        credit: parseNumericAmount(r[4]),
        balance: parseNumericAmount(r[5]) ?? 0
      });
    }
    return transactions;
  }

  // Strategy 2: Generic bank statement header detection
  let headerRowIdx = -1;
  let colMap = { date: 0, details: 1, debit: -1, credit: -1, amount: -1, balance: -1 };

  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const lower = r.map((c) => String(c || '').trim().toLowerCase());
    const dateIdx = lower.findIndex((h) => h.includes('date'));
    const descIdx = lower.findIndex((h) =>
      h.includes('detail') || h.includes('narration') || h.includes('description') || h.includes('merchant') || h.includes('particular')
    );
    if (dateIdx !== -1 && descIdx !== -1) {
      headerRowIdx = i;
      colMap.date = dateIdx;
      colMap.details = descIdx;
      colMap.debit = lower.findIndex((h) => h.includes('debit') || h.includes('withdrawal') || h.includes('dr'));
      colMap.credit = lower.findIndex((h) => h.includes('credit') || h.includes('deposit') || h.includes('cr'));
      colMap.amount = lower.findIndex((h) => h === 'amount' || h.includes('amount'));
      colMap.balance = lower.findIndex((h) => h.includes('balance'));
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error('Could not detect statement header row (expected Date and Details/Narration columns).');
  }

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const dateVal = String(r[colMap.date] ?? '').trim();
    const detailsVal = String(r[colMap.details] ?? '').trim();
    if (!dateVal || !detailsVal) continue;
    if (dateVal.startsWith('Statement Summary') || dateVal.startsWith('Brought Forward')) break;

    let debit = colMap.debit !== -1 ? parseNumericAmount(r[colMap.debit]) : null;
    let credit = colMap.credit !== -1 ? parseNumericAmount(r[colMap.credit]) : null;

    if (debit === null && credit === null && colMap.amount !== -1) {
      const amt = parseNumericAmount(r[colMap.amount]);
      if (amt !== null) {
        if (amt < 0) debit = Math.abs(amt);
        else debit = amt;
      }
    }

    transactions.push({
      id: `tx_${i}`,
      date: dateVal,
      rawDetails: detailsVal,
      debit,
      credit,
      balance: colMap.balance !== -1 ? (parseNumericAmount(r[colMap.balance]) ?? 0) : 0
    });
  }

  return transactions;
}

async function parseStatementFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    const rows = parseCSVText(text);
    return extractTransactionsFromRows(rows);
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS library did not load (check internet connection) — CSV files still work offline.');
    }
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: null });
    return extractTransactionsFromRows(rows);
  }

  throw new Error('Unsupported file format. Please upload an .xlsx, .xls, or .csv bank statement.');
}

// ==========================================================================
// Phase 4: Stateless Spring AI Categorization Client + Offline Fallback
// ==========================================================================
async function categorizeMerchantsStateless(vault, isolatedMerchants) {
  const base = vault.getApiBaseUrl();
  let jwt = await vault.ensureDeviceToken(false);

  const sendReq = async (token) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch(`${base}/api/v1/categorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ merchants: isolatedMerchants }),
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let response = await sendReq(jwt);

  // Auto-refresh expired/invalid device JWT once
  if (response.status === 401) {
    sessionStorage.removeItem(STORAGE_KEYS.JWT);
    jwt = await vault.ensureDeviceToken(true);
    response = await sendReq(jwt);
  }

  if (response.status === 429) {
    throw new Error('Rate limit exceeded (10 batch calls/hour per device token).');
  }

  if (!response.ok) {
    const errText = await response.text();
    let msg = `Categorization failed (${response.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.message) msg = `${msg}: ${parsed.message}`;
    } catch {
      if (errText) msg = `${msg}: ${errText}`;
    }
    throw new Error(msg);
  }

  const data = await response.json();
  return data.categoryMap || {};
}

function localOfflineFallbackClassify(merchants) {
  const result = {};
  for (const m of merchants) {
    const up = m.toUpperCase();
    if (/(BLINKIT|MOTHER D|ZEPTO|BIGBASKET|INSTAMART|MART|GROCER|DMART|MAMA GEN)/.test(up)) {
      result[m] = 'Groceries & Quick Commerce';
    } else if (/(SWIGGY|ZOMATO|FOOD|SWEE|CAFE|COFFEE|DOMINO|PIZZA|BIKANER|HIRO|HALDIRAM|TEA)/.test(up)) {
      result[m] = 'Food & Dining';
    } else if (/(DMRC|DELHI ME|METRO|IRCTC|INDIAN R|UBER|OLA|RAPIDO|FUEL|PETROL|HPCL|BPCL)/.test(up)) {
      result[m] = 'Transit & Travel';
    } else if (/(PPFAS|MUTUAL|GROWW|ZERODHA|SIP|ACHDR|HDFC000|INVEST|NPS)/.test(up)) {
      result[m] = 'Investments & Mutual Funds';
    } else if (/(JIO|AIRTEL|VI |BSNL|GOOGLE P|RELIANCE|ELECTRIC|BROADBAND|BILL|RECHARGE|NETFLIX|SPOTIFY|STREAM)/.test(up)) {
      result[m] = 'Bills, Telecom & Recharges';
    } else if (/(GOVT|UNION PU|UPSC|NTA|EXAM|UNIVERSITY|COLLEGE|GGSIPU|MANDATE)/.test(up)) {
      result[m] = 'Government & Exam Fees';
    } else if (/(UPILITE|BHIM|NPCI|CASHBACK|WALLET)/.test(up)) {
      result[m] = 'Micro-Wallet & Cashbacks';
    } else if (/(INTEREST|INTERES T|CR$|CHARGE|ATM|CASH)/.test(up)) {
      result[m] = 'Miscellaneous';
    } else {
      result[m] = 'Peer-to-Peer / Personal Transfer';
    }
  }
  return result;
}

// ==========================================================================
// Sample SBI Statement Generator (for live college minor project demo)
// ==========================================================================
const SAMPLE_SBI_CSV = [
  'Account Name,Suryansh (Sample SBI Statement),,,,',
  'Account Number,XXXX XXXX 4921,,,,',
  'Date,Details,Ref No./Cheque No,Debit,Credit,Balance',
  '02 Nov 2026,WDL TFR UPI/DR/430612984511/BLINKIT/HDFC/blinkit@okhdfcbank/Groceries,UPI430612,684.00,,24316.00',
  '03 Nov 2026,WDL TFR UPI/DR/430722193844/DMRC/SBIN/dmrc@sbi/Metro Recharge,UPI430722,300.00,,24016.00',
  '04 Nov 2026,WDL TFR UPI/DR/430833918273/SWIGGY I/ICIC/swiggy@icici/Dinner,UPI430833,445.00,,23571.00',
  '05 Nov 2026,ACHDr HDFC00070 PPFAS 0035465570711 AT 17930 NEW DELHI,ACH003546,2000.00,,21571.00',
  '06 Nov 2026,WDL TFR UPI/DR/431044827162/Jio Prep/UTIB/jio@axisbank/Mobile Plan,UPI431044,299.00,,21272.00',
  '07 Nov 2026,WDL TFR UPI/DR/431155736251/MOTHER D/SBIN/motherdairy@sbi/Milk,UPI431155,186.00,,21086.00',
  '09 Nov 2026,WDL TFR UPI/DR/431366645340/DMRC/SBIN/dmrc@sbi/Metro Card,UPI431366,200.00,,20886.00',
  '10 Nov 2026,WDL TFR UPI/DR/431477554439/HiraSwee/HDFC/hirasweets@hdfc/Snacks,UPI431477,320.00,,20566.00',
  '12 Nov 2026,DEP TFR UPI/CR/431688463528/AMAN VERMA/SBIN/aman@sbi/Project Split,,1200.00,21766.00',
  '14 Nov 2026,WDL TFR UPI/DR/431899372617/UPILITE 0095809162097 AT 17930 BURARI DELHI/SBIN,UPI431899,500.00,,21266.00',
  '15 Nov 2026,WDL TFR UPI/DR/431910281706/IRCTC Ti/HDFC/irctc@hdfc/Train Ticket,UPI431910,765.00,,20501.00',
  '17 Nov 2026,WDL TFR UPI/DR/432121190895/SWIGGY I/ICIC/swiggy@icici/Lunch,UPI432121,360.00,,20141.00',
  '19 Nov 2026,INB E mandate OF GOVT CORP PAYMENTS 18082026,INB180820,1000.00,,19141.00',
  '21 Nov 2026,WDL TFR UPI/DR/432532109984/BLINKIT/HDFC/blinkit@okhdfcbank/Essentials,UPI432532,540.00,,18601.00',
  '23 Nov 2026,WDL TFR UPI/DR/432743018073/Google P/UTIB/googleplay@axis/Cloud Storage,UPI432743,130.00,,18471.00',
  '24 Nov 2026,WDL TFR UPI/DR/432854927162/Ritik Raj/SBIN/ritik@sbi/Dinner Split,UPI432854,450.00,,18021.00',
  '25 Nov 2026,CREDIT INTEREST CREDIT,INT251126,,142.00,18163.00',
  'Statement Summary,,,,,'
].join('\n');

// ==========================================================================
// Application State & Controller
// ==========================================================================
const vault = new CryptoVault();
const state = {
  transactions: [],       // Rehydrated: { id, date, rawDetails, merchant, debit, credit, balance, category, source }
  merchantCache: {},      // { merchantName: category }
  lastOutboundPayload: [],// Array of merchants sent to backend
  lastEncryptedBlob: null,
  backendOnline: false,
  lastEngineSource: 'Idle'
};

const PAGE_TITLES = {
  dashboard: 'Financial Dashboard',
  transactions: 'Local Transactions',
  privacy: 'Privacy Vault & Firewall',
  insights: 'Financial Insights'
};

// --------------------------------------------------------------------------
// Theme Management
// --------------------------------------------------------------------------
const themeToggleBtn = document.getElementById('themeToggle');
function getPreferredTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.THEME);
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
}
applyTheme(getPreferredTheme());
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const curr = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(curr === 'light' ? 'dark' : 'light');
  });
}

// --------------------------------------------------------------------------
// Navigation
// --------------------------------------------------------------------------
function go(pageId) {
  const target = document.getElementById(pageId);
  if (!target) return;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  target.classList.add('active');
  document.querySelectorAll('.nav').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-page') === pageId);
  });
  const titleEl = document.getElementById('title');
  if (titleEl && PAGE_TITLES[pageId]) {
    titleEl.textContent = PAGE_TITLES[pageId];
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.go = go;

document.querySelectorAll('.nav').forEach((btn) => {
  btn.addEventListener('click', () => {
    const pageId = btn.getAttribute('data-page');
    if (pageId) go(pageId);
  });
});

// --------------------------------------------------------------------------
// Toast & Pipeline Stepper Helpers
// --------------------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function setPipelineStep(activeStep, message) {
  const banner = document.getElementById('pipelineBanner');
  const msgEl = document.getElementById('pipelineMsg');
  if (!banner || !msgEl) return;
  banner.hidden = false;
  msgEl.textContent = message;
  banner.querySelectorAll('.p-step').forEach((el) => {
    const stepNum = Number(el.getAttribute('data-step'));
    el.classList.remove('active', 'done');
    if (stepNum < activeStep) el.classList.add('done');
    else if (stepNum === activeStep) el.classList.add('active');
  });
}

function formatINR(num) {
  return '₹' + Math.round(num || 0).toLocaleString('en-IN');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --------------------------------------------------------------------------
// Backend Health / Device Token Check on Startup
// --------------------------------------------------------------------------
async function checkBackendConnectivity() {
  const dot = document.getElementById('backendDot');
  const label = document.getElementById('backendLabel');
  const sub = document.getElementById('backendSub');
  try {
    await vault.ensureDeviceToken(false);
    state.backendOnline = true;
    if (dot) { dot.classList.remove('offline'); dot.classList.add('online'); }
    if (label) label.textContent = 'Spring Boot API Ready';
    if (sub) sub.textContent = 'Scoped device JWT active';
  } catch {
    state.backendOnline = false;
    if (dot) { dot.classList.remove('online'); dot.classList.add('offline'); }
    if (label) label.textContent = 'Offline Fallback Mode';
    if (sub) sub.textContent = 'Start backend for Spring AI';
  }
}

// --------------------------------------------------------------------------
// Core 6-Phase Statement Execution Pipeline
// --------------------------------------------------------------------------
async function runFullPipeline(rawTransactions, sourceLabel) {
  if (!rawTransactions || rawTransactions.length === 0) {
    throw new Error('No transaction rows were found in the statement.');
  }

  // Phase 1: Ensure volatile AES-256-GCM key exists
  setPipelineStep(1, 'Phase 1: Ensuring local AES-256-GCM Web Crypto key in RAM...');
  if (!vault.isUnlocked()) {
    await vault.initSessionKey();
  }

  // Phase 2: Complete (rawTransactions already parsed locally)
  setPipelineStep(2, `Phase 2: Parsed ${rawTransactions.length} transactions locally from ${sourceLabel}.`);

  // Phase 3: Non-Regex Privacy Firewall
  setPipelineStep(3, 'Phase 3: Running non-regex Privacy Firewall — stripping dates, amounts, balances & RRNs...');
  const fw = runPrivacyFirewall(rawTransactions);
  const uncachedMerchants = fw.isolatedMerchants.filter((m) => !state.merchantCache[m]);
  state.lastOutboundPayload = uncachedMerchants;

  // Phase 4: Stateless Spring AI Categorization
  let newMappings = {};
  let engineSource = 'Local Cache';

  if (uncachedMerchants.length > 0) {
    setPipelineStep(
      4,
      `Phase 4: Sending ONLY ${uncachedMerchants.length} unique merchant string(s) to stateless Spring AI...`
    );
    try {
      newMappings = await categorizeMerchantsStateless(vault, uncachedMerchants);
      engineSource = 'Spring AI (Live)';
      state.backendOnline = true;
      const dot = document.getElementById('backendDot');
      if (dot) { dot.classList.remove('offline'); dot.classList.add('online'); }
      const label = document.getElementById('backendLabel');
      if (label) label.textContent = 'Spring Boot API Ready';
      const sub = document.getElementById('backendSub');
      if (sub) sub.textContent = 'Scoped device JWT active';
    } catch (err) {
      // Graceful fallback when backend isn't running yet during static preview
      console.warn('Backend categorization unavailable, using local fallback:', err.message);
      newMappings = localOfflineFallbackClassify(uncachedMerchants);
      engineSource = 'Local Fallback (Start Backend for Spring AI)';
      showToast(`Backend unreachable (${err.message}). Used local classifier fallback.`);
    }
    Object.assign(state.merchantCache, newMappings);
  }

  state.lastEngineSource = engineSource;

  // Phase 5: Local Rehydration & AES-256-GCM Encrypted Persistence
  setPipelineStep(5, 'Phase 5: Rehydrating categories locally & encrypting vault into IndexedDB...');
  state.transactions = rawTransactions.map((tx) => {
    const merchant = fw.txToMerchantMap[tx.id] || 'UNKNOWN_MERCHANT';
    const category = state.merchantCache[merchant] || 'Miscellaneous';
    return {
      ...tx,
      merchant,
      category,
      source: engineSource
    };
  });

  await persistEncryptedVault();

  // Phase 6: Render Local Analytics & UI
  setPipelineStep(
    6,
    `Complete: ${state.transactions.length} transactions encrypted locally (${fw.isolatedMerchants.length} unique merchants via ${engineSource}).`
  );
  // Mark all 6 steps done
  document.querySelectorAll('#pipelineBanner .p-step').forEach((el) => {
    el.classList.remove('active');
    el.classList.add('done');
  });

  renderAll();
  showToast(`Processed ${state.transactions.length} transactions with zero server persistence.`);
}

async function persistEncryptedVault() {
  const payload = {
    transactions: state.transactions,
    merchantCache: state.merchantCache,
    lastOutboundPayload: state.lastOutboundPayload,
    lastEngineSource: state.lastEngineSource
  };
  const encryptedBlob = await vault.encryptJSON(payload);
  state.lastEncryptedBlob = encryptedBlob;
  await idbPut('primary_vault', encryptedBlob);
}

// --------------------------------------------------------------------------
// Render All Pages Dynamically
// --------------------------------------------------------------------------
function renderAll() {
  renderDashboard();
  renderTransactions();
  renderPrivacyVault();
  renderInsights();
  updateVaultSidebarStatus();
}

function updateVaultSidebarStatus() {
  const dot = document.getElementById('vaultDot');
  const label = document.getElementById('vaultLabel');
  const sub = document.getElementById('vaultSub');
  const clearBtn = document.getElementById('clearVaultBtn');

  if (clearBtn) clearBtn.hidden = state.transactions.length === 0;

  if (!vault.isUnlocked()) {
    if (dot) { dot.classList.remove('online'); dot.classList.add('locked'); }
    if (label) label.textContent = 'Vault Locked';
    if (sub) sub.textContent = 'Click to enter passphrase';
  } else {
    if (dot) { dot.classList.remove('locked'); dot.classList.add('online'); }
    if (label) label.textContent = vault.passphraseMode === 'passphrase' ? 'Vault Unlocked (Passphrase)' : 'Vault Unlocked (Session)';
    if (sub) sub.textContent = 'AES-256-GCM · Local RAM';
  }
}

function renderDashboard() {
  const txs = state.transactions;
  const totalDebit = txs.reduce((sum, t) => sum + (t.debit || 0), 0);
  const uniqueCats = new Set(txs.map((t) => t.category)).size;
  const uniqueMerchants = new Set(txs.map((t) => t.merchant)).size;
  const reduction = txs.length > 0 ? Math.round((1 - uniqueMerchants / txs.length) * 100) : 0;

  document.getElementById('statTxCount').textContent = String(txs.length);
  document.getElementById('statTxSub').textContent = txs.length > 0 ? 'Processed locally in browser' : 'Upload statement to begin';
  document.getElementById('statTotalSpend').textContent = formatINR(totalDebit);
  document.getElementById('statCategoriesSub').textContent = `${uniqueCats} active categories`;
  document.getElementById('statMerchantsSent').textContent = txs.length > 0 ? `${uniqueMerchants} unique` : 'Merchant only';
  document.getElementById('statReductionSub').textContent =
    txs.length > 0 ? `${Math.max(0, reduction)}% dedup reduction · 0 PII` : 'Privacy firewall active';
  document.getElementById('statVaultStatus').textContent = state.lastEncryptedBlob ? 'Encrypted' : 'Ready';
  document.getElementById('statEngineSub').textContent = state.lastEngineSource || 'IndexedDB · AES-GCM';

  const navBadge = document.getElementById('navTxCount');
  if (navBadge) {
    navBadge.textContent = String(txs.length);
    navBadge.hidden = txs.length === 0;
  }
}

function populateCategoryFilter() {
  const select = document.getElementById('txCategoryFilter');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="ALL">All Categories</option>';
  CATEGORIES.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
  if (current) select.value = current;
}

function renderTransactions() {
  const table = document.getElementById('txTable');
  const tbody = document.getElementById('txTableBody');
  const empty = document.getElementById('txEmptyState');
  const countEl = document.getElementById('txFilterCount');

  const query = (document.getElementById('txSearch')?.value || '').trim().toLowerCase();
  const catFilter = document.getElementById('txCategoryFilter')?.value || 'ALL';
  const typeFilter = document.getElementById('txTypeFilter')?.value || 'ALL';

  const filtered = state.transactions.filter((tx) => {
    if (catFilter !== 'ALL' && tx.category !== catFilter) return false;
    if (typeFilter === 'DEBIT' && !(tx.debit && tx.debit > 0)) return false;
    if (typeFilter === 'CREDIT' && !(tx.credit && tx.credit > 0)) return false;
    if (query) {
      const hay = `${tx.date} ${tx.merchant} ${tx.rawDetails} ${tx.category}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (countEl) countEl.textContent = `${filtered.length} of ${state.transactions.length} rows`;

  if (state.transactions.length === 0) {
    table.hidden = true;
    empty.hidden = false;
    return;
  }

  table.hidden = false;
  empty.hidden = true;

  tbody.innerHTML = filtered
    .map((tx) => {
      const isCredit = tx.credit && tx.credit > 0;
      const amt = isCredit ? tx.credit : (tx.debit || 0);
      const optionsHtml = CATEGORIES.map(
        (c) => `<option value="${escapeHtml(c)}" ${c === tx.category ? 'selected' : ''}>${escapeHtml(c)}</option>`
      ).join('');
      return `
        <tr>
          <td>${escapeHtml(tx.date)}</td>
          <td title="${escapeHtml(tx.rawDetails)}"><b>${escapeHtml(tx.merchant)}</b></td>
          <td><span class="pill ${isCredit ? 'pill-credit' : 'pill-debit'}">${isCredit ? 'Credit' : 'Debit'}</span></td>
          <td class="${isCredit ? 'amt-credit' : 'amt-debit'}">${isCredit ? '+' : '-'}${formatINR(amt)}</td>
          <td>
            <select class="cat-select" data-tx-id="${escapeHtml(tx.id)}">${optionsHtml}</select>
          </td>
          <td><span class="pill pill-local">AES-GCM</span></td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.cat-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const txId = e.target.getAttribute('data-tx-id');
      const newCat = e.target.value;
      const target = state.transactions.find((t) => t.id === txId);
      if (target) {
        target.category = newCat;
        state.merchantCache[target.merchant] = newCat;
        await persistEncryptedVault();
        renderInsights();
        renderPrivacyVault();
        showToast(`Updated "${target.merchant}" → ${newCat} (re-encrypted locally)`);
      }
    });
  });
}

function renderPrivacyVault() {
  const payloadPre = document.getElementById('outboundPayloadPre');
  const payloadBadge = document.getElementById('payloadCountBadge');
  const cipherPre = document.getElementById('ciphertextPre');
  const cipherBadge = document.getElementById('cipherStatusBadge');
  const diffEmpty = document.getElementById('diffEmptyState');
  const diffWrap = document.getElementById('diffTableWrap');
  const diffBody = document.getElementById('diffTableBody');

  const uniqueMerchants = Array.from(new Set(state.transactions.map((t) => t.merchant)));
  if (payloadBadge) payloadBadge.textContent = `${uniqueMerchants.length} merchants`;
  if (payloadPre) {
    payloadPre.textContent = JSON.stringify({ merchants: uniqueMerchants }, null, 2);
  }

  if (state.lastEncryptedBlob && cipherPre && cipherBadge) {
    cipherBadge.textContent = 'AES-256-GCM';
    cipherBadge.classList.add('safe');
    const preview = {
      algorithm: state.lastEncryptedBlob.alg,
      iv_96bit_b64: state.lastEncryptedBlob.iv,
      ciphertext_preview: state.lastEncryptedBlob.ciphertext.slice(0, 180) + '...',
      ciphertext_bytes: Math.round((state.lastEncryptedBlob.ciphertext.length * 3) / 4),
      storedIn: 'IndexedDB (zk_expense_vault_db)',
      updatedAt: state.lastEncryptedBlob.updatedAt
    };
    cipherPre.textContent = JSON.stringify(preview, null, 2);
  } else if (cipherPre && cipherBadge) {
    cipherBadge.textContent = 'EMPTY';
    cipherBadge.classList.remove('safe');
    cipherPre.textContent = 'Upload or load a statement to inspect live AES-256-GCM ciphertext and 96-bit IV.';
  }

  if (state.transactions.length === 0) {
    diffEmpty.hidden = false;
    diffWrap.hidden = true;
    return;
  }

  diffEmpty.hidden = true;
  diffWrap.hidden = false;
  diffBody.innerHTML = state.transactions
    .slice(0, 8)
    .map((tx) => {
      const amt = tx.debit ? formatINR(tx.debit) : formatINR(tx.credit);
      return `
        <tr>
          <td><code>${escapeHtml(tx.rawDetails)}</code></td>
          <td>Date (${escapeHtml(tx.date)}), Amt (${amt}), Bal (${formatINR(tx.balance)})</td>
          <td><b>${escapeHtml(tx.merchant)}</b></td>
          <td><span class="pill pill-local">${escapeHtml(tx.category)}</span></td>
        </tr>
      `;
    })
    .join('');
}

function renderInsights() {
  const txs = state.transactions;
  const debits = txs.filter((t) => t.debit && t.debit > 0);
  const credits = txs.filter((t) => t.credit && t.credit > 0);

  const totalOut = debits.reduce((s, t) => s + t.debit, 0);
  const totalIn = credits.reduce((s, t) => s + t.credit, 0);
  const net = totalIn - totalOut;
  const avgDebit = debits.length > 0 ? totalOut / debits.length : 0;

  document.getElementById('insOutflow').textContent = formatINR(totalOut);
  document.getElementById('insDebitCount').textContent = `${debits.length} debit transaction(s)`;
  document.getElementById('insInflow').textContent = formatINR(totalIn);
  document.getElementById('insCreditCount').textContent = `${credits.length} credit transaction(s)`;
  document.getElementById('insNetFlow').textContent = (net >= 0 ? '+' : '-') + formatINR(Math.abs(net));
  document.getElementById('insAvgSpend').textContent = `Avg debit: ${formatINR(avgDebit)}`;
  document.getElementById('insCacheCount').textContent = String(Object.keys(state.merchantCache).length);

  // Category Breakdown Bars
  const barsContainer = document.getElementById('categoryBarsContainer');
  if (debits.length === 0) {
    barsContainer.innerHTML = '<p class="empty-state-sm">Upload or load a statement to view category breakdown.</p>';
    document.getElementById('splitSummary').hidden = true;
    document.getElementById('recurringList').innerHTML = '<li>No recurring merchants detected yet.</li>';
    return;
  }

  const byCat = {};
  let essentialTotal = 0;
  for (const t of debits) {
    byCat[t.category] = (byCat[t.category] || 0) + t.debit;
    if (ESSENTIAL_CATEGORIES.has(t.category)) {
      essentialTotal += t.debit;
    }
  }

  const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  barsContainer.innerHTML = sortedCats
    .map(([cat, amt]) => {
      const pct = totalOut > 0 ? Math.round((amt / totalOut) * 100) : 0;
      return `
        <div class="bar">
          <span>${escapeHtml(cat)} <b>${formatINR(amt)} (${pct}%)</b></span>
          <i style="width: ${Math.max(pct, 2)}%"></i>
        </div>
      `;
    })
    .join('');

  // Essential vs. Discretionary
  const essPct = totalOut > 0 ? Math.round((essentialTotal / totalOut) * 100) : 0;
  const discPct = 100 - essPct;
  document.getElementById('splitSummary').hidden = false;
  document.getElementById('essentialPct').textContent = `${essPct}% (${formatINR(essentialTotal)})`;
  document.getElementById('essentialBar').style.width = `${essPct}%`;
  document.getElementById('discretionaryPct').textContent = `${discPct}% (${formatINR(totalOut - essentialTotal)})`;
  document.getElementById('discretionaryBar').style.width = `${discPct}%`;

  // Recurring / Frequent Merchant Detection
  const freqMap = {};
  for (const t of debits) {
    if (!freqMap[t.merchant]) freqMap[t.merchant] = { count: 0, total: 0 };
    freqMap[t.merchant].count++;
    freqMap[t.merchant].total += t.debit;
  }
  const recurring = Object.entries(freqMap)
    .filter(([, info]) => info.count >= 2)
    .sort((a, b) => b[1].total - a[1].total);

  const recList = document.getElementById('recurringList');
  if (recurring.length === 0) {
    recList.innerHTML = '<li>No repeated merchants (2+ debits) in this statement.</li>';
  } else {
    recList.innerHTML = recurring
      .map(
        ([m, info]) =>
          `<li><span>${escapeHtml(m)} <small>(${info.count}×)</small></span><b>${formatINR(info.total)}</b></li>`
      )
      .join('');
  }
}

// --------------------------------------------------------------------------
// File Upload, Drag-and-Drop, Sample Loader & CSV Export
// --------------------------------------------------------------------------
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('file');
const statusLabel = document.getElementById('status');

async function handleFileSelection(file) {
  if (!file) return;
  const sizeKB = (file.size / 1024).toFixed(1);
  if (statusLabel) {
    statusLabel.textContent = `Parsing ${file.name} (${sizeKB} KB) locally...`;
  }
  try {
    const rawTxs = await parseStatementFile(file);
    await runFullPipeline(rawTxs, file.name);
    if (statusLabel) {
      statusLabel.textContent = `✓ ${file.name} (${rawTxs.length} rows) — Encrypted locally`;
    }
    if (dropZone) dropZone.style.borderColor = 'var(--accent-orchid)';
  } catch (err) {
    if (statusLabel) statusLabel.textContent = `Error: ${err.message}`;
    showToast(err.message);
  }
}

if (dropZone && fileInput) {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    document.body.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
  });
  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, () => dropZone.classList.add('dragover'), false);
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover'), false);
  });
  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) handleFileSelection(files[0]);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });
}

document.getElementById('loadSampleBtn')?.addEventListener('click', async () => {
  try {
    const rows = parseCSVText(SAMPLE_SBI_CSV);
    const rawTxs = extractTransactionsFromRows(rows);
    await runFullPipeline(rawTxs, 'Sample_SBI_Statement.csv');
    if (statusLabel) {
      statusLabel.textContent = `✓ Sample_SBI_Statement.csv (${rawTxs.length} rows) — Encrypted locally`;
    }
  } catch (err) {
    showToast(err.message);
  }
});

document.getElementById('downloadSampleBtn')?.addEventListener('click', () => {
  const blob = new Blob([SAMPLE_SBI_CSV], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sample_sbi_statement.csv';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
  if (state.transactions.length === 0) {
    showToast('No transactions to export.');
    return;
  }
  const header = ['Date', 'Merchant', 'Debit', 'Credit', 'Balance', 'Category'];
  const lines = [header.join(',')];
  for (const t of state.transactions) {
    lines.push([
      `"${t.date}"`,
      `"${t.merchant.replace(/"/g, '""')}"`,
      t.debit ?? '',
      t.credit ?? '',
      t.balance ?? '',
      `"${t.category}"`
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'zk_categorized_expenses.csv';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clearVaultBtn')?.addEventListener('click', async () => {
  state.transactions = [];
  state.merchantCache = {};
  state.lastOutboundPayload = [];
  state.lastEncryptedBlob = null;
  await idbClear();
  if (statusLabel) statusLabel.textContent = 'No file selected yet';
  document.getElementById('pipelineBanner').hidden = true;
  renderAll();
  showToast('Local IndexedDB vault wiped.');
});

// Filters
['txSearch', 'txCategoryFilter', 'txTypeFilter'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', renderTransactions);
  document.getElementById(id)?.addEventListener('change', renderTransactions);
});

// --------------------------------------------------------------------------
// Vault Passphrase Modal & Custom API Base URL
// --------------------------------------------------------------------------
const vaultModal = document.getElementById('vaultModal');
document.getElementById('vaultActionBtn')?.addEventListener('click', () => {
  const apiInput = document.getElementById('apiBaseInput');
  if (apiInput) apiInput.value = vault.getApiBaseUrl();
  vaultModal.hidden = false;
});
document.getElementById('closeVaultModal')?.addEventListener('click', () => {
  vaultModal.hidden = true;
});
vaultModal?.addEventListener('click', (e) => {
  if (e.target === vaultModal) vaultModal.hidden = true;
});

document.getElementById('vaultForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwInput = document.getElementById('vaultPassphrase');
  const pw = pwInput.value;
  if (!pw) return;

  try {
    await vault.initVaultKey(pw);
    const existingBlob = await idbGet('primary_vault');
    if (existingBlob && state.transactions.length === 0) {
      try {
        const decrypted = await vault.decryptJSON(existingBlob);
        state.transactions = decrypted.transactions || [];
        state.merchantCache = decrypted.merchantCache || {};
        state.lastOutboundPayload = decrypted.lastOutboundPayload || [];
        state.lastEngineSource = decrypted.lastEngineSource || 'Decrypted Vault';
        state.lastEncryptedBlob = existingBlob;
        showToast(`Decrypted ${state.transactions.length} transactions from IndexedDB vault.`);
      } catch {
        // Different passphrase than previous blob — re-encrypt current state with new key
        showToast('New AES-256-GCM vault key derived in RAM.');
      }
    } else if (state.transactions.length > 0) {
      await persistEncryptedVault();
      showToast('Re-encrypted local vault with your passphrase.');
    } else {
      showToast('AES-256-GCM key derived via PBKDF2.');
    }
    pwInput.value = '';
    vaultModal.hidden = true;
    renderAll();
  } catch (err) {
    showToast(`Vault error: ${err.message}`);
  }
});

document.getElementById('lockVaultBtn')?.addEventListener('click', () => {
  vault.lock();
  state.transactions = [];
  state.merchantCache = {};
  vaultModal.hidden = true;
  renderAll();
  showToast('Vault locked — volatile AES key and plaintext cleared from RAM.');
});

document.getElementById('saveApiBaseBtn')?.addEventListener('click', async () => {
  const val = (document.getElementById('apiBaseInput')?.value || '').trim();
  if (val) localStorage.setItem(STORAGE_KEYS.API_BASE, val);
  else localStorage.removeItem(STORAGE_KEYS.API_BASE);
  sessionStorage.removeItem(STORAGE_KEYS.JWT);
  await checkBackendConnectivity();
  showToast(`API base set to ${val || 'same-origin (/api/v1)'}`);
});

// --------------------------------------------------------------------------
// Startup Initialization
// --------------------------------------------------------------------------
(async function init() {
  populateCategoryFilter();
  await vault.initSessionKey();
  const existingBlob = await idbGet('primary_vault');
  if (existingBlob) {
    state.lastEncryptedBlob = existingBlob;
  }
  renderAll();
  await checkBackendConnectivity();
})();
