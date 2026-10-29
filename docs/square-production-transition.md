# Square Production 전환 안내

현재 상태: **추가 운영 DB 적용 완료 / 새 코드 배포 확인 중 / 실제 청구 없음.**
최초 결제 migration은 사용자가 운영 DB에 적용했고, 주요 테이블·함수 존재를 읽기 전용으로 확인했다.
추가 클래스 프로그램·멤버십/입장권 migration과 상품 매핑 SQL을 운영 DB에 적용했다. 45개 클래스/5회 프로그램, 새 체크인 호출 및 브라우저 납부 수정 차단을 확인했다.
기존 Next.js 예약 화면, Supabase 예약 ID와 테이블, Square Hosted Checkout 및 웹훅 서명 검증을 재사용한다.
새 Supabase 프로젝트는 필수가 아니다. 자동 테스트와 Sandbox 검증은 로컬의 격리된 PostgreSQL(PGlite)을 사용한다.

## 검증 결과와 남은 확인

- 실제 Square Sandbox Invoice 하나로 총 $300, 예약금 $150, 잔금 $150을 구성했다.
- Sandbox 카드로 예약금 결제 → 로컬 예약 `pending → confirmed`를 확인했다.
- **같은 Invoice**에서 잔금 결제 → 총 납부 $300, 잔액 $0을 확인했다.
- 클래스 Hosted Checkout Sandbox 테스트 패널의 결제 후, 실제 Order/Payment 재조회와 로컬 등록 반영을 확인했다.
- 추가 Sandbox 프로그램 결제로 **$150 한 번 → 5회 전체 등록**, 기존 사전등록 ID 보존, 중복 확인의 멱등성을 확인했다.
- 실제 Sandbox 미결제 링크 삭제 후 Square 주문 `CANCELED`와 로컬 checkout `cancelled`를 확인했다. 청구 금액은 $0이다.
- 자동 테스트 110개, ESLint, Next.js production build가 통과했다.
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

## 운영 DB 적용 순서

`db/migrations/20261029_square_payment_fulfillment.sql`은 사용자가 이미 적용했다. 다시 실행하지 않는다.
새 Invoice 연결 컬럼, 환경별 Catalog 매핑, 결제 시도/영수증, 처리 상태와 서버 전용 함수가 추가된다.
브라우저 역할은 예약·멤버십·클래스 등록·Square 고객 매핑을 직접 수정할 수 없고 기존 인증된 서버 API를 사용한다.
기존 예약 ID·시간·고객 정보는 수정하지 않는다.

사용자의 추가 요청 범위에 따라 아래 DB 작업을 적용했다. 이후 단계는 배포 및 활성화 확인이다.

1. `db/migrations/20261029_square_class_program_checkout.sql` 적용.
2. `db/migrations/20261029_square_membership_admission.sql` 적용. 기존 체크인 함수의 다섯 인자 호출도 기본 Production 환경으로 호환한다. 기존 체크인은 `legacy`로 보존하며 과거 납부를 추정하지 않는다.
3. `db/migrations/20261029_square_checkout_recovery.sql` 적용.
4. `db/operations/20261029_square_production_catalog_mappings.sql` 적용. 검토한 클래스 45건을 연결하며,
   이름·가격·날짜가 달라졌거나 기존 매핑이 다르면 전체 작업을 중지한다. 같은 매핑으로 다시 실행할 수 있다.
5. 새 코드 배포 후 소유자 로그인으로 `/api/admin/square/readiness`를 조회한다. 이 점검은 Square 상품·매장·
   웹훅 서명키 일치 여부만 확인하며 주문·고객·구독·청구를 만들지 않는다. 비밀값은 응답하지 않는다.
6. 승인된 결제 기능과 운영 웹훅을 활성화한다. 실제 카드 검증은 금액과 대상을 별도로 승인받는다.

