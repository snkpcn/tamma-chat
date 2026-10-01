export type OtopOrderItemForMerchandising = {
  order_id: string;
  product_id: string;
  quantity: number | string;
};

export function completedUnitsByProduct(
  completedOrderIds: Iterable<string>,
  items: OtopOrderItemForMerchandising[],
): Map<string, number> {
  const completed = new Set([...completedOrderIds].filter(Boolean));
  const units = new Map<string, number>();
  for (const item of items) {
    if (!completed.has(item.order_id) || !item.product_id) continue;
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    units.set(item.product_id, (units.get(item.product_id) ?? 0) + quantity);
  }
  return units;
}
