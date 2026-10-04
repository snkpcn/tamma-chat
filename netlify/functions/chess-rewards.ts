/**
 * Retired compatibility endpoint.
 *
 * Chess with Thongthai is entertainment only. Keeping this explicit 410
 * response prevents older cached clients from listing, issuing, selecting,
 * or redeeming any former chess discount.
 */

export default async () => new Response(JSON.stringify({
  error: 'chess_rewards_retired',
  message: 'Chess with Thongthai does not issue discounts, coupons, rewards, or OTOP benefits.',
}), {
  status: 410,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});
