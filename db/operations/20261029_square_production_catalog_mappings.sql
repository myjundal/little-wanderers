-- Reviewed Production configuration only: 45 existing class IDs, no registrations or charges.
-- Apply 20261029_square_class_program_checkout.sql first. Safe to re-run with identical mappings.
begin;
do $$
declare desired jsonb := '[
  {
    "class_id": "2bc5544b-5e55-4a62-9114-2d29001e999a",
    "title": "Juega en Español",
    "price_cents": 2500,
    "variation_id": "PQJVMG4LINMQG54CYK2QOI3K",
    "program_key": null
  },
  {
    "class_id": "e7e0f73d-b1c0-4edb-a952-e42789829597",
    "title": "Baby Music",
    "price_cents": 3000,
    "variation_id": "YHDXKPPNFCQPO2GMZ4VIODLV",
    "program_key": null
  },
  {
    "class_id": "8b590b57-1a6a-4318-910f-de883c1960d4",
    "title": "Toddler Yoga",
    "price_cents": 2500,
    "variation_id": "TDHV2FQFNK4HM2UTZBV3YARE",
    "program_key": null
  },
  {
    "class_id": "90cf0d74-6dce-4687-94a1-39f766e01895",
    "title": "PreK+ Ballet",
    "price_cents": 2500,
    "variation_id": "4FMGXASDJ2F7PVCZR3X2MTUD",
    "program_key": null
  },
  {
    "class_id": "e0612c36-3056-4710-a09f-b69de2f612ad",
    "title": "Little Artists - Art & Craft",
    "price_cents": 2500,
    "variation_id": "ZNMYMXYP6RHBNGVDV5QNUNNX",
    "program_key": null
  },
  {
    "class_id": "1fb548f4-97e7-4835-b5e8-719a3465c198",
    "title": "Little Hands, Big Canvases",
    "price_cents": 15000,
    "variation_id": "LPIZJFHU5NCJPXV2OHHHOHWE",
    "program_key": "jamie-art-2026-11-12"
  },
  {
    "class_id": "6f42a7d7-71af-4b49-9e18-9c6246f4b09f",
    "title": "Juega en Español",
    "price_cents": 2500,
    "variation_id": "PQJVMG4LINMQG54CYK2QOI3K",
    "program_key": null
  },
  {
    "class_id": "4822ae2b-3852-4411-bad0-34c23fcb585a",
    "title": "Baby Music",
    "price_cents": 3000,
    "variation_id": "YHDXKPPNFCQPO2GMZ4VIODLV",
    "program_key": null
  },
  {
    "class_id": "498222d9-f829-4f29-8965-1384f20e20e4",
    "title": "Toddler Yoga",
    "price_cents": 2500,
    "variation_id": "TDHV2FQFNK4HM2UTZBV3YARE",
    "program_key": null
  },
  {
    "class_id": "be892bf9-5e7b-4818-9ecc-46b0ae09d179",
    "title": "PreK+ Ballet",
    "price_cents": 2500,
    "variation_id": "4FMGXASDJ2F7PVCZR3X2MTUD",
    "program_key": null
  },
  {
    "class_id": "c735a0d7-fe9b-4199-a36c-4bb4bfa711bb",
    "title": "Little Artists - Art & Craft",
    "price_cents": 2500,
    "variation_id": "ZNMYMXYP6RHBNGVDV5QNUNNX",
    "program_key": null
  },
  {
    "class_id": "d908d9e0-8f5d-40e7-a0f4-264254aa4005",
    "title": "Little Hands, Big Canvases",
    "price_cents": 15000,
    "variation_id": "LPIZJFHU5NCJPXV2OHHHOHWE",
    "program_key": "jamie-art-2026-11-12"
  },
  {
    "class_id": "7b70a71b-d8ac-439b-b392-10dc1fee4bcf",
    "title": "Juega en Español",
    "price_cents": 2500,
    "variation_id": "PQJVMG4LINMQG54CYK2QOI3K",
    "program_key": null
  },
  {
    "class_id": "1e437b55-f3e7-4739-bcde-3c7214598532",
    "title": "Baby Music",
    "price_cents": 3000,
    "variation_id": "YHDXKPPNFCQPO2GMZ4VIODLV",
    "program_key": null
  },
  {
    "class_id": "87528fba-eaac-4d4b-b81d-bfbe62303b2a",
    "title": "Toddler Yoga",
    "price_cents": 2500,
    "variation_id": "TDHV2FQFNK4HM2UTZBV3YARE",
    "program_key": null
  },
  {
    "class_id": "882d3323-780d-4362-bd37-a5b7886c1197",
    "title": "PreK+ Ballet",
    "price_cents": 2500,
    "variation_id": "4FMGXASDJ2F7PVCZR3X2MTUD",
    "program_key": null
  },
  {
    "class_id": "3602a445-d6e2-41df-b306-6cf2b9884d1b",
    "title": "Little Artists - Art & Craft",
    "price_cents": 2500,
    "variation_id": "ZNMYMXYP6RHBNGVDV5QNUNNX",
    "program_key": null
  },
  {
    "class_id": "ff5b171e-c099-43ca-a0a4-2d8d330a8e20",
    "title": "Juega en Español",
    "price_cents": 2500,
    "variation_id": "PQJVMG4LINMQG54CYK2QOI3K",
    "program_key": null
  },
  {
    "class_id": "a36be5b8-545a-4c74-bcba-4482d98b8439",
    "title": "Baby Music",
    "price_cents": 3000,
    "variation_id": "YHDXKPPNFCQPO2GMZ4VIODLV",
    "program_key": null
  },
  {
    "class_id": "b945cbd1-4906-487e-9886-24cde820f01b",
    "title": "Toddler Yoga",
    "price_cents": 2500,
    "variation_id": "TDHV2FQFNK4HM2UTZBV3YARE",
    "program_key": null
  },
  {
    "class_id": "23ae8611-8003-4c27-bc59-e0051dee77d5",
    "title": "PreK+ Ballet",
    "price_cents": 2500,
    "variation_id": "4FMGXASDJ2F7PVCZR3X2MTUD",
    "program_key": null
  },
  {
    "class_id": "ccd7f70e-6eea-4592-9e7f-a802bc572faa",
    "title": "Little Artists - Art & Craft",
    "price_cents": 2500,
    "variation_id": "ZNMYMXYP6RHBNGVDV5QNUNNX",
    "program_key": null
  },
  {
    "class_id": "658d6d0a-5ee9-494a-92bc-cbd654b015c9",
    "title": "Little Hands, Big Canvases",
    "price_cents": 15000,
    "variation_id": "LPIZJFHU5NCJPXV2OHHHOHWE",
    "program_key": "jamie-art-2026-11-12"
  },
  {
    "class_id": "2f016e0a-9f97-4828-8de6-7b6fe2a80449",
    "title": "Juega en Español",
    "price_cents": 2500,
    "variation_id": "PQJVMG4LINMQG54CYK2QOI3K",
    "program_key": null
  },
  {
    "class_id": "949a6925-0c66-44d5-9bb1-e2289668ae4b",
    "title": "Baby Music",
    "price_cents": 3000,
    "variation_id": "YHDXKPPNFCQPO2GMZ4VIODLV",
    "program_key": null
  },
  {
    "class_id": "67607870-745b-4260-9f63-6166f52c8109",
    "title": "Toddler Yoga",
    "price_cents": 2500,
    "variation_id": "TDHV2FQFNK4HM2UTZBV3YARE",
    "program_key": null
  },
  {
    "class_id": "665a12fc-1d1f-4ced-a94b-358818528053",
    "title": "PreK+ Ballet",
    "price_cents": 2500,
    "variation_id": "4FMGXASDJ2F7PVCZR3X2MTUD",
    "program_key": null
  },
  {
    "class_id": "17f3ad6e-7221-4572-ab6e-2906bec06158",
    "title": "Little Artists - Art & Craft",
    "price_cents": 2500,
    "variation_id": "ZNMYMXYP6RHBNGVDV5QNUNNX",
    "program_key": null
  },
  {
    "class_id": "c5efb52d-810a-4dba-947b-e6f4d4a17172",
    "title": "Little Hands, Big Canvases",
    "price_cents": 15000,
    "variation_id": "LPIZJFHU5NCJPXV2OHHHOHWE",
    "program_key": "jamie-art-2026-11-12"
  },
  {
    "class_id": "110f9f76-c2e4-4b12-8516-e6c902bebb23",
    "title": "Juega en Español",
    "price_cents": 2500,
    "variation_id": "PQJVMG4LINMQG54CYK2QOI3K",
    "program_key": null
  },
  {
    "class_id": "40909661-d44f-4629-90e0-735a57247277",
    "title": "Baby Music",
    "price_cents": 3000,
    "variation_id": "YHDXKPPNFCQPO2GMZ4VIODLV",
    "program_key": null
  },
  {
    "class_id": "fd1a259b-b2f3-4392-a069-fb25410384dd",
    "title": "Toddler Yoga",
    "price_cents": 2500,
    "variation_id": "TDHV2FQFNK4HM2UTZBV3YARE",
    "program_key": null
  },
  {
    "class_id": "6cf5544e-c8ae-4776-a887-72de8da8d9a1",
    "title": "PreK+ Ballet",
    "price_cents": 2500,
    "variation_id": "4FMGXASDJ2F7PVCZR3X2MTUD",
    "program_key": null
  },
  {
    "class_id": "e55bf7c2-4910-4d98-af9a-f7e154ee1e7a",
    "title": "Little Artists - Art & Craft",
    "price_cents": 2500,
    "variation_id": "ZNMYMXYP6RHBNGVDV5QNUNNX",
    "program_key": null
  },
  {
    "class_id": "c32be598-1235-4d4a-a92a-435bcbafdef9",
    "title": "Little Hands, Big Canvases",
    "price_cents": 15000,
    "variation_id": "LPIZJFHU5NCJPXV2OHHHOHWE",
    "program_key": "jamie-art-2026-11-12"
  },
  {
    "class_id": "7d47ce86-ae98-4fb9-98c7-0fbda2818ac3",
    "title": "Juega en Español",
    "price_cents": 2500,
    "variation_id": "PQJVMG4LINMQG54CYK2QOI3K",
    "program_key": null
  },
  {
    "class_id": "59ba944f-9ed0-49f7-9f7b-d760b0049367",
    "title": "Baby Music",
    "price_cents": 3000,
    "variation_id": "YHDXKPPNFCQPO2GMZ4VIODLV",
    "program_key": null
  },
  {
    "class_id": "33089a07-b900-4ed9-9991-8380e4af204b",
    "title": "Toddler Yoga",
    "price_cents": 2500,
    "variation_id": "TDHV2FQFNK4HM2UTZBV3YARE",
    "program_key": null
  },
  {
    "class_id": "dd0d9333-1c91-468f-b39d-149a2db83382",
    "title": "PreK+ Ballet",
    "price_cents": 2500,
    "variation_id": "4FMGXASDJ2F7PVCZR3X2MTUD",
    "program_key": null
  },
  {
    "class_id": "491d5ba5-8261-4108-b811-5d629d6eee42",
    "title": "Little Artists - Art & Craft",
    "price_cents": 2500,
    "variation_id": "ZNMYMXYP6RHBNGVDV5QNUNNX",
    "program_key": null
  },
  {
    "class_id": "3bff39c5-30d7-4afc-959b-d8afa863a43e",
    "title": "Juega en Español",
    "price_cents": 2500,
    "variation_id": "PQJVMG4LINMQG54CYK2QOI3K",
    "program_key": null
  },
  {
    "class_id": "36a48739-2990-462c-bd83-cfc8f8d660a7",
    "title": "Baby Music",
    "price_cents": 3000,
    "variation_id": "YHDXKPPNFCQPO2GMZ4VIODLV",
    "program_key": null
  },
  {
    "class_id": "cdc718b0-f69a-4b9e-8e68-7be6bfdb1da3",
    "title": "Toddler Yoga",
    "price_cents": 2500,
    "variation_id": "TDHV2FQFNK4HM2UTZBV3YARE",
    "program_key": null
  },
  {
    "class_id": "80d0f07a-f4d2-4946-ae9a-f31a18a2f6f7",
    "title": "PreK+ Ballet",
    "price_cents": 2500,
    "variation_id": "4FMGXASDJ2F7PVCZR3X2MTUD",
    "program_key": null
  },
  {
    "class_id": "879c5b32-3900-4604-9043-9a5dabcf07d3",
    "title": "Little Artists - Art & Craft",
    "price_cents": 2500,
    "variation_id": "ZNMYMXYP6RHBNGVDV5QNUNNX",
    "program_key": null
  }
]'::jsonb;
begin
  if (select count(*) from jsonb_to_recordset(desired) as d(class_id uuid,title text,price_cents integer)
    join public.classes c on c.id=d.class_id and c.title=d.title and c.price_cents=d.price_cents
    where c.status='scheduled' and c.start_time>now()) <> jsonb_array_length(desired) then
    raise exception 'Class catalog changed since review; check IDs, prices and dates before applying';
  end if;
  if exists(select 1 from jsonb_to_recordset(desired) as d(class_id uuid,variation_id text,program_key text)
    join public.square_catalog_mappings m on m.environment='production' and m.kind='class' and m.entity_key=d.class_id::text
    where m.variation_id is distinct from d.variation_id or m.program_key is distinct from d.program_key) then
    raise exception 'An existing Production mapping differs; review it before replacing';
  end if;
  insert into public.square_catalog_mappings(environment,kind,entity_key,variation_id,program_key)
    select 'production','class',d.class_id::text,d.variation_id,d.program_key
    from jsonb_to_recordset(desired) as d(class_id uuid,variation_id text,program_key text)
    on conflict(environment,kind,entity_key) do nothing;
  if exists(select 1 from public.classes c where c.status='scheduled' and c.start_time>now()
    and not exists(select 1 from public.square_catalog_mappings m where m.environment='production' and m.kind='class' and m.entity_key=c.id::text)) then
    raise exception 'Some scheduled classes have no Production mapping; review the new classes';
  end if;
end $$;
commit;
