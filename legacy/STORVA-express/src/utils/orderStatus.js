'use strict';
// Order lifecycle. Pure, so it can be unit-tested without a database.
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};
const canTransition = (from, to) => Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
// Stock and coupon usage are returned only when an order is cancelled.
const releasesInventory = (to) => to === 'cancelled';

module.exports = { STATUSES, TRANSITIONS, canTransition, releasesInventory };
