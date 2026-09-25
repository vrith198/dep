const crypto = require('node:crypto');
const { db } = require('../db');
const { calculateStayPricing, parseDate, formatDate } = require('./pricingService');

/**
 * Generate a customer-friendly booking reference like CSR-2026-8K4E2
 */
function generateBookingReference() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude easily confused 0/O, 1/I
  let code = '';
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) {
    code += chars[bytes[i] % chars.length];
  }
  const year = new Date().getFullYear();
  return `CSR-${year}-${code}`;
}

/**
 * Check availability for all accommodations or a specific accommodation over a date range
 */
function checkAvailability(checkInDate, checkOutDate, accommodationId = null) {
  if (!checkInDate || !checkOutDate) {
    throw new Error('Check-in and Check-out dates are required');
  }

  const checkIn = parseDate(checkInDate);
  const checkOut = parseDate(checkOutDate);

  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD');
  }

  if (checkOut <= checkIn) {
    throw new Error('Check-out date must be after check-in date');
  }

  let accQuery = 'SELECT * FROM accommodations';
  const params = [];
  if (accommodationId) {
    accQuery += ' WHERE id = ?';
    params.push(accommodationId);
  }
  accQuery += ' ORDER BY sort_order ASC';

  const accommodations = db.prepare(accQuery).all(...params);

  // Statement to count active bookings for an accommodation on a specific night
  const countBookingsStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM bookings
    WHERE accommodation_id = ?
      AND booking_status != 'CANCELLED'
      AND check_in_date <= ?
      AND check_out_date > ?
  `);

  const results = accommodations.map(acc => {
    let maxBookedOnAnyNight = 0;
    let curr = new Date(checkIn);

    while (curr < checkOut) {
      const dateStr = formatDate(curr);
      const row = countBookingsStmt.get(acc.id, dateStr, dateStr);
      const bookedCount = row ? row.count : 0;
      if (bookedCount > maxBookedOnAnyNight) {
        maxBookedOnAnyNight = bookedCount;
      }
      curr.setDate(curr.getDate() + 1);
    }

    const availableUnits = Math.max(0, acc.total_units - maxBookedOnAnyNight);
    let statusText = 'Available';
    let isAvailable = true;

    if (availableUnits <= 0) {
      statusText = 'Sold Out';
      isAvailable = false;
    } else if (availableUnits <= 2) {
      statusText = `Only ${availableUnits} Left!`;
    } else {
      statusText = `${availableUnits} Available`;
    }

    return {
      id: acc.id,
      slug: acc.slug,
      name: acc.name,
      tagline: acc.tagline,
      description: acc.description,
      image_url: acc.image_url,
      base_capacity: acc.base_capacity,
      max_capacity: acc.max_capacity,
      weekday_rate: acc.weekday_rate,
      weekend_rate: acc.weekend_rate,
      special_event_rate: acc.special_event_rate,
      total_units: acc.total_units,
      booked_units: maxBookedOnAnyNight,
      available_units: availableUnits,
      is_available: isAvailable,
      status_text: statusText,
      amenities: JSON.parse(acc.amenities || '[]'),
      features: JSON.parse(acc.features || '[]')
    };
  });

  return results;
}

/**
 * Create a new confirmed booking atomically
 */
function createBooking({
  customerName,
  customerEmail,
  customerPhone,
  customerCity = '',
  accommodationId,
  packageId,
  checkInDate,
  checkOutDate,
  numAdults = 2,
  numChildren = 0,
  selectedAddOns = [],
  specialRequests = '',
  paymentMethod = 'DEMO_UPI'
}) {
  // Validate basic inputs
  if (!customerName || !customerName.trim()) {
    throw new Error('Customer full name is required');
  }
  if (!customerEmail || !customerEmail.includes('@')) {
    throw new Error('A valid email address is required');
  }
  if (!customerPhone || customerPhone.trim().length < 8) {
    throw new Error('A valid phone number is required (min 8 digits)');
  }
  if (!accommodationId) {
    throw new Error('Accommodation selection is required');
  }
  if (!packageId) {
    throw new Error('Package selection is required');
  }

  // Calculate price and validate capacity & dates
  const pricing = calculateStayPricing({
    accommodationId,
    packageId,
    checkInDate,
    checkOutDate,
    numAdults,
    numChildren,
    selectedAddOns
  });

  // Execute inside SQLite transaction to prevent race conditions / double bookings
  db.exec('BEGIN TRANSACTION;');

  try {
    // Re-verify availability within transaction
    const avail = checkAvailability(checkInDate, checkOutDate, accommodationId);
    const targetAcc = avail[0];

    if (!targetAcc || !targetAcc.is_available) {
      throw new Error(`Sorry! ${targetAcc ? targetAcc.name : 'The selected accommodation'} is no longer available for your chosen dates.`);
    }

    // Generate unique reference
    let bookingRef = generateBookingReference();
    let collisionCheck = db.prepare('SELECT id FROM bookings WHERE booking_reference = ?').get(bookingRef);
    while (collisionCheck) {
      bookingRef = generateBookingReference();
      collisionCheck = db.prepare('SELECT id FROM bookings WHERE booking_reference = ?').get(bookingRef);
    }

    const now = new Date().toISOString();
    const finalPaymentMethod = paymentMethod || 'DEMO_UPI';
    const txnId = `TXN-CSR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const paymentStatus = finalPaymentMethod === 'PAY_AT_CAMP' ? 'PAID_DEPOSIT' : 'PAID_FULL';

    const insertBooking = db.prepare(`
      INSERT INTO bookings (
        booking_reference, customer_name, customer_email, customer_phone, customer_city,
        check_in_date, check_out_date, num_adults, num_children, total_nights,
        accommodation_id, package_id, stay_type_summary, night_breakdown_json,
        base_accommodation_amount, extra_guests_amount, package_amount, add_ons_amount,
        subtotal, tax_amount, total_amount, special_requests,
        payment_method, transaction_id,
        booking_status, payment_status, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        'CONFIRMED', ?, ?
      )
    `);

    const bookingResult = insertBooking.run(
      bookingRef,
      customerName.trim(),
      customerEmail.trim().toLowerCase(),
      customerPhone.trim(),
      customerCity ? customerCity.trim() : '',
      checkInDate,
      checkOutDate,
      pricing.numAdults,
      pricing.numChildren,
      pricing.totalNights,
      accommodationId,
      packageId,
      pricing.stayTypeSummary,
      JSON.stringify(pricing.nightBreakdown),
      pricing.pricingBreakdown.baseAccommodationAmount,
      pricing.pricingBreakdown.extraGuestsAmount,
      pricing.pricingBreakdown.packageAmount,
      pricing.pricingBreakdown.addOnsAmount,
      pricing.pricingBreakdown.subtotal,
      pricing.pricingBreakdown.taxAmount,
      pricing.pricingBreakdown.totalAmount,
      specialRequests ? specialRequests.trim() : '',
      finalPaymentMethod,
      txnId,
      paymentStatus,
      now
    );

    const bookingId = Number(bookingResult.lastInsertRowid);

    // Insert add-ons if any
    const insertAddOnStmt = db.prepare(`
      INSERT INTO booking_add_ons (
        booking_id, add_on_id, quantity, unit_price, total_price
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const addon of pricing.selectedAddOns) {
      insertAddOnStmt.run(
        bookingId,
        addon.id,
        addon.quantity,
        addon.unit_price,
        addon.total_price
      );
    }

    db.exec('COMMIT;');

    return getBookingByReference(bookingRef);
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Calculate refund eligibility according to Camp Sandrush cancellation rules:
 * - > 7 days (168+ hrs) before 3:00 PM check-in: 100% full refund
 * - 3 to 7 days (72-168 hrs) before check-in: 50% refund
 * - < 3 days (< 72 hrs) before check-in: 0% non-refundable
 */
function calculateCancellationRefund(booking, cancellationDateTime = new Date()) {
  const [y, m, d] = booking.check_in_date.split('-').map(Number);
  const checkInDateTime = new Date(y, m - 1, d, 15, 0, 0); // 3:00 PM check-in

  const diffMs = checkInDateTime.getTime() - cancellationDateTime.getTime();
  const hoursUntilCheckIn = diffMs / (1000 * 60 * 60);
  const daysUntilCheckIn = Math.floor(hoursUntilCheckIn / 24);

  let refundPercentage = 0;
  let policyTier = '';
  let policyDescription = '';
  let refundStatus = 'NO_REFUND';

  if (hoursUntilCheckIn >= 168) {
    // 7+ days (168+ hours)
    refundPercentage = 100;
    policyTier = 'Tier 1 (7+ Days Prior)';
    policyDescription = 'Eligible for 100% full refund (cancelled 7 or more days prior to check-in).';
    refundStatus = 'PENDING_REFUND';
  } else if (hoursUntilCheckIn >= 72) {
    // 3 to 7 days (72 - 168 hours)
    refundPercentage = 50;
    policyTier = 'Tier 2 (3 to 7 Days Prior)';
    policyDescription = 'Eligible for 50% partial refund (cancelled between 72 hours and 7 days prior to check-in).';
    refundStatus = 'PENDING_REFUND';
  } else {
    // Less than 72 hours
    refundPercentage = 0;
    policyTier = 'Tier 3 (Under 72 Hours)';
    policyDescription = 'Non-refundable (cancellations under 72 hours prior to scheduled check-in).';
    refundStatus = 'NO_REFUND';
  }

  const refundAmount = Math.round((booking.total_amount * refundPercentage) / 100);

  return {
    hoursUntilCheckIn: Math.max(0, Math.round(hoursUntilCheckIn * 10) / 10),
    daysUntilCheckIn: Math.max(0, daysUntilCheckIn),
    refundPercentage,
    policyTier,
    policyDescription,
    refundAmount,
    refundStatus,
    totalPaid: booking.total_amount,
    checkInDateTime: checkInDateTime.toISOString()
  };
}

/**
 * Execute cancellation of a booking and compute refund
 */
function cancelBooking({ bookingReference, emailOrPhone = null, reason = 'Customer requested cancellation', isAdmin = false }) {
  if (!bookingReference) throw new Error('Booking reference is required');

  const booking = getBookingByReference(bookingReference);
  if (!booking) throw new Error(`Booking reference ${bookingReference} not found`);

  if (booking.booking_status === 'CANCELLED') {
    throw new Error('This booking has already been cancelled');
  }

  // Security check for customer-initiated cancellation
  if (!isAdmin && emailOrPhone) {
    const input = emailOrPhone.trim().toLowerCase();
    const emailMatch = booking.customer_email.toLowerCase() === input;
    const phoneMatch = booking.customer_phone.replace(/\D/g, '') === input.replace(/\D/g, '');
    if (!emailMatch && !phoneMatch) {
      throw new Error('Verification failed: Email or phone number does not match this reservation.');
    }
  }

  const now = new Date();
  const refundInfo = calculateCancellationRefund(booking, now);

  db.prepare(`
    UPDATE bookings SET
      booking_status = 'CANCELLED',
      cancellation_reason = ?,
      cancelled_at = ?,
      refund_amount = ?,
      refund_percentage = ?,
      refund_status = ?
    WHERE id = ?
  `).run(
    reason ? reason.trim() : 'Customer requested cancellation',
    now.toISOString(),
    refundInfo.refundAmount,
    refundInfo.refundPercentage,
    refundInfo.refundStatus,
    booking.id
  );

  return {
    ...getBookingByReference(bookingReference),
    refundInfo
  };
}

/**
 * Retrieve booking details by reference ID
 */
function getBookingByReference(bookingReference) {
  if (!bookingReference) return null;

  const booking = db.prepare(`
    SELECT b.*,
           a.name as accommodation_name,
           a.slug as accommodation_slug,
           a.image_url as accommodation_image,
           p.name as package_name,
           p.slug as package_slug,
           p.badge as package_badge
    FROM bookings b
    JOIN accommodations a ON b.accommodation_id = a.id
    JOIN packages p ON b.package_id = p.id
    WHERE UPPER(b.booking_reference) = UPPER(?)
  `).get(bookingReference.trim());

  if (!booking) return null;

  // Fetch add-ons
  const addOns = db.prepare(`
    SELECT bao.quantity, bao.unit_price, bao.total_price,
           ao.id, ao.name, ao.slug, ao.charge_type, ao.icon
    FROM booking_add_ons bao
    JOIN add_ons ao ON bao.add_on_id = ao.id
    WHERE bao.booking_id = ?
  `).all(booking.id);

  let nightBreakdown = [];
  try {
    nightBreakdown = JSON.parse(booking.night_breakdown_json || '[]');
  } catch (e) {
    nightBreakdown = [];
  }

  return {
    ...booking,
    night_breakdown: nightBreakdown,
    add_ons: addOns
  };
}

module.exports = {
  generateBookingReference,
  checkAvailability,
  createBooking,
  getBookingByReference,
  calculateCancellationRefund,
  cancelBooking
};
