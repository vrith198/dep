const { db } = require('../db');

/**
 * Format a Date object to YYYY-MM-DD in local time
 */
function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse YYYY-MM-DD string to Date object (local midnight)
 */
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Get day of week name
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Classify whether a night is a weekday (Mon-Thu), weekend (Fri-Sun), or special-event
 */
function classifyNight(dateStr, activeEvents) {
  // Check if date falls in any active special event
  // An event spans from start_date to end_date (inclusive of stay nights)
  const event = activeEvents.find(e => {
    return dateStr >= e.start_date && dateStr < e.end_date;
  });

  if (event) {
    return {
      type: 'special_event',
      label: 'Special Event',
      eventId: event.id,
      eventName: event.name,
      badgeText: event.badge_text || 'Festival Night',
      priceMultiplier: event.price_multiplier || 1.0
    };
  }

  const dt = parseDate(dateStr);
  const dayOfWeek = dt.getDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday

  // Friday (5), Saturday (6), Sunday (0) are Weekend nights for beach camping
  if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
    return {
      type: 'weekend',
      label: 'Weekend Rate',
      eventId: null,
      eventName: null,
      badgeText: 'Weekend Getaway',
      priceMultiplier: 1.0
    };
  }

  // Mon (1), Tue (2), Wed (3), Thu (4) are Weekday nights
  return {
    type: 'weekday',
    label: 'Weekday Rate',
    eventId: null,
    eventName: null,
    badgeText: 'Weekday Calm',
    priceMultiplier: 1.0
  };
}

/**
 * Calculate complete pricing breakdown for a stay
 */
