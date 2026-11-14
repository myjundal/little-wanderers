# Staff desk: payments and waivers

Use **Staff → Check-in**. These tools work with a normal staff login or an active staff PIN session. Each connection records the employee and preserves the original visit times and signed waiver.

## Normal visit

1. Search for the existing family before creating a new family.
2. Confirm the guardian and children. Have the guardian complete the waiver.
3. Select the people present and record check-in.
4. Start payment with **Pay … in Square**, then confirm the desk shows **Paid**.
5. When they leave, choose **Check out family**. This saves departure time and updates occupancy; checkout does not itself settle a payment.

## Already paid directly in the Square app

1. Open the family and go to **Need help with this family? → Already paid in Square**.
2. Open **Transactions** in Square and check the completed receipt. Enter the receipt number, receipt link or card's last four digits into the desk search.
3. Match the receipt time, admission amount, items and card details. A receipt can include snacks or drinks, but its admission portion must match the family's admission amount.
4. Select that receipt and confirm it belongs to this family. Choose **Connect receipt — mark admission paid**.
5. Confirm **Paid** on the family. The family leaves the unpaid list; a departed family's checkout time stays unchanged.

This action connects an existing payment and never charges the card. Pending/refunded payments, receipts already used by another booking/family, incompatible amounts and an unresolved website Square checkout cannot be connected. If there is a pending website checkout, use its existing verification/recovery controls first.

If no receipt can be identified, save a payment review note describing what you checked. A review note does not claim that payment was received. Check Square before collecting anything again.

Receipt lookup uses Square's completed payment and receipt fields: [Square Payment reference](https://developer.squareup.com/reference/square/objects/payment).

## Guardian signed, but the waiver is missing from this family

1. Keep the guardian present. Open **Find signed waiver**.
2. Search using the name, email or phone they used when signing.
3. Compare the signed guardian/contact details and each signed child's name and birthday with the existing family.
4. Match each signed child to exactly one child in the family. Explain a nickname, spelling difference or birthday entry error in the reason field.
5. Ask the guardian to confirm their signature, each child and the existing family birthdays. Only then select the confirmation box and **Connect signed waiver**.
6. Confirm the family now shows a completed waiver, then continue check-in.

The original signature and signed child snapshot are retained. Blank birthdays can be completed from the signature. Existing birthdays are never overwritten. This does not merge login accounts or grant access to another family.

If you cannot establish the same family/children, the birthday is uncertain, a child is missing, or the signed source already has account/visit history, save a waiver review note. Ask the guardian to complete a corrected waiver with the correct family/child information. Do not mark an unsigned waiver completed, sign for a parent, or create repeated duplicate families to get past the block.

## Save and review unresolved issues

Choose **Still unsure? Save for owner review**, enter the problem and steps already taken, and save. Use **Other issue** for anything outside payments or waivers. Do not record full card numbers or security codes.

The **Needs review** list is visible on the check-in page to staff and the owner. Open notes remain across dates; no email/SMS is sent. A successful receipt/waiver connection resolves the corresponding current visit's review notes. Otherwise, enter a resolution and choose **Mark note resolved** after the issue has been handled. Closing a note does not change payment or waiver status.

## Owner setup and daily routine

- Apply `db/migrations/20261114_staff_admission_help.sql` before deploying this feature. It adds private case/audit tables and service-only transaction functions; it does not change staff roles, prices, payments or waiver text.
- Demonstrate one receipt connection and one waiver comparison with the team. Staff should use their own login/PIN so the record identifies who handled it.
- At closing, open **Needs review** and inspect any unresolved notes. Actual Square receipts remain the source for received money; notes alone do not verify a payment.