클래스 결제가 열리면 기존 사전등록 버튼 옆에 `Pay & register`가 표시된다. 사전등록은 그대로 보존하며,
입금은 Square Order/Payment를 재조회한 후에만 수강 등록으로 바뀐다. 일반 수업은 선택 날짜별로 결제한다.
미술 프로그램은 명시적으로 연결한 5회 모두에 자리와 동일 참가자가 있을 때만 $150 한 번을 청구한다.
미결제 checkout은 이어서 진행하거나 Square에서 주문 취소를 확인한 뒤 해제할 수 있다.
이미 결제한 수강 등록의 취소·환불은 직원 검토가 필요하다.

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
| `ADMISSION_PAYMENTS_ENABLED` | 초기 `false`. 온라인 입장권과 iPad POS 카드 인계 모두 이 flag를 사용 |
| `SQUARE_APPLICATION_ID` | 기존 Production 앱의 `sq0idp-...` Application ID. Access Token과 다른 공개 식별자 |
| `CLASS_PAYMENTS_ENABLED` | 초기 `false`. 기존 클래스 사전등록은 계속 사용 가능 |
| `NEXT_PUBLIC_SITE_URL` | `https://www.thelittlewanderers.com` |
| `NEXT_PUBLIC_BASE_URL` | 남아 있는 기존 호출을 위해 같은 운영 주소 유지 |
| `CRON_SECRET` | Vercel 예약 작업에 사용할 서버 비밀값. 기존 정상 설정이면 유지 |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OWNER_EMAIL` | 실제 운영 발송 계정/검증된 발신 주소/소유자 알림 주소 유지 |

`SQUARE_ENV`는 제거하거나 `SQUARE_ENVIRONMENT`와 일치시킨다. `SQUARE_BASE_URL`은 제거해 환경으로 결정하게 한다.
`PARTY_REMINDER_SECRET`은 제거하거나 `CRON_SECRET`과 맞춘다. Bearer 인증은 `CRON_SECRET`을 우선 사용한다.
`PARTY_EXTRA_GUEST_CENTS`는 새 고정 $300 Invoice 계산에 사용하지 않는다. 추가 요금은 별도 정책·Invoice 수정 작업이 필요하다.
`NEXT_PUBLIC_SQUARE_APPLICATION_ID`와 `NEXT_PUBLIC_SQUARE_POS_API_VERSION`은 사용하지 않는다. 새 iPad 인계는 서버의 `SQUARE_APPLICATION_ID`와 POS API 1.3을 사용한다.
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
Preview 공개 화면과 격리된 테스트 데이터의 결제 UI를 Chrome에서 확인했다.

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

## 사용자가 직접 진행한 운영 설정 — 이어서 할 작업

사용자가 입력한 값과 이후 읽기 전용 확인 결과를 구분해 기록한다.
Access Token, 서명키 등 비밀값은 이 문서에 기록하지 않는다.

- `20261029_square_payment_fulfillment.sql` 적용 완료를 보고했다.
- Vercel **Production**에 `PARTY_PAYMENTS_ENABLED`, `MEMBERSHIP_PAYMENTS_ENABLED`,
  `CLASS_PAYMENTS_ENABLED`를 모두 `false`로 추가했다.
- `SQUARE_ENVIRONMENT=production`, 운영 `SQUARE_ACCESS_TOKEN`, 운영 `SQUARE_LOCATION_ID`,
  `SQUARE_API_VERSION=2026-07-15`를 저장했다. 기존 Square 환경변수는 없었다.
- 운영 매장의 주소를 실제 매장 주소로 수정했다고 알렸다.
- `SQUARE_WEBHOOK_URL=https://www.thelittlewanderers.com/api/webhooks/square`와
  `SQUARE_WEBHOOK_SIGNATURE_KEY`를 저장했다.
- Production 웹훅에 위 14개 이벤트를 선택했고, 구독은 **비활성화**해 두었다.
- 파티 상품 `Birthday Party - Base Package` 조회 응답에서 고정 가격 USD 30000을 확인했다.
  `SQUARE_PARTY_ITEM_VARIATION_ID=GODQOHDHWLFU4646F7VMBBXG`를 저장했다.
- 기존 멤버십 옵션 2개는 `RELATIVE` 가격이어서 고정 $60 검증에 사용할 수 없었다.
  기존 플랜 `4PFC5GATDWEV4MNFX2ZOGMQE` 아래에 `Little Wanderers Monthly - $60`
  옵션을 추가했다. 사용자 제공 응답에서 단일 `MONTHLY` phase와 `STATIC` USD 6000을 확인했다.
  `SQUARE_PLAN_VARIATION_ID=NRR5O4YJNHVIB4KRDJD5VEAM`를 저장했다.

추가로 확인·준비한 내용:

- Vercel에서 위 Square 환경변수들이 Production에 등록돼 있고, Cron·메일 키가 있는 것을 확인했다.
  비밀값의 유효성은 배포 후 소유자 전용 readiness 점검으로 확인한다.
- 실제 운영 도메인 연결과 HTTPS 응답을 확인했다. `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_URL`은
  **Production만** `https://www.thelittlewanderers.com`으로 저장했다. 기존 Preview·Development 값은 유지했다.
- 사용자 확인에 따라 저녁 미술은 회당 $30 대신 **5회 프로그램 총액 $150**으로 연결한다.
  Square의 기존 저녁 미술 상품 아래 `5-week program package` 고정 USD 15000 옵션을 추가했다.
  Production ITEM_VARIATION ID: `LPIZJFHU5NCJPXV2OHHHOHWE`.
