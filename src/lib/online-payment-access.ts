/** Keep dormant paid flows closed until server-verified payment fulfillment exists. */
export function onlinePaymentsUnavailable(): Response | null {
  return Response.json({ ok: false, error: 'Online payments are not available yet. Please contact Little Wanderers for payment assistance.' }, { status: 503 });
}
