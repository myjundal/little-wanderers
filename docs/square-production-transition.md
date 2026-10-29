# Square Production 전환 안내

현재 상태: **운영 미배포 / 운영 DB 미변경 / 실제 청구 없음.**
기존 Next.js 예약 화면, Supabase 예약 ID와 테이블, Square Hosted Checkout 및 웹훅 서명 검증을 재사용한다.
새 Supabase 프로젝트는 필수가 아니다. 자동 테스트와 Sandbox 검증은 로컬의 격리된 PostgreSQL(PGlite)을 사용한다.

## 검증 결과와 남은 확인

- 실제 Square Sandbox Invoice 하나로 총 $300, 예약금 $150, 잔금 $150을 구성했다.
- Sandbox 카드로 예약금 결제 → 로컬 예약 `pending → confirmed`를 확인했다.
- **같은 Invoice**에서 잔금 결제 → 총 납부 $300, 잔액 $0을 확인했다.
- 클래스 Hosted Checkout Sandbox 테스트 패널의 결제 후, 실제 Order/Payment 재조회와 로컬 등록 반영을 확인했다.
- 서명 위조, 금액·통화·매장·고객 불일치, URL만으로 확정 시도, DB 장애 후 웹훅 재시도, 중복 이벤트,
  오래된 Invoice 버전, 미납 멤버십, 기존 클래스 사전등록 ID 보존은 자동 테스트로 검증한다.
- 임시 Sandbox 콜백으로 **Square가 실제 발송한 `invoice.payment_made`**의 서명 검증 → HTTP 200 →
  `webhook_log.processing_status='processed'` → 로컬 예약 확정을 확인했다. 임시 웹훅 구독과 터널은 제거했다.
  실제 운영 도메인 전달은 운영 웹훅 설정 후 별도 확인해야 한다.
- **멤버십 전체 청구 검증은 미완료다.** Checkout Sandbox 시뮬레이터는 고객/구독 연결 정보를 생성하지 않았다.
  별도 Sandbox `CreateSubscription`도 `DEACTIVATED`, `invoice_ids=[]`가 되어 최초 유료 구독 Invoice를 얻지 못했다.
  취소 API는 성공했으나, 활성 상태가 필요한 일시정지와 정상 청구·갱신까지 성공했다고 볼 수 없다.
  이 상태에서는 멤버십을 부여하지 않는다. `MEMBERSHIP_PAYMENTS_ENABLED=false`를 유지한다.
- 실제 POS 앱/기기는 Sandbox에서 사용할 수 없다. POS 결제가 반영된 Invoice 상태는 로컬 fixture로 검증했다.
  실제 기기 결제 및 실서비스 구독 결제 검증은 **별도 승인 후** 수행할 항목이다.

