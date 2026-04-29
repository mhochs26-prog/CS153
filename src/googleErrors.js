/**
 * @param {unknown} err
 * @returns {string | null}
 */
function extractGoogleApiMessage(err) {
  const e = /** @type {any} */ (err);
  const data = e?.response?.data;
  if (typeof data === "string" && data.trim()) return data.trim();

  if (data?.error?.message) return String(data.error.message);

  const first = data?.error?.errors?.[0];
  if (first?.message) return String(first.message);
  if (first?.reason) return String(first.reason);

  if (data?.error_description) return String(data.error_description);

  if (e?.message) return String(e.message);
  return null;
}

module.exports = { extractGoogleApiMessage };