- 클래스 45건의 매핑 SQL을 격리 PostgreSQL에서 두 번 실행해 멱등성과 5회 프로그램 연결을 검증했고,
  검토 이후 가격이 바뀌면 적용을 거부하는 것도 확인했다. 운영 적용은 아직 하지 않았다.
- 기존 PR #68 Preview를 Chrome에서 열어 공개 화면을 확인했다. 남아 있던 “no deposit” 문구도 새 결제 방식에 맞췄다.
- 운영 배포는 여전히 `main`의 `3207909`였다. PR #68은 아직 머지하지 않았다.
- 멤버십 전체 결제 검증은 아직 완료되지 않았다. 월 $60 요금제 준비와 실제 구독 청구 검증을 구분한다.

## Square Stand 현장 사용

사용자가 설명한 회전식 iPad 스탠드와 내장 터치·삽입 리더는 Square Stand 2세대와 일치한다.
모델은 현장에서 확인한다. iPad에 Square POS 앱을 설치하고 실제 운영 매장으로 로그인한 뒤 전원·네트워크·리더를 확인한다.
기기 카드 결제는 Square POS 앱을 사용한다. 웹사이트의 Hosted Checkout은 온라인 결제 흐름이다.

- 일반 입장 카드: 직원 체크인 화면에서 미납 방문을 선택하고 `Take card payment in Square`를 누른다.
  Square 앱으로 전환해 카드 결제 후 복귀하면 서버가 주문·납부·매장·금액·방문 참조를 확인한다.
  현금과 카페 판매는 Square 앱에서 별도로 처리한다. 별도 판매는 사이트 체크인의 납부 상태를 자동 변경하지 않는다.
- 클래스: 사이트의 선택 날짜/프로그램 checkout으로 결제해야 수강 등록과 연결된다.
  POS에서 별도 클래스 상품만 판매하면 사이트 수강 등록이 자동 확정되는 흐름은 아니다.
- 파티 잔금: POS의 **Invoices → 기존 예약의 Invoice → Remaining amount**로 받는다.
  새 $150 판매를 만들면 해당 예약의 Invoice 납부로 연결되지 않는다.
- 멤버십: 사이트의 검증된 구독 checkout을 사용한다. POS에서 $60 상품을 한 번 판매하는 것은 정기 구독 생성과 다르다.