관련 공식 자료:
[Invoice 결제 방식](https://developer.squareup.com/docs/invoices-api/pay-refund-invoices),
[Sandbox 제한](https://developer.squareup.com/docs/devtools/sandbox/overview),
[Square 직원의 구독 Sandbox 제한 안내](https://developer.squareup.com/forums/t/sandbox-subscriptions/23778).

## 바뀐 결제 흐름

1. 예약 화면에서 기존 날짜·시간·보호자·아이·인원 입력을 받는다.
2. DB에서 시간대를 잠그고 `pending` 예약을 만든다. 동일 요청 재시도는 같은 예약 ID를 사용한다.
3. 같은 예약 ID에 Square 고객, $300 Order, Invoice를 연결한다. 예약금 `DEPOSIT=$150`, `BALANCE=$150`, 자동 청구는 `NONE`이다.
4. 고객을 Square Invoice 결제 화면으로 보낸다. 이름·나이·메모를 돌아오는 URL에 싣지 않는다.
5. 서명 검증 후 Square Invoice/Order를 다시 조회하고 매장·환경·고객·주문·통화·금액을 검증한다.
6. 완료된 예약금 $150이 확인된 경우에만 예약을 확정한다. Invoice 전체 `PAID`까지 기다릴 필요는 없다.
7. 잔금은 같은 Invoice URL로 받는다. 잔금 안내 메일도 이 Invoice의 실제 미납액과 최신 URL을 사용한다.
8. 취소·환불·불명확한 납부는 검토 대상으로 남긴다. 자동 환불은 구현하지 않았다.

대기 예약은 30분 후 정리 대상이 된다. 기존 일일 reminder Cron이 Square에서 미납 Invoice를 취소한 뒤 시간대를 해제한다.
정리 작업 실행 전까지 대기는 계속 시간대를 차지한다. API 장애나 결제 진행 중에는 시간대를 임의로 해제하지 않는다.
유료 Invoice가 연결된 예약의 날짜 변경은 직원에게 문의하도록 한다. 날짜·Invoice 납기일을 함께 변경하는 작업이 필요하다.

기존 예약은 그대로 보존하며 자동 Invoice 생성·미납 판정·재청구를 하지 않는다.
기존 예약의 실제 납부 내역과 연결이 필요한 경우 소유자가 먼저 수동 대조해야 한다.

## 운영 DB 변경 — 아직 실행하지 말 것

승인된 전환 시 `db/migrations/20261029_square_payment_fulfillment.sql`을 적용한다.
새 Invoice 연결 컬럼, 환경별 Catalog 매핑, 결제 시도/영수증, 처리 상태와 서버 전용 함수가 추가된다.
브라우저 역할은 예약·멤버십·클래스 등록·Square 고객 매핑을 직접 수정할 수 없고 기존 인증된 서버 API를 사용한다.
기존 예약 ID·시간·고객 정보는 수정하지 않는다.

새 결제 기능은 이 migration 적용 전에는 열지 않는다. 이전 코드의 무입금 예약 확정도 새 DB 보호에 막히므로,
운영 적용은 예약 접수를 잠시 닫고 migration → 새 코드 배포 → 승인된 결제 기능 활성화 순서로 맞춘다.

## 환경변수: 누가 어디에 입력하는가

운영 값은 **Vercel → little-wanderers → Settings → Environment Variables → Production**에 입력한다.
로컬 `.env.local` 및 Vercel Preview는 Sandbox로 유지한다. Preview가 운영 Supabase를 사용한다면
테스트 예약/등록을 실행하지 않는다. 아래 로컬 테스트 스크립트는 Supabase에 연결하지 않는다.
환경변수 수정은 다음 배포부터 반영된다.

| 변수 | Production 값 / 가져오는 곳 |
|---|---|
| `SQUARE_ENVIRONMENT` | `production` |
| `SQUARE_ACCESS_TOKEN` | Square Developer Console → 기존 앱 → Production → Credentials → Production Access Token. 서버 비밀값 |
| `SQUARE_LOCATION_ID` | 실제 USD 결제 매장의 Production Location ID. Sandbox ID 복사 금지 |
| `SQUARE_API_VERSION` | 검증한 버전으로 고정. 이번 Sandbox 실행은 `2026-07-15` 사용 |
| `SQUARE_WEBHOOK_URL` | `https://www.thelittlewanderers.com/api/webhooks/square` |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | 아래 Production 웹훅 구독의 Signature Key. Access Token과 다른 서버 비밀값 |
| `SQUARE_PARTY_ITEM_VARIATION_ID` | 운영 $300 고정 가격 파티 상품의 **ITEM_VARIATION ID** |
| `SQUARE_PLAN_VARIATION_ID` | 운영 월 $60 단일 유료 phase의 **SUBSCRIPTION_PLAN_VARIATION ID**. 상위 Plan ID 아님 |
| `PARTY_PAYMENTS_ENABLED` | 초기 `false`. 파티 검증·승인 후에만 `true` |
| `MEMBERSHIP_PAYMENTS_ENABLED` | `false` 유지. 구독 결제·갱신·실패·해지 검증 및 별도 승인 후 활성화 |
| `CLASS_PAYMENTS_ENABLED` | 초기 `false`. 기존 클래스 사전등록은 계속 사용 가능 |
| `NEXT_PUBLIC_SITE_URL` | `https://www.thelittlewanderers.com` |
| `NEXT_PUBLIC_BASE_URL` | 남아 있는 기존 호출을 위해 같은 운영 주소 유지 |
| `CRON_SECRET` | Vercel 예약 작업에 사용할 서버 비밀값. 기존 정상 설정이면 유지 |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OWNER_EMAIL` | 실제 운영 발송 계정/검증된 발신 주소/소유자 알림 주소 유지 |

`SQUARE_ENV`는 제거하거나 `SQUARE_ENVIRONMENT`와 일치시킨다. `SQUARE_BASE_URL`은 제거해 환경으로 결정하게 한다.
`PARTY_REMINDER_SECRET`은 제거하거나 `CRON_SECRET`과 맞춘다. Bearer 인증은 `CRON_SECRET`을 우선 사용한다.
`PARTY_EXTRA_GUEST_CENTS`는 새 고정 $300 Invoice 계산에 사용하지 않는다. 추가 요금은 별도 정책·Invoice 수정 작업이 필요하다.
`NEXT_PUBLIC_SQUARE_APPLICATION_ID`와 `NEXT_PUBLIC_SQUARE_POS_API_VERSION`은 현재 Hosted Checkout/Invoice 코드에서 사용하지 않는다.
현재 단일 판매자 연동에 OAuth Application Secret이나 공개 Access Token 변수를 새로 넣을 필요는 없다.
운영 Supabase URL/Anon Key/Service Role Key는 기존 프로젝트 값 그대로 유지한다.

로컬/Preview에서는 `SQUARE_ENVIRONMENT=sandbox`, Sandbox 토큰·매장·Catalog ID·웹훅 Signature Key를 사용한다.
`SQUARE_SANDBOX_EMAIL_TO`를 비워 두면 Sandbox 파티 확인/안내 메일을 발송하지 않는다.
이 값을 지정하면 Sandbox 파티 메일은 해당 테스트 주소로만 발송한다.

### 클래스 Production Catalog 매핑

각 클래스에 대응하는 운영 상품 Variation ID를 `square_catalog_mappings`에 저장한다.
예시는 실제 ID를 채운 뒤 승인된 DB 작업에서 실행한다.

```sql
insert into public.square_catalog_mappings(environment,kind,entity_key,variation_id)
values ('production','class','CLASS_UUID','PRODUCTION_ITEM_VARIATION_ID')
on conflict(environment,kind,entity_key) do update set variation_id=excluded.variation_id;
```

`catalog_items`의 기존 Sandbox ID나 `classes.external_id`를 일괄 덮어쓰지 않는다.
파티 가격은 $300, 멤버십 가격은 기존 코드의 월 $60과 일치해야 한다. 다르면 자동 가격 덮어쓰기 대신 오류로 막는다.

## Square 웹훅 설정

Square Developer Console → 기존 앱 → **Production → Webhooks**에서 운영 구독을 설정한다.
Notification URL은 위 `SQUARE_WEBHOOK_URL`과 정확히 일치해야 하며 리디렉션·로그인 보호가 없어야 한다.
Sandbox 구독은 별도 공개 테스트 콜백과 별도 Signature Key를 사용한다.

이벤트:

- `invoice.created`, `invoice.published`, `invoice.updated`, `invoice.payment_made`, `invoice.canceled`, `invoice.refunded`, `invoice.scheduled_charge_failed`
- `payment.created`, `payment.updated`, `refund.created`, `refund.updated`, `order.updated`
- `subscription.created`, `subscription.updated`

결제 완료 시 실제 Square delivery log의 2xx 응답과 DB의 `processing_status='processed'`를 함께 확인한다.
단순 Test Event 수신이나 서명 fixture 통과를 실제 결제 전달 검증으로 간주하지 않는다.
실패한 기록은 재처리 가능하며, 완료된 기록만 중복 전달을 건너뛴다.

## 현장 POS 잔금

Square POS → More → Invoices → **기존 해당 Invoice 선택** → Add payment → Remaining amount.
카드/현금 등 실제 수납 수단으로 완료하면 같은 Invoice의 잔금에 반영된다.
새 $150 판매나 별도 Payment Link를 만들지 않는다.
단순 Mark as paid는 실제 카드 청구와 다르므로 실제 수납 내역을 확인하고 사용한다.

## 로컬 및 Sandbox 재검증

```sh
npm ci
node --test tests/*.test.mjs
npm run lint
npm run build
```

실제 외부 Sandbox 리소스를 생성하는 명시적 테스트:

```sh
node scripts/test-square-sandbox.mjs
node scripts/test-square-checkouts-sandbox.mjs
```

외부 웹훅 전달을 재검증하려면 공식 `cloudflared` 바이너리를 준비한 뒤 다음을 실행한다.
가짜 데이터만 사용하는 별도 콜백 하나를 잠시 공개하고, 새 Sandbox 웹훅 구독과 키는 메모리에만 보관한다.
스크립트가 출력한 Sandbox Invoice에서 예약금을 결제하면 실제 웹훅에 의한 예약 확정을 확인하고,
임시 웹훅 구독·터널 및 미완납 테스트 Invoice를 정리한다. 운영 DB는 연결하지 않는다.

```sh
node scripts/test-square-webhook-sandbox.mjs /absolute/path/to/cloudflared
```

결과는 `/tmp/little-wanderers-square-webhook.json`에 저장된다.
이 검증에서도 운영 웹훅 설정을 바꾸거나 실제 카드를 사용하지 않는다.
Preview 빌드는 성공했지만 Vercel SSO 보호로 브라우저 UI 검토는 아직 하지 못했다.

스크립트가 출력한 **Sandbox URL**에서 테스트 결제를 진행한다. Invoice는 테스트 카드
`4111111111111111`, 미래 유효기간, CVV `111`, 우편번호 `10001`을 사용할 수 있다.
Checkout 링크는 Square Sandbox Testing Panel로 열린다.
두 스크립트는 Production 환경이면 실행을 거부하고, 운영 Supabase 대신 로컬 메모리 DB만 사용한다.
테스트 결과는 `/tmp/little-wanderers-square-sandbox.json`, `/tmp/little-wanderers-square-checkouts.json`에 저장된다.
테스트 리소스는 Sandbox에만 남는다. 별도 구독 API 테스트의 취소 결과도 확인한다.

## 운영 전환 및 중지 순서

1. 변경 코드와 DB migration을 검토하고, 실제 웹훅 전달을 테스트 콜백에서 확인한다.
2. Production 매장·파티 Catalog ID·웹훅 정보를 준비한다. 아직 모든 결제 flag는 `false`로 둔다.
3. **사용자의 명시적 승인 후에만** 운영 migration, 새 코드 배포, 파티 결제 활성화를 수행한다.
4. 최초 실제 결제·POS 검증은 금액과 대상을 정해 별도 승인 후 진행한다.
5. 멤버십은 Sandbox 제한 때문에 전 과정 성공을 주장할 수 없다. 별도 실서비스 검증 승인 전에는 닫아 둔다.
6. 문제가 생기면 해당 `*_PAYMENTS_ENABLED=false`로 새 결제를 닫고 다시 배포한다.
   이미 발행한 Invoice·구독은 Square에서 계속 유효할 수 있으므로, flag를 내리는 것만으로 청구가 취소되지는 않는다.
   기존 Invoice·구독은 Square에서 별도 확인하고, 웹훅과 결제 매핑 DB는 보존한다.
