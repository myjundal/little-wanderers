// src/app/api/square-webhook.ts

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // read/write 가능해야 함
);

export const config = {
  api: {
    bodyParser: false, // Square는 raw body 필요
  },
};

const getRawBody = async (req: NextApiRequest): Promise<string> => {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', err => {
      reject(err);
    });
  });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const rawBody = await getRawBody(req);
  const event = JSON.parse(rawBody);

  const eventType = event?.type;

  if (eventType === 'payment.updated') {
    const payment = event?.data?.object?.payment;
    if (payment?.status === 'COMPLETED') {
      const orderId = payment?.orderId;
      const amount = payment?.amountMoney?.amount; // in cents

      console.log('[Webhook] Payment complete for order:', orderId);

      // TODO: visitId를 어떻게 매핑할지에 따라 변경
      const visitId = payment?.idempotencyKey || orderId;

      // 예시: visits 테이블에 결제 완료 상태 저장
      const { error } = await supabase
        .from('visits')
        .update({
          paid: true,
          paid_amount: amount,
        })
        .eq('id', visitId);

      if (error) {
        console.error('Supabase update error:', error);
        return res.status(500).json({ message: 'DB update failed' });
      }

      return res.status(200).json({ success: true });
    }
  }

  return res.status(200).json({ message: 'Unhandled event type' });
}
