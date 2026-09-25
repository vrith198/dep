const assert = require('node:assert');
const app = require('../server');
const { createBooking } = require('../services/bookingService');
const { db } = require('../db');

async function runAdminTests() {
  console.log('--- STARTING ADMIN DASHBOARD & MANAGEMENT TESTS ---');

  // Start test server on ephemeral port
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Admin test server running on ${baseUrl}`);

  try {
    // 1. Test Admin Login with invalid credentials
    console.log('Test 1: Admin Login with incorrect password...');
    const badLoginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' })
    });
    assert.strictEqual(badLoginRes.status, 401);
    console.log('✓ Rejected unauthorized login as expected');

    // 2. Test Admin Login with valid credentials
    console.log('Test 2: Admin Login with valid credentials...');
    const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'sandrush2026!' })
    });
    assert.strictEqual(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert.strictEqual(loginJson.success, true);
    assert(loginJson.data.token, 'Token must be returned');
    assert.strictEqual(loginJson.data.user.username, 'admin');
    const token = loginJson.data.token;
    console.log(`✓ Admin logged in successfully! Token: ${token.slice(0, 16)}...`);

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    // 3. Test Protected endpoint without token returns 401
    console.log('Test 3: Protected endpoint access without token...');
    const unauthRes = await fetch(`${baseUrl}/api/admin/stats`);
    assert.strictEqual(unauthRes.status, 401);
    console.log('✓ Correctly blocked unauthenticated request with 401');

    // 4. Test GET /api/admin/me
    console.log('Test 4: Verify Admin Session (GET /api/admin/me)...');
    const meRes = await fetch(`${baseUrl}/api/admin/me`, { headers: authHeaders });
    assert.strictEqual(meRes.status, 200);
    const meJson = await meRes.json();
    assert.strictEqual(meJson.data.username, 'admin');
    console.log('✓ Admin session verified');

    // 5. Test Customer Booking appearance in Admin
    console.log('Test 5: Create a customer booking and verify it appears in Admin Bookings...');
    const tent = db.prepare("SELECT * FROM accommodations WHERE slug = 'standard-cozy-beach-tent'").get();
    const pkgClassic = db.prepare("SELECT * FROM packages WHERE slug = 'classic-beach-camp'").get();

    const customerBooking = createBooking({
      customerName: 'Rohit Verma',
      customerEmail: 'rohit.verma@example.com',
      customerPhone: '+91 9988776655',
      customerCity: 'Bengaluru',
      accommodationId: tent.id,
      packageId: pkgClassic.id,
      checkInDate: '2026-11-27',
      checkOutDate: '2026-11-29',
      numAdults: 2,
      numChildren: 0,
      specialRequests: 'Quiet tent spot near palm trees'
    });

    // Fetch from Admin Bookings endpoint
    const adminBookingsRes = await fetch(`${baseUrl}/api/admin/bookings?search=Rohit`, { headers: authHeaders });
    assert.strictEqual(adminBookingsRes.status, 200);
    const adminBookingsJson = await adminBookingsRes.json();
    assert(adminBookingsJson.success);
    const foundBooking = adminBookingsJson.data.bookings.find(b => b.booking_reference === customerBooking.booking_reference);
    assert(foundBooking, 'Created booking must appear in admin bookings list');
    assert.strictEqual(foundBooking.customer_name, 'Rohit Verma');
    assert.strictEqual(foundBooking.booking_status, 'CONFIRMED');
    console.log(`✓ Customer booking found in Admin: Reference ${foundBooking.booking_reference}, Status: ${foundBooking.booking_status}`);

    // 6. Test Updating Booking Status: Check-in, then Check-out
    console.log('Test 6: Update booking status to CHECKED_IN...');
    const checkInRes = await fetch(`${baseUrl}/api/admin/bookings/${foundBooking.id}/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'CHECKED_IN' })
    });
    assert.strictEqual(checkInRes.status, 200);
    const checkInJson = await checkInRes.json();
    assert.strictEqual(checkInJson.data.booking_status, 'CHECKED_IN');
    console.log('✓ Booking status successfully updated to CHECKED_IN');

    // 7. Test Cancellation & Unit Release in Availability
    console.log('Test 7: Cancel booking and verify availability increases...');
    // Check initial availability for those dates
    const availBeforeCancel = await fetch(`${baseUrl}/api/availability?check_in=2026-11-27&check_out=2026-11-29&accommodation_id=${tent.id}`).then(r => r.json());
    const unitsBefore = availBeforeCancel.data[0].available_units;

    // Cancel booking
    const cancelRes = await fetch(`${baseUrl}/api/admin/bookings/${foundBooking.id}/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'CANCELLED' })
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelJson = await cancelRes.json();
    assert.strictEqual(cancelJson.data.booking_status, 'CANCELLED');

    // Check availability after cancellation: should have 1 more unit available!
    const availAfterCancel = await fetch(`${baseUrl}/api/availability?check_in=2026-11-27&check_out=2026-11-29&accommodation_id=${tent.id}`).then(r => r.json());
    const unitsAfter = availAfterCancel.data[0].available_units;
    assert.strictEqual(unitsAfter, unitsBefore + 1, 'Cancelling booking must restore available unit count');
    console.log(`✓ Cancellation successfully freed up unit: Available before: ${unitsBefore}, after: ${unitsAfter}`);

    // Clean up test booking
    db.prepare('DELETE FROM bookings WHERE id = ?').run(foundBooking.id);

    // 8. Test Dashboard Stats API
    console.log('Test 8: GET /api/admin/stats...');
    const statsRes = await fetch(`${baseUrl}/api/admin/stats`, { headers: authHeaders });
    assert.strictEqual(statsRes.status, 200);
    const statsJson = await statsRes.json();
    assert(statsJson.success);
    assert(statsJson.data.totalCampUnits > 0);
    console.log(`✓ Admin KPIs loaded: Total Units: ${statsJson.data.totalCampUnits}, Total Bookings: ${statsJson.data.totalBookings}`);

    // 9. Test Accommodations Management
    console.log('Test 9: Accommodations CRUD...');
    const accListRes = await fetch(`${baseUrl}/api/admin/accommodations`, { headers: authHeaders });
    assert.strictEqual(accListRes.status, 200);
    const accListJson = await accListRes.json();
    assert(accListJson.data.length >= 5);

    // Update accommodation weekday rate
    const dome = accListJson.data.find(a => a.slug === 'luxury-glamping-dome');
    const oldRate = dome.weekday_rate;
    const newRate = oldRate + 100;
    const updateAccRes = await fetch(`${baseUrl}/api/admin/accommodations/${dome.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ weekday_rate: newRate })
    });
    assert.strictEqual(updateAccRes.status, 200);
    const updatedAcc = (await updateAccRes.json()).data;
    assert.strictEqual(updatedAcc.weekday_rate, newRate);
    console.log(`✓ Updated Accommodation rate: ${oldRate} -> ${newRate}`);

    // Revert rate
    await fetch(`${baseUrl}/api/admin/accommodations/${dome.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ weekday_rate: oldRate })
    });

    // 10. Test Customers Management
    console.log('Test 10: Customers directory...');
    const custRes = await fetch(`${baseUrl}/api/admin/customers`, { headers: authHeaders });
    assert.strictEqual(custRes.status, 200);
    const custJson = await custRes.json();
    assert(custJson.success);
    assert(Array.isArray(custJson.data));
    console.log(`✓ Customers directory loaded: ${custJson.data.length} registered customers`);

    // 11. Test Availability Overview Grid
    console.log('Test 11: Availability Calendar Overview...');
    const availOverviewRes = await fetch(`${baseUrl}/api/admin/availability-overview?start_date=2026-10-01&num_days=7`, { headers: authHeaders });
    assert.strictEqual(availOverviewRes.status, 200);
    const availOverviewJson = await availOverviewRes.json();
    assert(availOverviewJson.success);
    assert.strictEqual(availOverviewJson.data.days.length, 7);
    console.log(`✓ Availability overview loaded 7-day occupancy matrix`);

    console.log('\n========================================');
    console.log('ALL ADMIN SERVICE & API TESTS PASSED!');
    console.log('========================================\n');
  } finally {
    server.close();
  }
}

runAdminTests().catch(err => {
  console.error('ADMIN TEST FAILURE:', err);
  process.exit(1);
});
