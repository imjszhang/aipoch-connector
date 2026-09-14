const loopbackHttpHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Missing configuration adopts the product default; malformed values never enable it. */
export function effectiveAllowLoopbackHttp(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw new Error('allowLoopbackHttp must be a boolean.');
  return value;
}

/** Browser admission only: this does not authorize a session or expand outbound URL rules. */
export function isAllowedBrowserOrigin(origin: string, origins: readonly string[], allowLoopbackHttp = false): boolean {
  if (origins.includes(origin)) return true;
  if (!allowLoopbackHttp) return false;
  try {
    const url = new URL(origin);
    // Compare before trusting parsed hostnames: URL parsing normalizes IP aliases and default ports.
    return url.origin === origin && url.protocol === 'http:' && loopbackHttpHostnames.has(url.hostname);
  } catch {
    return false;
  }
}
