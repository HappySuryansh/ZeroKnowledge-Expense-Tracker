// Example usage inside src/App.tsx
import { useState } from 'react';
import type { RawTransaction } from './workers/parser.worker';
import { runPrivacyFirewall, type FirewallOutput } from './firewall/privacyFirewall';
import { categorizeMerchantsStateless } from './api/categorizationClient';
import { CryptoVault } from './security/cryptoVault';

const vault = new CryptoVault();
const API_BASE_URL = '';

export default function App() {
  const [rawTransactions, setRawTransactions] = useState<RawTransaction[]>([]);
  const [firewallData, setFirewallData] = useState<FirewallOutput | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, string> | null>(null);
  const [status, setStatus] = useState<string>('Idle');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('Phase 2: Parsing statement in local Web Worker...');
    const buffer = await file.arrayBuffer();

    // Vite-native Web Worker instantiation
    const worker = new Worker(
      new URL('./workers/parser.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = async (event) => {
      const { status: workerStatus, transactions, message } = event.data;
      worker.terminate();

      if (workerStatus === 'ERROR') {
        setStatus(`Parser Error: ${message}`);
        return;
      }

      setRawTransactions(transactions);

      // Phase 3: Run Non-Regex Privacy Firewall locally
      setStatus('Phase 3: Stripping PII and isolating merchant strings...');
      const fwOutput = runPrivacyFirewall(transactions);
      setFirewallData(fwOutput);

      // Phase 4: Transmit isolated merchants to Stateless Backend
      try {
        setStatus('Phase 4: Requesting stateless categorization from Spring AI...');
        const jwt = await vault.ensureDeviceToken(API_BASE_URL);
        const mapping = await categorizeMerchantsStateless(
          API_BASE_URL,
          jwt,
          fwOutput.isolatedMerchants
        );
        setCategoryMap(mapping);
        setStatus('Phase 4 Complete: Category map received with zero server persistence.');
      } catch (err: any) {
        setStatus(`Backend Error: ${err.message}`);
      }
    };

    // Transfer the ArrayBuffer zero-copy to the worker thread
    worker.postMessage(buffer, [buffer]);
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h2>Zero-Knowledge Expense Tracker (Phases 1–4)</h2>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} />
      <p>
        <strong>Status:</strong> {status}{' '}
        {rawTransactions.length > 0 && `(${rawTransactions.length} rows parsed in RAM)`}
      </p>

      {firewallData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
          <div>
            <h3>Outbound Firewall Payload ({firewallData.isolatedMerchants.length} Unique Merchants)</h3>
            <pre style={{ background: '#1e1e1e', color: '#a6e22e', padding: '1rem', overflowX: 'auto' }}>
              {JSON.stringify(firewallData.isolatedMerchants, null, 2)}
            </pre>
          </div>
          <div>
            <h3>Returned Category Map (From Spring AI)</h3>
            <pre style={{ background: '#1e1e1e', color: '#66d9ef', padding: '1rem', overflowX: 'auto' }}>
              {categoryMap ? JSON.stringify(categoryMap, null, 2) : 'Awaiting backend response...'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}