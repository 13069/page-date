export function isPlausibleDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return false;
  const y = d.getFullYear();
  const now = new Date();
  const maxYear = now.getFullYear() + 1;
  const maxFuture = new Date(now.getTime() + 2 * 86400000);
  if (y < 1990 || y > maxYear) return false;
  if (d > maxFuture) return false;
  return true;
}

export function sanitizeDate(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return isPlausibleDate(date) ? date : null;
}
