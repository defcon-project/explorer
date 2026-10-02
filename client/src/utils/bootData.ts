type BootData = { stats?: unknown; dashboardOverview?: unknown };

/** Read inert JSON; executable inline scripts remain forbidden by CSP. */
export function readBootData(): BootData | null {
  const element = document.getElementById('deftrack-boot');
  if (!element) return null;
  try {
    const data: unknown = JSON.parse(element.textContent || 'null');
    return data && typeof data === 'object' && !Array.isArray(data) ? data as BootData : null;
  } catch {
    // Missing or malformed preload data must not prevent normal API loading.
    return null;
  } finally {
    element.remove();
  }
}
