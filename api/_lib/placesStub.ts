/**
 * PROTOTYPE STUB. Every name and coordinate here is made up to exercise the
 * map; none of it is real data. The real endpoint reads the `venues` table and
 * `public/places/shops.json` (see the plan).
 */
export interface PlaceVenue { id: string; name: string; lat: number; lng: number; address: string | null; source: "stub" }
export interface PlaceShop { id: string; name: string; lat: number; lng: number; address: string | null; hours: string | null; source: "stub" }

const v = (n: number, name: string, lat: number, lng: number): PlaceVenue =>
  ({ id: String(9000 + n), name, lat, lng, address: `${100 + n} Stub St, New York`, source: "stub" });
const s = (n: number, name: string, lat: number, lng: number, hours: string | null): PlaceShop =>
  ({ id: `stub-shop-${n}`, name, lat, lng, address: `${10 + n} Placeholder Ave, New York`, hours, source: "stub" });

export const STUB_VENUES: PlaceVenue[] = [
  v(1, "Stub Venue Alpha", 40.7233, -73.9876), v(2, "Stub Venue Bravo", 40.7062, -73.9235),
  v(3, "Stub Venue Charlie", 40.7141, -73.9610), v(4, "Stub Venue Delta", 40.7440, -73.9540),
  v(5, "Stub Venue Echo", 40.7285, -74.0040), v(6, "Stub Venue Foxtrot", 40.6925, -73.9855),
  v(7, "Stub Venue Golf", 40.7590, -73.9690), v(8, "Stub Venue Hotel", 40.6780, -73.9440),
  v(9, "Stub Venue India", 40.7370, -73.9210), v(10, "Stub Venue Juliet", 40.7010, -73.9930),
  v(11, "Stub Venue Kilo", 40.7180, -73.9420), v(12, "Stub Venue Lima", 40.7480, -73.9930),
];
export const STUB_SHOPS: PlaceShop[] = [
  s(1, "Stub Records One", 40.7290, -73.9960, "Mo-Su 12:00-20:00"), s(2, "Stub Records Two", 40.7195, -73.9570, "Tu-Su 11:00-19:00"),
  s(3, "Stub Wax Three", 40.7050, -73.9460, null), s(4, "Stub Vinyl Four", 40.7385, -73.9830, "Mo-Sa 13:00-21:00"),
  s(5, "Stub Crates Five", 40.6860, -73.9780, null), s(6, "Stub Records Six", 40.7520, -73.9760, "Mo-Su 10:00-18:00"),
  s(7, "Stub Discs Seven", 40.7120, -74.0070, null), s(8, "Stub Sounds Eight", 40.6990, -73.9570, "We-Su 12:00-20:00"),
  s(9, "Stub Records Nine", 40.7330, -73.9450, null), s(10, "Stub Wax Ten", 40.7640, -73.9560, null),
  s(11, "Stub Vinyl Eleven", 40.6810, -73.9990, "Mo-Su 11:00-19:00"), s(12, "Stub Crates Twelve", 40.7260, -73.9310, null),
];
