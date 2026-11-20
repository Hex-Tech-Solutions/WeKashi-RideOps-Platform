import type { LevelWithSilent } from 'pino';

/**
 * HTTP log level per request.
 *
 * The hot driver routes (GPS pings and the app's polling) used to write one
 * log line per successful request, which cost real CPU under load (load test,
 * Nov 2026). Successful responses on those routes are now silent. Errors and
 * 4xx responses are still logged on every route.
 */
export const QUIET_ROUTES: RegExp[] = [
  /^\/health$/,
  /^\/api\/driver\/location$/,
  /^\/api\/driver\/(offers|rides|scheduled|credits|stats)$/,
  /^\/api\/driver\/rentals\/(available|mine)$/,
  /^\/api\/issues$/,
];

export function httpLogLevel(url: string, statusCode: number, err?: unknown): LevelWithSilent {
  if (err || statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  const path = (url ?? '').split('?')[0];
  return QUIET_ROUTES.some((r) => r.test(path)) ? 'silent' : 'info';
}