[Square Stand 설치](https://squareup.com/help/us/en/article/8352-set-up-square-stand-2nd-generation),
[Square Stand 결제](https://squareup.com/help/us/en/article/5175-accept-payments-with-square-stand).


## 추가 멤버십·입장권 준비 (2026-10-29)

사용자는 멤버십과 온라인·현장 입장권을 모두 준비하도록 요청했다. 실제 카드 청구는 아직 수행하지 않았다.

- 기존 고정 가족 $60 처리를 공개 요금과 일치시켰다. 등록 시 가족의 아이들을 고정해 첫 아이 $60,
  6개월 이상 추가 아이당 $20이며, 6개월 미만 형제자매는 무료다. 아이 프로필 추가만으로 혜택이 확대되지 않는다.
  새 아이 등록/가족 구성 변경은 직원 검토가 필요하다.
- 같은 STATIC $60 기본 Plan Variation을 사용한다. Checkout의 공식 가격 override로 가족 금액을 설정한다.
  청구 Invoice의 날짜에 해당하는 등록 아이들의 나이로 실제 납부액을 검증한다. 6개월이 되는 아이의 추가 요금은
  다음 갱신일 기준으로 `UpdateSubscription.price_override_money`를 설정한다. 이 호출은 즉시 청구하지 않는다.
- 고객에게 실제 월액과 자동 갱신, 향후 6개월 형제자매 요금을 보여준다. 기존 미결제 링크는 같은 링크를 이어서
  진행하거나 Square 주문 취소 확인 후 해제한다. 일시정지·취소는 신규 가입 flag를 내려도 인증 후 사용할 수 있다.
- `/admission`에서 요금과 입장 조건을 안내한다. `/landing/admission`은 방문 날짜(오늘부터 90일 이내), 가족,
  서버 계산 금액을 검토한 뒤 기존 Square Hosted Checkout을 사용한다. 별도 시간 예약이나 정원 보장은 하지 않는다.
- 검증된 입금 후 날짜·개인별 1회 입장권을 만들며, 기존 가족 QR 체크인 때 사용한다. 기존 waiver와 중복 체크인
  제한, occupancy 처리를 유지한다. 온라인 결제 진행 중인 사람을 카운터에서 중복 청구하지 않도록 막는다.
- 일반 입장 가격은 기존 정책을 재사용한다: 첫 6개월 이상 아이 $16, 영아/추가 형제자매 $10, 성인 2명 포함,
  추가 성인 $5. 온라인 주문은 이름·가격을 고정한 line item을 사용하며 새로운 Catalog ID 환경변수는 필요 없다.
- 직원의 iPad 카드 결제 인계는 기존 Square POS 앱과 Stand를 사용한다. 서버 금액과 임의 참조 ID만 전달하고,
  고객 생년월일을 POS URL에 싣지 않는다. 한 sale은 한 번만 앱을 열어 중복 실행을 막는다.
  취소/중단으로 영수증을 못 받은 경우 자동 재청구하지 않고 기존 Square 거래를 확인한 뒤 소유자가 검토한다.
- POS 실제 기기와 최신 영수증 note 형식은 현장에서 검증해야 한다. 불일치하면 납부 완료로 표시하지 않는다.
- Sandbox 실제 $16 결제에서 두 가족 입장권 생성과 멱등성을 확인했다. 추가 테스트는 요금 변조, 다른 가족,
  등록 아이 범위, 영아 다음 주기 요금, 미납, 1회 체크인, POS 금액/참조/환불을 검증한다.

운영 설정 준비 완료 (아직 활성화/재배포하지 않음):

- Vercel Production: `ADMISSION_PAYMENTS_ENABLED=false` 및
  `SQUARE_APPLICATION_ID=sq0idp-gW-6Z0xfEQJQGUpOOI-xeg` 추가.
- 기존 Square 앱 Production POS callback에 `https://www.thelittlewanderers.com/staff/checkin`을 추가했다.
  기존 callback은 보존했다.

멤버십 실제 최초 구독 청구는 Sandbox 제한으로 여전히 검증되지 않았다. 소유자 전용 운영 결제 우회 경로는
자동 승인 검토에서 거절되어 추가하지 않았다. 일반 멤버십 flag는 실제 금액/대상에 대한 별도 승인 후에만 열고,
사용자가 직접 Square checkout에서 결제한다. 이후 Invoice, 구독, 사이트 혜택을 확인한 뒤 필요한 경우 향후 갱신을 취소한다.

공식 동작 근거:
[Checkout 구독 가격 override](https://developer.squareup.com/docs/checkout-api/subscription-plan-checkout),
[다음 Invoice부터 구독 가격 적용](https://developer.squareup.com/forums/t/square-subscriptions-api-updating-recurring-prices-mid-cycle-without-changing-billing-dates/28215),
[POS 복귀와 결제 검증](https://developer.squareup.com/docs/pos-api/payments-integration).


운영 DB 적용 기록:

- `20261029_square_class_program_checkout.sql`: Success.
- `20261029_square_membership_admission.sql`: Success. 기존 함수는 기본 인자를 가진 새 함수로 교체했다.
- `20261029_square_production_catalog_mappings.sql`: Success.
- 적용 후 조회: `mapped_classes=45`, `program_occurrences=5`, `admission_ready=true`,
  `checkin_ready=true`, `browser_cannot_mark_paid=true`. 기존 다섯 인자 체크인 호출은 인증되지 않은
  테스트 UUID를 `forbidden`으로 거부해 호환성을 확인했다. 실제 사람 체크인이나 결제는 생성하지 않았다.


최종 PR 검토 사항도 반영했다:

- 결제창을 연 다음 새로 만든 사전등록은 납부 반영 때 현재 등록을 다시 찾아 같은 ID로 확정한다.
  결제 준비 시점의 null registration ID에 의존해 중복 insert를 하던 경로를 교체했다.
- 클래스·입장권 대기에 30분 기한을 추가했다. 다음 클래스 조회/해당 가족의 checkout 요청 및 기존 일일 Cron에서
  만료된 대기를 정리한다. 결제가 완료돼 있으면 등록을 반영하고, 미납이면 Square 링크 삭제와 주문 취소를 재조회한 뒤
  대기를 해제한다. provider 장애/결제 진행 중인 경우에는 자리를 유지해 중복 판매하지 않는다.
  고빈도 Cron이 필요하다고 가정하지 않아 Vercel Hobby의 일일 Cron 제한과 호환한다.
- Square 응답 후 DB 매핑 저장이 실패한 경우에는 이미 저장한 동일 idempotency 요청을 재실행해 링크를 복구한다.
  외부 요청을 보내기 전 중단된 대기는 DB 행 잠금으로 취소하고, 뒤늦은 provider 요청 freeze를 차단한다.
- 실제 Sandbox 자동 만료 정리에서도 주문 CANCELED/로컬 cancelled/청구 $0을 확인했다.
- `20261029_square_checkout_recovery.sql` 운영 적용: Success.
