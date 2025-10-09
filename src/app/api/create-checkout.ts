import { NextApiRequest, NextApiResponse } from 'next';
import { Client, Environment } from 'square';

const client = new Client({
  environment: Environment.Sandbox, // 테스트용 Sandbox, 실제 서비스 땐 Production으로 변경
  accessToken: process.env.SQUARE_ACCESS_TOKEN!,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { amountCents, visitId } = req.body;

  if (!amountCents || !visitId) {
    return res.status(400).json({ message: 'Missing amountCents or visitId' });
  }

  try {
    const response = await client.checkoutApi.createCheckout(process.env.SQUARE_LOCATION_ID!, {
      idempotencyKey: visitId,
      order: {
	order: {
        locationId: process.env.SQUARE_LOCATION_ID!,
        lineItems: [
          {
            name: 'Visit Payment',
            quantity: '1',
            basePriceMoney: {
              amount: BigInt(amountCents),
              currency: 'USD', // 필요에 따라 변경
            },
          },
        ],
      },
    },
      redirectUrl: 
`${process.env.NEXT_PUBLIC_BASE_URL}/landing/checkout/success`,
    });

    return res.status(200).json({ checkoutUrl: response.result.checkout?.checkoutPageUrl ?? null 
});
  } catch (error) {
    console.error('Square Checkout API error:', error);
    return res.status(500).json({ message: 'Failed to create checkout session' });
  }
}

