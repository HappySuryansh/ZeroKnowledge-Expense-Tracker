# Zero-Knowledge Expense Tracker — Integration & Deployment Guide

## What Was Added (Zero Original Files Changed)
Every existing file in `backend/` and `frontend/` from your original archive is **100% untouched**. The new frontend UI has been upgraded into a complete 6-phase Zero-Knowledge web application and placed inside Spring Boot's static resource folder:

- `backend/src/main/resources/static/index.html`
- `backend/src/main/resources/static/style.css`
- `backend/src/main/resources/static/script.js`
- `Dockerfile` & `render.yaml` (for one-click cloud deployment)

Because Spring Boot serves `static/` on the **exact same origin** as `/api/v1/auth/device-register` and `/api/v1/categorize`, the deployed app works without any CORS changes to your Java controllers.

---

## 1. Run Locally (for College Viva / Demo)

### Windows (PowerShell)
```powershell
cd Zero-Knowledge-Stateless-Expense-Tracker\backend
$env:LLM_API_KEY="YOUR_GEMINI_API_KEY"
$env:JWT_HMAC_SECRET="replace_with_at_least_32_character_random_secret_key_for_hs256"
.\mvnw.cmd spring-boot:run
```

### macOS / Linux
```bash
cd Zero-Knowledge-Stateless-Expense-Tracker/backend
export LLM_API_KEY="YOUR_GEMINI_API_KEY"
export JWT_HMAC_SECRET="replace_with_at_least_32_character_random_secret_key_for_hs256"
./mvnw spring-boot:run
```

Then open **`http://localhost:8080`** in your browser.
- The sidebar status indicator will turn green (**Spring Boot API Ready**).
- Click **Load Sample SBI Statement** (or drag & drop a real SBI `.xlsx`/`.xls`/`.csv` statement) to run all 6 phases live!

---

## 2. Deploy Live (Free on Render.com)

1. Push `Zero-Knowledge-Stateless-Expense-Tracker` to a GitHub repository.
2. Go to [Render](https://render.com) → **New +** → **Blueprint** (or **Web Service** → select your repo → **Docker** runtime).
3. Add the two environment variables:
   - `LLM_API_KEY` = your Google Gemini API key
   - `JWT_HMAC_SECRET` = any random string of at least 32 characters (auto-generated if using `render.yaml`)
4. Click **Deploy**. Render builds the Docker image and gives you a live HTTPS URL serving both the UI and the stateless Spring AI API.

---

## 3. College Minor Project Viva Walkthrough
1. **Dashboard**: Click **Load Sample SBI Statement** or upload an SBI Excel/CSV file. Watch the live 6-phase progress stepper run (`Vault → Parse → Firewall → Spring AI → Encrypt → Insights`).
2. **Privacy Vault**: Show examiners the **Exact Outbound API Payload** JSON (`{ "merchants": [...] }`), the **Firewall Redaction Proof** table (confirming zero dates, amounts, RRNs, or balances left the device), and the live **AES-256-GCM Ciphertext** stored in IndexedDB.
3. **Transactions**: Demonstrate live search, category filtering, manual category reassignment (auto re-encrypted locally), and CSV export.
4. **Insights**: Show on-device Cash Flow, Category Breakdown bars, Essential vs. Discretionary split, and Recurring Merchant detection.
5. **Vault Passphrase**: Click **Vault Unlocked** in the sidebar to derive a PBKDF2 passphrase key, lock the vault to wipe RAM, and unlock it again to prove client-side encryption.
