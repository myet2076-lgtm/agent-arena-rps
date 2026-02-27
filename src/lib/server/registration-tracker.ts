/**
 * Per-IP hourly registration rate limiter (PRD F01)
 */

const ipRegistrations = new Map<string, number[]>();
const MAX_REGISTRATIONS_PER_IP_PER_HOUR = 3;

export function checkIpRegistrationLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const times = (ipRegistrations.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (times.length >= MAX_REGISTRATIONS_PER_IP_PER_HOUR) {
    return { allowed: false, retryAfterSec: Math.ceil((times[0] + 3600_000 - now) / 1000) };
  }
  return { allowed: true };
}

export function recordIpRegistration(ip: string): void {
  const now = Date.now();
  const times = (ipRegistrations.get(ip) ?? []).filter((t) => now - t < 3600_000);
  times.push(now);
  ipRegistrations.set(ip, times);
}

export function resetRegistrationTracker(): void {
  ipRegistrations.clear();
}
