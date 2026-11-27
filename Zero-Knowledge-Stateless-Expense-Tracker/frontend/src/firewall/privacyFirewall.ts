// src/firewall/privacyFirewall.ts
import type { RawTransaction } from '../workers/parser.worker';

export interface FirewallOutput {
  /** Deduplicated array of isolated merchant names sent to the backend */
  isolatedMerchants: string[];
  /** Local lookup linking transaction ID -> isolated merchant string for Phase 5 rehydration */
  txToMerchantMap: Record<string, string>;
}

const IGNORED_PREFIX_TOKENS = new Set(['WDL', 'TFR', 'DEP', 'DEBIT', 'CREDIT']);

/**
 * Pure character-code check to verify if a string consists only of digits (no regex).
 */
function isAllDigits(str: string): boolean {
  if (str.length === 0) return false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 48 || code > 57) return false; // '0' is 48, '9' is 57
  }
  return true;
}

/**
 * Normalizes whitespace and strips embedded newlines (\n, \r, \t) without regex.
 */
function normalizeWhitespace(input: string): string {
  const cleanedChars: string[] = [];
  let prevWasSpace = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
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

/**
 * Extracts only the merchant identifier from raw SBI narration strings without regex.
 */
export function extractIsolatedMerchant(rawDetails: string): string {
  const normalized = normalizeWhitespace(rawDetails);

  // Case 1: Standard UPI Transaction -> "WDL TFR UPI/DR/<RRN>/<Merchant>/<Bank>/..."
  const upiIndex = normalized.indexOf('UPI/');
  if (upiIndex !== -1) {
    const upiSubstring = normalized.substring(upiIndex + 4); // skip "UPI/"
    const slashParts = upiSubstring.split('/');

    // slashParts[0] = "DR" or "CR"
    // slashParts[1] = 12-digit RRN
    // slashParts[2] = Merchant Name (or "UPILITE 0095809162097 AT 17930 BURARI, DELHI")
    if (slashParts.length >= 3) {
      let merchantCandidate = slashParts[2].trim();

      // Strip branch location suffix if attached (e.g., UPILITE rows)
      const atIndex = merchantCandidate.indexOf(' AT ');
      if (atIndex !== -1) {
        merchantCandidate = merchantCandidate.substring(0, atIndex).trim();
      }

      // Drop trailing numeric reference numbers (e.g., "0095809162097")
      const tokens = merchantCandidate.split(' ').filter((t) => !(isAllDigits(t) && t.length >= 6));
      return tokens.join(' ').trim();
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
    // Strip long numeric reference numbers or dates (e.g., 0035465570711, 1808202)
    if (isAllDigits(token) && token.length >= 5) return false;
    return true;
  });

  return filteredTokens.join(' ').trim() || 'UNKNOWN_MERCHANT';
}

/**
 * Intercepts in-memory transactions, strips all PII/financials, and deduplicates merchants.
 */
export function runPrivacyFirewall(transactions: RawTransaction[]): FirewallOutput {
  const uniqueSet = new Set<string>();
  const txToMerchantMap: Record<string, string> = {};

  for (const tx of transactions) {
    const merchant = extractIsolatedMerchant(tx.rawDetails);
    txToMerchantMap[tx.id] = merchant;
    if (merchant.length > 0) {
      uniqueSet.add(merchant);
    }
  }
  // console.log(isolatedMerchants: Array.from(uniqueSet));
  return {
    isolatedMerchants: Array.from(uniqueSet),
    txToMerchantMap,
  };
}