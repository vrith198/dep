const assert = require('node:assert');
const app = require('../server');

async function runE2ETests() {
  console.log('--- STARTING COMPREHENSIVE E2E HTTP API TESTS ---');

  // Start server on an ephemeral port
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  try {
    // 1. Test GET /api/accommodations
    console.log('Test 1: Fetching Accommodations...');
    const accRes = await fetch(`${baseUrl}/api/accommodations`);
    assert.strictEqual(accRes.status, 200);
    const accData = await accRes.json();
    assert.strictEqual(accData.success, true);
    assert(Array.isArray(accData.data));
    assert(accData.data.length >= 5);
    console.log(`✓ Fetched ${accData.data.length} accommodations`);

    const dome = accData.data.find(a => a.slug === 'luxury-glamping-dome');
    assert(dome, 'Luxury Glamping Dome must exist');
    assert(dome.weekday_rate > 0);
    assert(dome.weekend_rate > dome.weekday_rate);
    assert(dome.special_event_rate > dome.weekend_rate);
    console.log(`✓ Verified accommodation rates: Weekday ₹${dome.weekday_rate}, Weekend ₹${dome.weekend_rate}, Event ₹${dome.special_event_rate}`);

    // 2. Test GET /api/packages
    console.log('Test 2: Fetching Packages...');
    const pkgRes = await fetch(`${baseUrl}/api/packages`);
    assert.strictEqual(pkgRes.status, 200);
    const pkgData = await pkgRes.json();
    assert.strictEqual(pkgData.success, true);
    assert(pkgData.data.length >= 4);
    const bbqPkg = pkgData.data.find(p => p.slug === 'sundowner-bbq-feast');
    assert(bbqPkg, 'BBQ package must exist');
    console.log(`✓ Fetched ${pkgData.data.length} packages`);

    // 3. Test GET /api/special-events
    console.log('Test 3: Fetching Special Events...');
    const evRes = await fetch(`${baseUrl}/api/special-events`);
    assert.strictEqual(evRes.status, 200);
    const evData = await evRes.json();
    assert.strictEqual(evData.success, true);
    assert(evData.data.length >= 3);
    const festival = evData.data.find(e => e.slug === 'sunset-solstice-fest');
    assert(festival, 'Festival must exist');
    console.log(`✓ Fetched ${evData.data.length} special events`);

    // 4. Test GET /api/add-ons
    console.log('Test 4: Fetching Add-ons...');
    const addOnRes = await fetch(`${baseUrl}/api/add-ons`);
    assert.strictEqual(addOnRes.status, 200);
    const addOnData = await addOnRes.json();
    assert.strictEqual(addOnData.success, true);
    assert(addOnData.data.length >= 4);
    console.log(`✓ Fetched ${addOnData.data.length} add-ons`);

    // 5. Test Availability Check API
    console.log('Test 5: Checking Availability for Date Range...');
    const checkIn = '2026-12-11'; // Friday
    const checkOut = '2026-12-13'; // Sunday
    const availRes = await fetch(`${baseUrl}/api/availability?check_in=${checkIn}&check_out=${checkOut}`);
    assert.strictEqual(availRes.status, 200);
    const availData = await availRes.json();
    assert.strictEqual(availData.success, true);
    const domeAvail = availData.data.find(a => a.id === dome.id);
    assert.strictEqual(domeAvail.is_available, true);
    assert(domeAvail.available_units > 0);
    console.log(`✓ Verified availability: ${domeAvail.name} has ${domeAvail.available_units} units available`);

    // 6. Test Live Pricing Preview API
    console.log('Test 6: POST /api/pricing-preview for Weekend Stay...');
    const previewRes = await fetch(`${baseUrl}/api/pricing-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accommodationId: dome.id,
        packageId: bbqPkg.id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        numAdults: 2,
        numChildren: 1,
        selectedAddOns: [
          { addOnId: addOnData.data[0].id, quantity: 1 }
        ]
      })
    });
    assert.strictEqual(previewRes.status, 200);
    const previewData = await previewRes.json();
    assert.strictEqual(previewData.success, true);
    assert.strictEqual(previewData.data.totalNights, 2);
    assert.strictEqual(previewData.data.weekendNights, 2);
    assert(previewData.data.pricingBreakdown.totalAmount > 0);
    console.log(`✓ Pricing preview calculated: ${previewData.data.stayTypeSummary}, Total ₹${previewData.data.pricingBreakdown.totalAmount}`);

    // 7. Test Special Event Pricing Preview
    console.log('Test 7: POST /api/pricing-preview for Special Event...');
    const eventPreviewRes = await fetch(`${baseUrl}/api/pricing-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accommodationId: dome.id,
        packageId: bbqPkg.id,
        checkInDate: festival.start_date,
        checkOutDate: festival.end_date,
        numAdults: 2,
        numChildren: 0
      })
    });
    assert.strictEqual(eventPreviewRes.status, 200);
    const eventPreviewData = await eventPreviewRes.json();
    assert.strictEqual(eventPreviewData.success, true);
    assert(eventPreviewData.data.specialEventNights > 0);
    console.log(`✓ Special event pricing preview: ${eventPreviewData.data.stayTypeSummary}, Event Nights: ${eventPreviewData.data.specialEventNights}`);

    // 8. Test Booking Creation API
    console.log('Test 8: POST /api/bookings (End-to-End Booking Creation)...');
    const bookingRes = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Priya Mukherjee',
        customerEmail: 'priya.m@example.com',
        customerPhone: '+91 9820011223',
        customerCity: 'Mumbai',
        accommodationId: dome.id,
        packageId: bbqPkg.id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        numAdults: 2,
        numChildren: 0,
        selectedAddOns: [
          { addOnId: addOnData.data[0].id, quantity: 1 }
        ],
        specialRequests: 'Celebrating wedding anniversary. Please arrange fairy light setup.'
      })
    });

    assert.strictEqual(bookingRes.status, 201);
    const bookingJson = await bookingRes.json();
    assert.strictEqual(bookingJson.success, true);
    const newBooking = bookingJson.data;
    assert(newBooking.booking_reference.startsWith('CSR-'));
    assert.strictEqual(newBooking.customer_name, 'Priya Mukherjee');
    assert.strictEqual(newBooking.customer_email, 'priya.m@example.com');
    assert.strictEqual(newBooking.booking_status, 'CONFIRMED');
    assert(newBooking.add_ons.length > 0);
    console.log(`✓ Booking created successfully! Reference: ${newBooking.booking_reference}`);

    // 9. Test Booking Lookup API
    console.log(`Test 9: GET /api/bookings/${newBooking.booking_reference}...`);
    const lookupRes = await fetch(`${baseUrl}/api/bookings/${newBooking.booking_reference}`);
    assert.strictEqual(lookupRes.status, 200);
    const lookupJson = await lookupRes.json();
    assert.strictEqual(lookupJson.success, true);
    assert.strictEqual(lookupJson.data.booking_reference, newBooking.booking_reference);
    assert.strictEqual(lookupJson.data.accommodation_name, dome.name);
    assert.strictEqual(lookupJson.data.package_name, bbqPkg.name);
    console.log(`✓ Booking retrieved by reference code with complete details`);

    // 10. Test Non-existent Booking Lookup
    console.log('Test 10: GET /api/bookings/CSR-NONEXISTENT...');
    const fakeRes = await fetch(`${baseUrl}/api/bookings/CSR-NONEXISTENT`);
    assert.strictEqual(fakeRes.status, 404);
    const fakeJson = await fakeRes.json();
    assert.strictEqual(fakeJson.success, false);
    console.log(`✓ Non-existent reference properly returned 404 with error message: ${fakeJson.error}`);

    // 11. Test Frontend HTML pages serving
    console.log('Test 11: Testing Frontend Static Serving...');
    const indexRes = await fetch(`${baseUrl}/`);
    assert.strictEqual(indexRes.status, 200);
    const indexHtml = await indexRes.text();
    assert(indexHtml.includes('CAMP SANDRUSH'));
    assert(indexHtml.includes('Choose Your Coastal Living'));

    const confirmRes = await fetch(`${baseUrl}/confirmation.html?ref=${newBooking.booking_reference}`);
    assert.strictEqual(confirmRes.status, 200);
    const confirmHtml = await confirmRes.text();
    assert(confirmHtml.includes('Your Beach Getaway is Booked!'));

    const myBookingRes = await fetch(`${baseUrl}/my-booking.html`);
    assert.strictEqual(myBookingRes.status, 200);
    const myBookingHtml = await myBookingRes.text();
    assert(myBookingHtml.includes('Find Your Reservation'));
    console.log(`✓ All HTML customer pages served correctly`);

    console.log('\n========================================');
    console.log('ALL E2E API AND CUSTOMER WORKFLOW TESTS PASSED!');
    console.log('========================================\n');
  } finally {
    server.close();
  }
}

runE2ETests().catch(err => {
  console.error('E2E TEST FAILURE:', err);
  process.exit(1);
});
