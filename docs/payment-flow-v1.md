# Payment flow v1

Owner-approved rule: ทำมา-ชาติ accepts customer payment through one channel only: the verified owner PromptPay QR.

Flow:
1. Durable booking/order exists.
2. `payment_requests` is created automatically.
3. If amount is unknown, staff sets it in the bound LINE group with `ตั้งยอด <entity-code> <amount>`.
4. Thongthai sends the verified PromptPay QR to the linked customer LINE contact.
5. Customer returns an image slip in the same LINE chat.
6. Slip is stored privately in Supabase Storage and the payment becomes `proof_submitted`.
7. The bound team LINE group receives the slip with Verify/Reject controls.
8. Only after Verify does the payment become `verified`; customer is notified automatically.
9. Booking/order acceptance is guarded until payment is verified.
10. For a `restaurant_preorder`, verification pushes a refreshed order card into the same restaurant group so staff can accept the order without scrolling for the original card (see `preorderFlex()` in `_restaurant-sot.ts`, which now also shows current payment status).

Backoffice payment review is available at `https://tamma-backoffice.netlify.app/payments.html`.
