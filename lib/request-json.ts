// A timeout does not prove failure. Retry financial actions with the same ID.
export async function requestJson(url: string, init: RequestInit = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status}). Please try again.`);
    if (!data) throw new Error('Unreadable response. Check the request history before retrying.');
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('No response received. Check request history or retry; the same request will not be saved twice.');
    throw error;
  } finally { clearTimeout(timer); }
}
