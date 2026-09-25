const assert = require('node:assert');
const { calculateStayPricing, classifyNight, parseDate, formatDate } = require('../services/pricingService');
const { db } = require('../db');

console.log('--- RUNNING PRICING SERVICE TESTS ---');

// Fetch accommodations
const dome = db.prepare("SELECT * FROM accommodations WHERE slug = 'luxury-glamping-dome'").get();
const tent = db.prepare("SELECT * FROM accommodations WHERE slug = 'standard-cozy-beach-tent'").get();
const pkgClassic = db.prepare("SELECT * FROM packages WHERE slug = 'classic-beach-camp'").get();
const pkgBbq = db.prepare("SELECT * FROM packages WHERE slug = 'sundowner-bbq-feast'").get();
const pkgDate = db.prepare("SELECT * FROM packages WHERE slug = 'romantic-starlit-date'").get();
const addOnLateCheckout = db.prepare("SELECT * FROM add_ons WHERE slug = 'late-checkout-3pm'").get();
const addOnScuba = db.prepare("SELECT * FROM add_ons WHERE slug = 'scuba-diving-intro'").get();

// 1. Test Weekday Night Stay (Monday to Wednesday: 2 nights)
// Oct 19, 2026 is Monday, Oct 21 is Wednesday
console.log('Test 1: Pure Weekday Stay (2 nights)...');
const weekdayPricing = calculateStayPricing({
  accommodationId: dome.id,
  packageId: pkgClassic.id,
  checkInDate: '2026-10-19',
  checkOutDate: '2026-10-21',
  numAdults: 2,
  numChildren: 0
});

assert.strictEqual(weekdayPricing.totalNights, 2);
assert.strictEqual(weekdayPricing.weekdayNights, 2);
assert.strictEqual(weekdayPricing.weekendNights, 0);
assert.strictEqual(weekdayPricing.specialEventNights, 0);
assert.strictEqual(weekdayPricing.pricingBreakdown.baseAccommodationAmount, dome.weekday_rate * 2);
assert.strictEqual(weekdayPricing.pricingBreakdown.subtotal, dome.weekday_rate * 2);
const expectedTax = Math.round((dome.weekday_rate * 2) * 0.12);
assert.strictEqual(weekdayPricing.pricingBreakdown.taxAmount, expectedTax);
assert.strictEqual(weekdayPricing.pricingBreakdown.totalAmount, (dome.weekday_rate * 2) + expectedTax);
console.log('✓ Weekday test passed: 2 nights @ ' + dome.weekday_rate + ' = ' + weekdayPricing.pricingBreakdown.totalAmount);

// 2. Test Weekend Stay (Friday to Sunday: 2 nights)
// Oct 23, 2026 is Friday, Oct 25 is Sunday
console.log('Test 2: Pure Weekend Stay (2 nights)...');
const weekendPricing = calculateStayPricing({
  accommodationId: tent.id,
  packageId: pkgClassic.id,
  checkInDate: '2026-10-23',
  checkOutDate: '2026-10-25',
  numAdults: 2,
  numChildren: 0
});

assert.strictEqual(weekendPricing.totalNights, 2);
assert.strictEqual(weekendPricing.weekdayNights, 0);
assert.strictEqual(weekendPricing.weekendNights, 2);
assert.strictEqual(weekendPricing.specialEventNights, 0);
assert.strictEqual(weekendPricing.pricingBreakdown.baseAccommodationAmount, tent.weekend_rate * 2);
console.log('✓ Weekend test passed: 2 nights @ ' + tent.weekend_rate + ' = ' + weekendPricing.pricingBreakdown.totalAmount);

// 3. Test Special Event Stay
// Event "Sunset Solstice Beach Fest" is 2026-10-09 to 2026-10-12
console.log('Test 3: Special Event Stay (3 nights during festival)...');
const eventPricing = calculateStayPricing({
  accommodationId: dome.id,
  packageId: pkgBbq.id,
  checkInDate: '2026-10-09',
  checkOutDate: '2026-10-12',
  numAdults: 2,
  numChildren: 0
});

