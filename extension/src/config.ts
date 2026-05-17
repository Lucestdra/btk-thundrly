/**
 * Build-time configuration for the extension.
 *
 * Vite injects `import.meta.env.PROD` as `true` in production builds and
 * `false` in dev. We use that to switch between the local FastAPI on
 * `127.0.0.1:8000` and the deployed backend.
 *
 * Why `127.0.0.1` and not `localhost`: WSL / Docker Desktop on Windows
 * often binds an unrelated service to IPv6 `[::1]:8000` (the route
 * resolved by `localhost`), shadowing our backend. Forcing IPv4 makes
 * dev unambiguous. The `manifest.json` host_permissions list both.
 */

const DEV_API_BASE = "http://127.0.0.1:8000";
const PROD_API_BASE = "https://api.thundrly.com";

export const API_BASE = import.meta.env.PROD ? PROD_API_BASE : DEV_API_BASE;

export const ANALYZE_URL = `${API_BASE}/api/analyze-purchase`;
export const ANALYZE_STREAM_URL = `${API_BASE}/api/analyze-purchase/stream`;
export const OBSERVATION_URL = `${API_BASE}/api/price-observation`;
