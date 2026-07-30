// Completes the real host-phone verification flow against a local dev server. Local SMS sends
// are simulated, and only that local response includes the generated code. Production never
// returns a code, so verification scripts cannot accidentally bypass a real text message.

async function getLocalHostAuthHeaders(baseUrl, phone) {
  const requested = await fetch(`${baseUrl}/api/host-verification/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  const requestData = await requested.json().catch(() => ({}));
  if (!requested.ok || !requestData.devCode) {
    throw new Error(
      `Could not request local host verification: HTTP ${requested.status} ${requestData.error || ''}`
    );
  }

  const confirmed = await fetch(`${baseUrl}/api/host-verification/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: requestData.devCode })
  });
  const confirmation = await confirmed.json().catch(() => ({}));
  if (!confirmed.ok || !confirmation.token) {
    throw new Error(
      `Could not confirm local host verification: HTTP ${confirmed.status} ${confirmation.error || ''}`
    );
  }

  return { Authorization: `Bearer ${confirmation.token}` };
}

module.exports = { getLocalHostAuthHeaders };
