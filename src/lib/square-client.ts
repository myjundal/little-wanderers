export type SquareEnvironment = 'sandbox' | 'production';
export type PaymentFlow = 'party' | 'membership' | 'class' | 'admission';

export function squareEnvironment(): SquareEnvironment {
  const value = (process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox').trim().toLowerCase();
  if (value !== 'sandbox' && value !== 'production') throw new Error('Invalid Square environment');
  if (process.env.SQUARE_ENV && process.env.SQUARE_ENVIRONMENT && process.env.SQUARE_ENV !== process.env.SQUARE_ENVIRONMENT) {
    throw new Error('Conflicting Square environments');
  }
  return value;
}

export function squareConfig() {
  const environment = squareEnvironment();
  const baseUrl = environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  if (process.env.SQUARE_BASE_URL && process.env.SQUARE_BASE_URL.replace(/\/$/, '') !== baseUrl) {
    throw new Error('Square API URL does not match its environment');
  }
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) throw new Error('Square is not configured');
  return { environment, baseUrl, token, locationId, version: process.env.SQUARE_API_VERSION || '2025-10-16' };
}

export function paymentFlowEnabled(flow: PaymentFlow) {
  return process.env[`${flow.toUpperCase()}_PAYMENTS_ENABLED`] === 'true';
}

export function requirePaymentFlow(flow: PaymentFlow) {
  if (!paymentFlowEnabled(flow)) throw new Error(`${flow} payments are not available yet`);
  return squareConfig();
}

export function squareSiteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (!value) throw new Error('Site URL is not configured');
  const url = new URL(value);
  if (squareEnvironment() === 'production' && url.protocol !== 'https:') throw new Error('Production requires an HTTPS site URL');
  return url.origin;
}

/** One environment, API version and timeout for all server-side Square calls. Never return provider bodies or credentials to clients. */
export async function squareRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const config = squareConfig();
  if (!path.startsWith('/v2/')) throw new Error('Invalid Square API path');
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'Square-Version': config.version },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok) {
    const codes = (data.errors ?? []).map((error: { code?: string }) => error.code).filter(Boolean).join(',');
    throw new Error(`Square request failed (${response.status}${codes ? `: ${codes}` : ''})`);
  }
  return data as T;
}

export type SquareMoney = { amount?: number; currency?: string };
export type SquareOrder = {
  id: string;
  location_id?: string;
  reference_id?: string;
  customer_id?: string;
  state?: string;
  total_money?: SquareMoney;
  net_amount_due_money?: SquareMoney;
  tenders?: Array<{ payment_id?: string; customer_id?: string }>;
  created_at?: string;
  line_items?: Array<{note?:string}>;
  fulfillments?: Array<{ digital_details?: { recipient?: { customer_id?: string; email_address?: string; phone_number?: string } }; pickup_details?: { recipient?: { customer_id?: string; email_address?: string; phone_number?: string } } }>;
};
export type SquareInvoice = {
  id: string;
  version: number;
  location_id?: string;
  order_id?: string;
  subscription_id?: string;
  status?: string;
  public_url?: string;
  primary_recipient?: { customer_id?: string };
  payment_requests?: Array<{
    request_type?: string;
    computed_amount_money?: SquareMoney;
    total_completed_amount_money?: SquareMoney;
    due_date?: string;
  }>;
};

export function assertUsd(money: SquareMoney | undefined, amount: number) {
  if (money?.currency !== 'USD' || money.amount !== amount) throw new Error('Square amount or currency does not match');
}

export function assertSquarePaymentUrl(value: string | undefined) {
  if (!value) throw new Error('Square did not return a payment URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['square.link', 'squareup.com', 'squareupsandbox.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    throw new Error('Invalid Square payment URL');
  }
  return value;
}
