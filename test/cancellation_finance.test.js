const assert = require('node:assert');
const app = require('../server');
const { db } = require('../db');

async function runCancellationFinanceSuite() {
  console.log('\n--- STARTING CANCELLATION, REFUND & FINANCE TESTS ---');
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Admin Login
    console.log('Test 1: Admin Login...');
    const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'sandrush2026!' })
    });
    const loginJson = await loginRes.json();
    assert.strictEqual(loginJson.success, true);
    const adminToken = loginJson.data.token;
    console.log('✓ Admin authenticated');

    // 2. Customer creates booking far in advance (> 7 days for 100% refund test)
    console.log('Test 2: Customer creates booking >7 days out with DEMO_UPI...');
    const futureIn = new Date();
    futureIn.setDate(futureIn.getDate() + 14); // 14 days ahead
    const futureOut = new Date(futureIn);
    futureOut.setDate(futureOut.getDate() + 2); // 2 nights

    const checkInDate = futureIn.toISOString().split('T')[0];
    const checkOutDate = futureOut.toISOString().split('T')[0];

    // Check availability before
    const availBeforeRes = await fetch(`${baseUrl}/api/availability?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}`);
    const availBefore = (await availBeforeRes.json()).data;
    const domeBefore = availBefore.find(a => a.id === 1);
    const unitsBefore = domeBefore.available_units;

    // Create booking
    const bookRes = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Aditi Sharma',
        customerEmail: 'aditi.sharma@example.com',
        customerPhone: '+919920199201',
        customerCity: 'Pune',
        accommodationId: 1,
        packageId: 2,
        checkInDate,
        checkOutDate,
        numAdults: 2,
        numChildren: 0,
        paymentMethod: 'DEMO_UPI'
      })
    });
    const bookJson = await bookRes.json();
    assert.strictEqual(bookJson.success, true);
    const booking = bookJson.data;
    assert.strictEqual(booking.payment_method, 'DEMO_UPI');
    assert(booking.transaction_id.startsWith('TXN-CSR-'));
    assert.strictEqual(booking.booking_status, 'CONFIRMED');
    console.log(`✓ Booking created: ${booking.booking_reference}, Paid: ₹${booking.total_amount}, Txn: ${booking.transaction_id}`);

    // Check availability decremented
    const availAfterRes = await fetch(`${baseUrl}/api/availability?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}`);
    const availAfter = (await availAfterRes.json()).data;
    const domeAfter = availAfter.find(a => a.id === 1);
    assert.strictEqual(domeAfter.available_units, unitsBefore - 1);
    console.log(`✓ Availability reduced: ${unitsBefore} -> ${domeAfter.available_units}`);

    // 3. Customer checks Cancellation Preview (>7 days = 100% refund)
    console.log('Test 3: Customer Cancellation Preview (>7 days ahead)...');
    const previewRes = await fetch(`${baseUrl}/api/bookings/${booking.booking_reference}/cancellation-preview`);
    const previewJson = await previewRes.json();
    assert.strictEqual(previewJson.success, true);
    const preview = previewJson.data;
    assert.strictEqual(preview.refundPercentage, 100);
    assert.strictEqual(preview.refundAmount, booking.total_amount);
    console.log(`✓ Cancellation preview verified: 100% refund (₹${preview.refundAmount}), hours until check-in: ${preview.hoursUntilCheckIn}h`);

    // 4. Customer cancels the booking
    console.log('Test 4: Customer executes cancellation...');
    const cancelRes = await fetch(`${baseUrl}/api/bookings/${booking.booking_reference}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Family schedule conflict' })
    });
    const cancelJson = await cancelRes.json();
    assert.strictEqual(cancelJson.success, true);
    const cancelled = cancelJson.data;
    assert.strictEqual(cancelled.booking_status, 'CANCELLED');
    assert.strictEqual(cancelled.refund_status, 'PENDING_REFUND');
    assert.strictEqual(cancelled.refund_amount, booking.total_amount);
    console.log(`✓ Booking status cancelled, refund marked as PENDING_REFUND (₹${cancelled.refund_amount})`);

    // 5. Verify availability is immediately restored
    console.log('Test 5: Verify unit availability restored...');
    const availRestoredRes = await fetch(`${baseUrl}/api/availability?checkInDate=${checkInDate}&checkOutDate=${checkOutDate}`);
    const availRestored = (await availRestoredRes.json()).data;
    const domeRestored = availRestored.find(a => a.id === 1);
    assert.strictEqual(domeRestored.available_units, unitsBefore);
    console.log(`✓ Inventory successfully restored back to ${domeRestored.available_units} units!`);

    // 6. Admin checks Finance Overview
    console.log('Test 6: Admin Finance Overview...');
    const finRes = await fetch(`${baseUrl}/api/admin/finance`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const finJson = await finRes.json();
    assert.strictEqual(finJson.success, true);
    const fin = finJson.data;
    assert(fin.totalRefunds >= cancelled.refund_amount);
    assert(fin.pendingRefundsCount >= 1);
    console.log(`✓ Finance Ledger: Gross ₹${fin.grossRevenue}, Total Refunds ₹${fin.totalRefunds}, Pending Refunds: ${fin.pendingRefundsCount} (₹${fin.pendingRefundsAmount})`);

    // 7. Admin marks refund as REFUNDED
    console.log('Test 7: Admin marks refund as settled (REFUNDED)...');
    const settleRes = await fetch(`${baseUrl}/api/admin/bookings/${cancelled.id}/refund`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ refundStatus: 'REFUNDED' })
    });
    const settleJson = await settleRes.json();
    assert.strictEqual(settleJson.success, true);
    assert.strictEqual(settleJson.data.refund_status, 'REFUNDED');
    console.log(`✓ Refund status updated to REFUNDED`);

    // 8. Re-check Finance Overview: Pending refund should be reduced
    console.log('Test 8: Re-verifying Finance Ledger after settlement...');
    const finRes2 = await fetch(`${baseUrl}/api/admin/finance`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const fin2 = (await finRes2.json()).data;
    console.log(`✓ Post-settlement Finance Ledger: Completed Refunds: ${fin2.completedRefundsCount}, Pending: ${fin2.pendingRefundsCount}`);

    console.log('\n========================================');
    console.log('ALL CANCELLATION, REFUND & FINANCE TESTS PASSED!');
    console.log('========================================\n');
  } finally {
    server.close();
  }
}

runCancellationFinanceSuite().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
