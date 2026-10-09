// Secret API keys are not JWTs; legacy service-role JWTs require Bearer authentication.
export function serverApiKeyHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}
