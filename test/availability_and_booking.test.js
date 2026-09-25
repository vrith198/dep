const assert = require('node:assert');
const { db } = require('../db');
const { checkAvailability, createBooking, getBookingByReference } = require('../services/bookingService');

console.log('--- RUNNING AVAILABILITY & BOOKING TESTS ---');

// Pick wooden chalet (has 4 total units)
const chalet = db.prepare("SELECT * FROM accommodations WHERE slug = 'oceanfront-wooden-chalet'").get();
const pkgClassic = db.prepare("SELECT * FROM packages WHERE slug = 'classic-beach-camp'").get();

const testDates = {
  checkIn: '2026-11-12',
  checkOut: '2026-11-14'
};

// 1. Initial availability check
console.log('Test 1: Initial Availability Check for Chalet...');
let availList = checkAvailability(testDates.checkIn, testDates.checkOut, chalet.id);
assert.strictEqual(availList.length, 1);
const initialChalet = availList[0];
assert.strictEqual(initialChalet.available_units, chalet.total_units);
assert.strictEqual(initialChalet.is_available, true);
console.log(`✓ Initial availability confirmed: ${initialChalet.available_units}/${chalet.total_units} units available`);

// 2. Book 1 unit and check availability decrements
console.log('Test 2: Create Booking 1...');
const booking1 = createBooking({
  customerName: 'Aarav Sharma',
  customerEmail: 'aarav.sharma@example.com',
  customerPhone: '+91 9876543210',
  customerCity: 'Mumbai',
  accommodationId: chalet.id,
  packageId: pkgClassic.id,
  checkInDate: testDates.checkIn,
  checkOutDate: testDates.checkOut,
  numAdults: 2,
  numChildren: 0,
  specialRequests: 'Ground floor unit facing sunset'
});

assert(booking1.booking_reference.startsWith('CSR-'));
assert.strictEqual(booking1.customer_name, 'Aarav Sharma');
assert.strictEqual(booking1.total_nights, 2);
assert.strictEqual(booking1.booking_status, 'CONFIRMED');
console.log(`✓ Booking 1 created: Reference = ${booking1.booking_reference}`);

// Check availability after 1 booking
availList = checkAvailability(testDates.checkIn, testDates.checkOut, chalet.id);
assert.strictEqual(availList[0].available_units, chalet.total_units - 1);
console.log(`✓ Available units decreased to: ${availList[0].available_units}/${chalet.total_units}`);

// 3. Lookup Booking by Reference
console.log('Test 3: Lookup Booking by Reference...');
const fetched = getBookingByReference(booking1.booking_reference);
assert.strictEqual(fetched.id, booking1.id);
assert.strictEqual(fetched.customer_email, 'aarav.sharma@example.com');
assert.strictEqual(fetched.accommodation_name, chalet.name);
console.log(`✓ Lookup verified successfully for ${fetched.booking_reference}`);

// 4. Fill remaining units to test sold-out and overbooking prevention
console.log(`Test 4: Booking remaining ${chalet.total_units - 1} units...`);
const createdBookings = [booking1];

for (let i = 2; i <= chalet.total_units; i++) {
  const b = createBooking({
    customerName: `Guest Test ${i}`,
    customerEmail: `guest${i}@example.com`,
    customerPhone: `+91 981112223${i}`,
    customerCity: 'Pune',
    accommodationId: chalet.id,
    packageId: pkgClassic.id,
    checkInDate: testDates.checkIn,
    checkOutDate: testDates.checkOut,
    numAdults: 2,
    numChildren: 0
  });
  createdBookings.push(b);
}

// Now chalet should be completely Sold Out
availList = checkAvailability(testDates.checkIn, testDates.checkOut, chalet.id);
assert.strictEqual(availList[0].available_units, 0);
assert.strictEqual(availList[0].is_available, false);
assert.strictEqual(availList[0].status_text, 'Sold Out');
console.log('✓ Chalet is correctly marked as Sold Out (0 units available)');

// 5. Attempt overbooking: must throw error and prevent booking
console.log('Test 5: Overbooking Attempt Prevention...');
assert.throws(() => {
  createBooking({
    customerName: 'Extra Guest Overbook',
    customerEmail: 'overbook@example.com',
    customerPhone: '+91 9999999999',
    customerCity: 'Goa',
    accommodationId: chalet.id,
    packageId: pkgClassic.id,
    checkInDate: testDates.checkIn,
    checkOutDate: testDates.checkOut,
    numAdults: 2,
    numChildren: 0
  });
}, /no longer available/);
console.log('✓ Overbooking prevented successfully with clean error response!');

// 6. Clean up test bookings to keep test DB clean
console.log('Cleaning up test bookings...');
const deleteStmt = db.prepare('DELETE FROM bookings WHERE id = ?');
for (const b of createdBookings) {
  deleteStmt.run(b.id);
}

// Re-verify units restored
availList = checkAvailability(testDates.checkIn, testDates.checkOut, chalet.id);
assert.strictEqual(availList[0].available_units, chalet.total_units);
console.log(`✓ Units restored to original capacity: ${availList[0].available_units}/${chalet.total_units}`);

console.log('ALL AVAILABILITY & BOOKING TESTS PASSED PERFECTLY!\n');