function calculateStayPricing({
  accommodationId,
  packageId,
  checkInDate,
  checkOutDate,
  numAdults = 2,
  numChildren = 0,
  selectedAddOns = [] // Array of { addOnId, quantity }
}) {
  // Validate dates
  if (!checkInDate || !checkOutDate) {
    throw new Error('Check-in and Check-out dates are required');
  }

  const checkIn = parseDate(checkInDate);
  const checkOut = parseDate(checkOutDate);

  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD');
  }

  const diffMs = checkOut.getTime() - checkIn.getTime();
  const totalNights = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (totalNights <= 0) {
    throw new Error('Check-out date must be after check-in date (minimum 1 night stay)');
  }

  if (totalNights > 30) {
    throw new Error('Maximum stay duration is 30 nights');
  }

  // Fetch accommodation
  const acc = db.prepare('SELECT * FROM accommodations WHERE id = ?').get(accommodationId);
  if (!acc) {
    throw new Error(`Accommodation with ID ${accommodationId} not found`);
  }

  const totalGuests = Number(numAdults) + Number(numChildren);
  if (totalGuests <= 0) {
    throw new Error('At least one guest is required');
  }

  if (totalGuests > acc.max_capacity) {
    throw new Error(`Total guests (${totalGuests}) exceed maximum capacity (${acc.max_capacity}) for ${acc.name}`);
  }

  // Fetch package
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(packageId);
  if (!pkg) {
    throw new Error(`Package with ID ${packageId} not found`);
  }

  // Fetch active special events that could overlap with stay
  const activeEvents = db.prepare('SELECT * FROM special_events WHERE is_active = 1').all();

  // Iterate over each night and classify
  const nightBreakdown = [];
  let baseAccommodationAmount = 0;
  let weekdayNights = 0;
  let weekendNights = 0;
  let specialEventNights = 0;

  let curr = new Date(checkIn);
  while (curr < checkOut) {
    const dateStr = formatDate(curr);
    const dayName = DAY_NAMES[curr.getDay()];
    const classification = classifyNight(dateStr, activeEvents);

    let nightRate = 0;
    if (classification.type === 'special_event') {
      nightRate = Math.round(acc.special_event_rate * classification.priceMultiplier);
      specialEventNights++;
    } else if (classification.type === 'weekend') {
      nightRate = acc.weekend_rate;
      weekendNights++;
    } else {
      nightRate = acc.weekday_rate;
      weekdayNights++;
    }

    baseAccommodationAmount += nightRate;

    nightBreakdown.push({
      date: dateStr,
      dayName,
      type: classification.type,
      label: classification.label,
      badgeText: classification.badgeText,
      eventName: classification.eventName,
      rate: nightRate
    });

    curr.setDate(curr.getDate() + 1);
  }

  // Determine stay summary type
  let stayTypeSummary = 'Mixed Stay';
  if (specialEventNights === totalNights) {
    const evName = nightBreakdown[0].eventName || 'Special Event';
    stayTypeSummary = `Special Event (${evName})`;
  } else if (weekendNights === totalNights) {
    stayTypeSummary = 'Weekend Getaway';
  } else if (weekdayNights === totalNights) {
    stayTypeSummary = 'Weekday Calm';
  } else {
    const parts = [];
    if (weekdayNights > 0) parts.push(`${weekdayNights} Weekday`);
    if (weekendNights > 0) parts.push(`${weekendNights} Weekend`);
    if (specialEventNights > 0) parts.push(`${specialEventNights} Event`);
    stayTypeSummary = parts.join(' + ') + ' Nights';
  }

  // Extra guest charge (if guests exceed base capacity)
  let extraGuestsAmount = 0;
  const extraGuestsCount = Math.max(0, totalGuests - acc.base_capacity);
  if (extraGuestsCount > 0) {
    extraGuestsAmount = extraGuestsCount * acc.extra_guest_rate * totalNights;
  }

  // Package calculation
  let packageAmount = 0;
  if (pkg.flat_rate > 0) {
    packageAmount = pkg.flat_rate;
  } else if (pkg.per_person_rate > 0) {
    // Adults full rate, children (if any) at 60% rate
    packageAmount = (Number(numAdults) * pkg.per_person_rate) +
                    Math.round(Number(numChildren) * pkg.per_person_rate * 0.6);
  }

  // Add-ons calculation
  let addOnsAmount = 0;
  const processedAddOns = [];

  if (Array.isArray(selectedAddOns) && selectedAddOns.length > 0) {
    const addOnIds = selectedAddOns.map(a => a.addOnId);
    const placeholders = addOnIds.map(() => '?').join(',');
    const addOnRows = db.prepare(`SELECT * FROM add_ons WHERE id IN (${placeholders})`).all(...addOnIds);
    const addOnMap = new Map(addOnRows.map(r => [r.id, r]));

    for (const item of selectedAddOns) {
      const addon = addOnMap.get(Number(item.addOnId));
      if (!addon) continue;

      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      let itemTotal = 0;

      if (addon.charge_type === 'per_person') {
        itemTotal = addon.price * qty * totalGuests;
      } else if (addon.charge_type === 'per_night') {
        itemTotal = addon.price * qty * totalNights;
      } else {
        // per_stay
        itemTotal = addon.price * qty;
      }

      addOnsAmount += itemTotal;
      processedAddOns.push({
        id: addon.id,
        name: addon.name,
        slug: addon.slug,
        charge_type: addon.charge_type,
        unit_price: addon.price,
        quantity: qty,
        total_price: itemTotal
      });
    }
  }

  // Subtotal & Taxes (12% GST)
  const subtotal = baseAccommodationAmount + extraGuestsAmount + packageAmount + addOnsAmount;
  const taxRate = 0.12;
  const taxAmount = Math.round(subtotal * taxRate);
  const totalAmount = subtotal + taxAmount;

  return {
    checkInDate,
    checkOutDate,
    totalNights,
    numAdults: Number(numAdults),
    numChildren: Number(numChildren),
    totalGuests,
    extraGuestsCount,
    accommodation: {
      id: acc.id,
      slug: acc.slug,
      name: acc.name,
      image_url: acc.image_url,
      base_capacity: acc.base_capacity,
      max_capacity: acc.max_capacity,
      weekday_rate: acc.weekday_rate,
      weekend_rate: acc.weekend_rate,
      special_event_rate: acc.special_event_rate
    },
    package: {
      id: pkg.id,
      slug: pkg.slug,
      name: pkg.name,
      badge: pkg.badge,
      per_person_rate: pkg.per_person_rate,
      flat_rate: pkg.flat_rate
    },
    stayTypeSummary,
    weekdayNights,
    weekendNights,
    specialEventNights,
    nightBreakdown,
    selectedAddOns: processedAddOns,
    pricingBreakdown: {
      baseAccommodationAmount,
      extraGuestsAmount,
      packageAmount,
      addOnsAmount,
      subtotal,
      taxRate: 0.12,
      taxAmount,
      totalAmount
    }
  };
}

module.exports = {
  formatDate,
  parseDate,
  classifyNight,
  calculateStayPricing
};
