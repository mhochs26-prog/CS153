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



/**

 * Calendar/OAuth token expired or revoked (refresh failed).

 *

 * @param {unknown} err

 * @returns {boolean}

 */

function googleAuthNeedsReconnect(err) {

  const e = /** @type {any} */ (err);

  const d = e?.response?.data;

  if (d?.error === "invalid_grant") return true;

  if (typeof d === "string" && d.includes("invalid_grant")) return true;

  const blob = JSON.stringify(d ?? e?.message ?? "");

  if (/invalid_grant/i.test(blob)) return true;

  const msg = extractGoogleApiMessage(err) ?? "";

  return /expired or revoked/i.test(msg);

}



module.exports = { extractGoogleApiMessage, googleAuthNeedsReconnect };

