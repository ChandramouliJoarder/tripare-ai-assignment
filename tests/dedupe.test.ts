import { dedupeAndSelectBest, normalizeHotelName } from '../src/domain/dedupe';
import { SupplierHotel } from '../src/domain/types';

describe('normalizeHotelName', () => {
  it('trims whitespace', () => {
    expect(normalizeHotelName('  Holtin  ')).toBe('holtin');
  });

  it('lowercases', () => {
    expect(normalizeHotelName('RADISON')).toBe('radison');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeHotelName('Taj   Palace   Inn')).toBe('taj palace inn');
  });

  it('handles single word', () => {
    expect(normalizeHotelName('Holtin')).toBe('holtin');
  });
});

describe('dedupeAndSelectBest', () => {
  const makeHotel = (
    name: string,
    price: number,
    city = 'delhi',
    commissionPct = 10,
    hotelId = 'x1'
  ): SupplierHotel => ({
    hotelId,
    name,
    price,
    city,
    commissionPct,
  });

  it('returns empty array for two empty lists', () => {
    expect(dedupeAndSelectBest([], [])).toEqual([]);
  });

  it('returns all hotels if no overlap', () => {
    const a = [makeHotel('Hotel A', 5000)];
    const b = [makeHotel('Hotel B', 3000)];
    const result = dedupeAndSelectBest(a, b);
    expect(result).toHaveLength(2);
  });

  it('picks cheaper hotel on overlap - B wins', () => {
    const a = [makeHotel('Holtin', 6000, 'delhi', 10, 'a1')];
    const b = [makeHotel('Holtin', 5340, 'delhi', 20, 'b1')];
    const result = dedupeAndSelectBest(a, b);
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(5340);
    expect(result[0].supplier).toBe('Supplier B');
  });

  it('picks cheaper hotel on overlap - A wins', () => {
    const a = [makeHotel('Radison', 5900, 'delhi', 13, 'a2')];
    const b = [makeHotel('Radison', 6100, 'delhi', 11, 'b2')];
    const result = dedupeAndSelectBest(a, b);
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(5900);
    expect(result[0].supplier).toBe('Supplier A');
  });

  it('on price tie, picks lower commissionPct', () => {
    const a = [makeHotel('Lotus', 4000, 'delhi', 12, 'a3')];
    const b = [makeHotel('Lotus', 4000, 'delhi', 8, 'b3')];
    const result = dedupeAndSelectBest(a, b);
    expect(result[0].commissionPct).toBe(8);
    expect(result[0].supplier).toBe('Supplier B');
  });

  it('on price and commission tie, Supplier A wins (processed first)', () => {
    const a = [makeHotel('Phoenix', 5000, 'delhi', 10, 'a4')];
    const b = [makeHotel('Phoenix', 5000, 'delhi', 10, 'b4')];
    const result = dedupeAndSelectBest(a, b);
    expect(result[0].supplier).toBe('Supplier A');
  });

  it('handles case and whitespace differences in hotel names', () => {
    const a = [makeHotel('  TAJ Palace Inn  ', 9800)];
    const b = [makeHotel('Taj   Palace   Inn', 8000)];
    const result = dedupeAndSelectBest(a, b);
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(8000);
  });

  it('sorts results by price ascending', () => {
    const a = [
      makeHotel('Expensive', 9000, 'delhi', 10, 'a1'),
      makeHotel('Cheap', 1000, 'delhi', 10, 'a2'),
    ];
    const result = dedupeAndSelectBest(a, []);
    expect(result[0].price).toBe(1000);
    expect(result[1].price).toBe(9000);
  });

  it('handles supplier A only', () => {
    const a = [makeHotel('Hotel A', 5000)];
    const result = dedupeAndSelectBest(a, []);
    expect(result).toHaveLength(1);
    expect(result[0].supplier).toBe('Supplier A');
  });

  it('handles supplier B only', () => {
    const b = [makeHotel('Hotel B', 3000)];
    const result = dedupeAndSelectBest([], b);
    expect(result).toHaveLength(1);
    expect(result[0].supplier).toBe('Supplier B');
  });

  it('Delhi seed data: Holtin from B at 5340, Radison from A at 5900, Lotus Grand from A at 4200', () => {
    const listA: SupplierHotel[] = [
      { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
      { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
      { hotelId: 'a3', name: 'Taj Palace Inn', price: 9800, city: 'delhi', commissionPct: 12 },
      { hotelId: 'a4', name: 'Lotus Grand', price: 4200, city: 'delhi', commissionPct: 9 },
      { hotelId: 'a5', name: 'Yamuna View', price: 3600, city: 'delhi', commissionPct: 11 },
    ];
    const listB: SupplierHotel[] = [
      { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
      { hotelId: 'b2', name: 'Radison', price: 6100, city: 'delhi', commissionPct: 11 },
      { hotelId: 'b3', name: 'Maurya Heights', price: 7400, city: 'delhi', commissionPct: 15 },
      { hotelId: 'b4', name: 'Lotus Grand', price: 4350, city: 'delhi', commissionPct: 8 },
      { hotelId: 'b5', name: 'Chandni Residency', price: 2900, city: 'delhi', commissionPct: 14 },
    ];
    const result = dedupeAndSelectBest(listA, listB);

    // 7 unique hotels total
    expect(result).toHaveLength(7);

    const holtin = result.find((h) => h.name === 'Holtin');
    expect(holtin?.price).toBe(5340);
    expect(holtin?.supplier).toBe('Supplier B');

    const radison = result.find((h) => h.name === 'Radison');
    expect(radison?.price).toBe(5900);
    expect(radison?.supplier).toBe('Supplier A');

    const lotus = result.find((h) => h.name === 'Lotus Grand');
    expect(lotus?.price).toBe(4200);
    expect(lotus?.supplier).toBe('Supplier A');

    // Sorted by price
    for (let i = 1; i < result.length; i++) {
      expect(result[i].price).toBeGreaterThanOrEqual(result[i - 1].price);
    }
  });
});
