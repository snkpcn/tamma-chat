export type TransactionNotificationEntity = 'booking' | 'cafe_inquiry' | 'otop_order';
export type TransactionNotificationStatus = 'sent' | 'duplicate' | 'not_bound' | 'ignored' | 'failed';

type Dispatchers = {
  booking(id: string): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'>;
  entity(entity: 'cafe_inquiry' | 'otop_order', id: string): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'>;
};

async function defaultDispatchers(): Promise<Dispatchers> {
  const [{ dispatchBookingFlexNotification }, { dispatchEntityNotification }] = await Promise.all([
    import('./_ops-booking-notify-flex'),
    import('./_ops-notifications'),
  ]);
  return {
    booking: dispatchBookingFlexNotification,
    entity: (entity, id) => dispatchEntityNotification(entity, id),
  };
}

/**
 * Direct, idempotent delivery after a durable transaction write.
 *
 * Database webhooks remain useful as a retry/outbox path, but they cannot be
 * the only path: an unscheduled booking has no booking_allocation row, so the
 * old allocation-only trigger never ran for that valid pending request.
 * Delivery tables already enforce idempotency, therefore a webhook racing
 * this direct dispatch safely resolves as `duplicate` instead of sending a
 * second LINE message.
 *
 * Notification failure never rolls back a customer transaction. The status
 * is returned to the runtime for observability and honest customer copy.
 */
export async function dispatchCreatedTransactionNotification(
  entity: TransactionNotificationEntity,
  id: string,
  dispatchers?: Dispatchers,
): Promise<TransactionNotificationStatus> {
  if (!id) return 'failed';
  try {
    const selected = dispatchers ?? await defaultDispatchers();
    return entity === 'booking'
      ? await selected.booking(id)
      : await selected.entity(entity, id);
  } catch (error) {
    console.error(
      'TRANSACTION_NOTIFICATION_DISPATCH_ERROR',
      JSON.stringify({
        entity,
        id,
        error: error instanceof Error ? error.message.slice(0, 220) : 'unknown',
      }),
    );
    return 'failed';
  }
}
