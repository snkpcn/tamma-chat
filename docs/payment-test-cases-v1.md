# Payment smoke tests

1. New booking creates one `payment_requests` row.
2. Unknown booking amount stays `quote_required` and cannot be accepted by staff.
3. Staff `ตั้งยอด <code> <amount>` moves it to `awaiting_payment`.
4. Customer receives only the owner PromptPay QR.
5. Customer image slip creates one private receipt and sets `proof_submitted`.
6. Duplicate LINE message ID does not create a duplicate receipt.
7. Team receives receipt review card in the bound group.
8. Verify sets `verified`; reject sets `rejected` and customer is notified.
9. Booking/preorder accept action is blocked until `verified`.
10. Wrong team cannot quote, view, or verify another team's payment.
