'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function CheckoutSuccessPage() {
  const params = useSearchParams();
  const transactionId = params.get('transactionId');
  const [message, setMessage] = useState('Processing...');

  useEffect(() => {
    if (transactionId) {
      setMessage(`Payment successful! Transaction ID: ${transactionId}`);
      // 여기서 백엔드에 결제 완료 기록 업데이트 API 호출 가능
    } else {
      setMessage('Payment info not found.');
    }
  }, [transactionId]);

  return (
    <main style={{ padding: 24 }}>
      <h1>Payment Complete</h1>
      <p>{message}</p>
      <button onClick={() => window.location.href = '/landing'}>
        Go back to Landing
      </button>
    </main>
  );
}

