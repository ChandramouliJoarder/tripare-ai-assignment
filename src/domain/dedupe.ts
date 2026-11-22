import { SupplierHotel, Hotel } from './types';

/**
 * Normalize hotel name for deduplication comparison:
 * trim whitespace, lowercase, collapse multiple internal spaces.
 */
export function normalizeHotelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Deduplicate overlapping hotels from two supplier lists and select the best offer.
 *
 * Rules:
 *  1. If the same hotel (by normalized name) appears in both lists, keep the cheaper one.
 *  2. If prices tie, keep the one with the lower commissionPct.
 *  3. If still tied, keep Supplier A (the one processed first).
 *  4. Hotels unique to one list are always kept.
 *
 * @returns Merged list sorted ascending by price.
 */
export function dedupeAndSelectBest(
  listA: SupplierHotel[],
  listB: SupplierHotel[]
): Hotel[] {
  const map = new Map<string, Hotel>();

  function addToMap(hotel: SupplierHotel, supplierName: string): void {
    const key = normalizeHotelName(hotel.name);
    const existing = map.get(key);

    const candidate: Hotel = {
      name: hotel.name,
      price: hotel.price,
      supplier: supplierName,
      commissionPct: hotel.commissionPct,
    };

    if (!existing) {
      map.set(key, candidate);
      return;
    }

    // Pick cheaper price
    if (candidate.price < existing.price) {
      map.set(key, candidate);
    } else if (
      candidate.price === existing.price &&
      candidate.commissionPct < existing.commissionPct
    ) {
      // Same price → lower commission wins
      map.set(key, candidate);
    }
    // If price and commission both tie, the first entry (Supplier A) stays
  }

  // Process A first so it wins ties
  for (const hotel of listA) {
    addToMap(hotel, 'Supplier A');
  }
  for (const hotel of listB) {
    addToMap(hotel, 'Supplier B');
  }

  return Array.from(map.values()).sort((a, b) => a.price - b.price);
}