assert.strictEqual(eventPricing.totalNights, 3);
assert.strictEqual(eventPricing.specialEventNights, 3);
assert.strictEqual(eventPricing.pricingBreakdown.baseAccommodationAmount, dome.special_event_rate * 3);
// Package BBQ is 899 per person for 2 adults = 1798
assert.strictEqual(eventPricing.pricingBreakdown.packageAmount, pkgBbq.per_person_rate * 2);
console.log('✓ Special Event test passed: 3 event nights + BBQ package = ' + eventPricing.pricingBreakdown.totalAmount);

// 4. Test Mixed Stay (Thursday to Sunday: 1 weekday night + 2 weekend nights)
// Oct 15, 2026 is Thursday, Oct 18 is Sunday
console.log('Test 4: Mixed Stay (Thursday to Sunday)...');
const mixedPricing = calculateStayPricing({
  accommodationId: dome.id,
  packageId: pkgClassic.id,
  checkInDate: '2026-10-15',
  checkOutDate: '2026-10-18',
  numAdults: 2,
  numChildren: 0
});

assert.strictEqual(mixedPricing.totalNights, 3);
assert.strictEqual(mixedPricing.weekdayNights, 1);
assert.strictEqual(mixedPricing.weekendNights, 2);
const expectedMixedBase = dome.weekday_rate * 1 + dome.weekend_rate * 2;
assert.strictEqual(mixedPricing.pricingBreakdown.baseAccommodationAmount, expectedMixedBase);
console.log('✓ Mixed stay test passed: 1 weekday + 2 weekend nights = ' + expectedMixedBase);

// 5. Test Extra Guests Calculation
// Dome base capacity is 2, max capacity is 4. Test with 3 adults.
console.log('Test 5: Extra Guest Calculation...');
const extraGuestPricing = calculateStayPricing({
  accommodationId: dome.id,
  packageId: pkgClassic.id,
  checkInDate: '2026-10-19',
  checkOutDate: '2026-10-21',
  numAdults: 3,
  numChildren: 0
});

assert.strictEqual(extraGuestPricing.extraGuestsCount, 1);
assert.strictEqual(extraGuestPricing.pricingBreakdown.extraGuestsAmount, 1 * dome.extra_guest_rate * 2);
console.log('✓ Extra guest test passed: 1 extra guest for 2 nights @ ' + dome.extra_guest_rate + ' = ' + extraGuestPricing.pricingBreakdown.extraGuestsAmount);

// 6. Test Add-ons and Flat Rate Package
console.log('Test 6: Add-ons & Flat Rate Package...');
const fullPricing = calculateStayPricing({
  accommodationId: dome.id,
  packageId: pkgDate.id, // Flat rate 2299
  checkInDate: '2026-10-19',
  checkOutDate: '2026-10-21',
  numAdults: 2,
  numChildren: 0,
  selectedAddOns: [
    { addOnId: addOnLateCheckout.id, quantity: 1 }, // per_stay: 800
    { addOnId: addOnScuba.id, quantity: 2 }          // per_person: 1899 * 2 qty * 2 total guests = 7596
  ]
});

assert.strictEqual(fullPricing.pricingBreakdown.packageAmount, pkgDate.flat_rate);
assert.strictEqual(fullPricing.selectedAddOns.length, 2);
const expectedAddons = 800 + (1899 * 2 * 2);
assert.strictEqual(fullPricing.pricingBreakdown.addOnsAmount, expectedAddons);
console.log('✓ Add-ons test passed: package ' + pkgDate.flat_rate + ', add-ons ' + expectedAddons);

// 7. Test Capacity Error Handling
console.log('Test 7: Exceeding Max Capacity Error Handling...');
assert.throws(() => {
  calculateStayPricing({
    accommodationId: dome.id, // max is 4
    packageId: pkgClassic.id,
    checkInDate: '2026-10-19',
    checkOutDate: '2026-10-21',
    numAdults: 5,
    numChildren: 0
  });
}, /exceed maximum capacity/);
console.log('✓ Capacity error caught successfully');

// 8. Test Invalid Dates Error Handling
console.log('Test 8: Invalid Dates Error Handling...');
assert.throws(() => {
  calculateStayPricing({
    accommodationId: dome.id,
    packageId: pkgClassic.id,
    checkInDate: '2026-10-21',
    checkOutDate: '2026-10-19'
  });
}, /Check-out date must be after check-in date/);
console.log('✓ Date error caught successfully');

console.log('ALL PRICING TESTS PASSED PERFECTLY!\n');
