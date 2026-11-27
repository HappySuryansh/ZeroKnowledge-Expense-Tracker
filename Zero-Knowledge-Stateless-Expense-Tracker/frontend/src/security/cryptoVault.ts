// src/security/cryptoVault.ts

export class CryptoVault {
  private volatileKey: CryptoKey | null = null;
  private static readonly DEVICE_SECRET_KEY = 'zk_device_secret';
  private static readonly JWT_STORAGE_KEY = 'zk_scoped_jwt';

  /**
   * Derives a 256-bit AES-GCM CryptoKey from user password + salt via PBKDF2.
   * Stored strictly in volatile class memory (never serialized to storage).
   */
  public async initVaultKey(password: string, salt?: Uint8Array): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const activeSalt = salt ?? window.crypto.getRandomValues(new Uint8Array(16));

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
        salt: activeSalt as any,
        iterations: 100000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt']
    );

    return activeSalt;
  }

  public isUnlocked(): boolean {
    return this.volatileKey !== null;
  }

  /**
   * Retrieves or creates the random device secret and exchanges it for a scoped JWT.
   */
  public async ensureDeviceToken(apiBaseUrl: string): Promise<string> {
    const existingJwt = sessionStorage.getItem(CryptoVault.JWT_STORAGE_KEY);
    if (existingJwt) return existingJwt;

    let deviceSecret = localStorage.getItem(CryptoVault.DEVICE_SECRET_KEY);
    if (!deviceSecret) {
      deviceSecret = window.crypto.randomUUID();
      localStorage.setItem(CryptoVault.DEVICE_SECRET_KEY, deviceSecret);
    }

    const response = await fetch(`${apiBaseUrl}/api/v1/auth/device-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceSecret }),
    });

    if (!response.ok) {
      throw new Error(`Device registration failed: ${response.statusText}`);
    }

    const { token } = await response.json();
    sessionStorage.setItem(CryptoVault.JWT_STORAGE_KEY, token);
    return token;
  }
}