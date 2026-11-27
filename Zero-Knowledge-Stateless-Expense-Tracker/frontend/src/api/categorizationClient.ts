// src/api/categorizationClient.ts

export interface CategorizationResponse {
  categoryMap: Record<string, string>;
}

export async function categorizeMerchantsStateless(
  apiBaseUrl: string,
  jwtToken: string,
  isolatedMerchants: string[]
): Promise<Record<string, string>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s (3 min) timeout

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/categorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      // Outbound payload strictly contains ONLY the string array of isolated merchants
      body: JSON.stringify({ merchants: isolatedMerchants }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new Error('Rate limit exceeded for this device token.');
    }

    if (!response.ok) {
      const errText = await response.text();
      let message = `Categorization request failed with status ${response.status}`;
      try {
        const json = JSON.parse(errText);
        if (json.message) {
          message = `${message}: ${json.message}`;
        }
      } catch {
        if (errText) {
          message = `${message}: ${errText}`;
        }
      }
      throw new Error(message);
    }

    const data: CategorizationResponse = await response.json();
    return data.categoryMap;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Categorization request timed out after 3 minutes. Check backend terminal for LLM connectivity.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
