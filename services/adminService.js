const crypto = require('node:crypto');
const { db, verifyPassword, hashPassword } = require('../db');
const { formatDate, parseDate, classifyNight } = require('./pricingService');

const AUTH_SECRET = process.env.ADMIN_SESSION_SECRET || 'camp-sandrush-secret-salt-key-2026';

function signStatelessToken(user) {
  const payload = {
    uid: user.id,
    u: user.username,
    r: user.role || 'ADMIN',
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyStatelessToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');

  if (signature.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return null;
    return {
      id: payload.uid,
      username: payload.u,
      role: payload.r
    };
  } catch (err) {
    return null;
  }
}

/**
 * Admin Authentication
 */
function loginAdmin(username, password) {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  const cleanUser = username.trim().toLowerCase();
  const cleanPass = password.trim();

  // 1. Check database for existing admin user (case-insensitive)
  let user;
  try {
    user = db.prepare('SELECT * FROM admin_users WHERE LOWER(username) = LOWER(?)').get(cleanUser);
  } catch (e) {
    // If DB is initializing or empty
    user = null;
  }

  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'sandrush2026!';

  // 2. Validate credentials
  if (cleanUser === 'admin' && cleanPass === defaultPassword) {
    // Valid admin credentials against default environment master key
    if (!user) {
      try {
        const { hash, salt } = hashPassword(defaultPassword);
        db.prepare(`
          INSERT OR REPLACE INTO admin_users (id, username, password_hash, salt, role, created_at)
          VALUES (1, 'admin', ?, ?, 'ADMIN', ?)
        `).run(hash, salt, new Date().toISOString());
        user = db.prepare('SELECT * FROM admin_users WHERE LOWER(username) = "admin"').get();
      } catch (e) {
        user = { id: 1, username: 'admin', role: 'ADMIN' };
      }
    }
  } else {
    if (!user) {
      throw new Error('Invalid admin credentials. Please check your username and password.');
    }
    const isValid = verifyPassword(cleanPass, user.password_hash, user.salt);
    if (!isValid) {
      throw new Error('Invalid admin credentials. Please check your username and password.');
    }
  }

  // 3. Generate stateless HMAC token
  const token = signStatelessToken(user);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Best-effort session recording into DB
  try {
    db.prepare(`
      INSERT INTO admin_sessions (token, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(token, user.id, now.toISOString(), expiresAt.toISOString());
  } catch (e) {
    // Non-blocking in serverless/ephemeral environments
  }

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  };
}

function verifySession(token) {
  if (!token) return null;

  // 1. First attempt stateless HMAC token verification (zero DB latency, survives across serverless instances)
  const statelessUser = verifyStatelessToken(token);
  if (statelessUser) {
    return statelessUser;
  }

  // 2. Fallback to SQLite DB session lookup
  try {
    const session = db.prepare(`
      SELECT s.token, s.expires_at, u.id as user_id, u.username, u.role
      FROM admin_sessions s
      JOIN admin_users u ON s.user_id = u.id
      WHERE s.token = ?
    `).get(token);

    if (!session) return null;

    const now = new Date();
    const expires = new Date(session.expires_at);

    if (now > expires) {
      try {
        db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
      } catch (e) {}
      return null;
    }

    return {
      id: session.user_id,
      username: session.username,
      role: session.role
    };
  } catch (err) {
    return null;
  }
}

function logoutAdmin(token) {
  if (token) {
    try {
      db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    } catch (e) {}
  }
  return true;
}

/**
 * Dashboard Summary KPIs
 */
function getDashboardStats() {
  const todayStr = formatDate(new Date());

  // Total gross revenue from active/confirmed bookings
  const revRow = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as total_revenue
    FROM bookings
    WHERE booking_status != 'CANCELLED'
  `).get();

  // Booking counts by status
  const countsRow = db.prepare(`
    SELECT
      COUNT(*) as total_bookings,
      SUM(CASE WHEN booking_status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed_count,
      SUM(CASE WHEN booking_status = 'CHECKED_IN' THEN 1 ELSE 0 END) as checked_in_count,
      SUM(CASE WHEN booking_status = 'CHECKED_OUT' THEN 1 ELSE 0 END) as checked_out_count,
      SUM(CASE WHEN booking_status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_count
    FROM bookings
  `).get();

  // Active in-camp stays today
  const activeStaysRow = db.prepare(`
    SELECT COUNT(*) as active_stays
    FROM bookings
    WHERE booking_status IN ('CONFIRMED', 'CHECKED_IN')
      AND check_in_date <= ?
      AND check_out_date > ?
  `).get(todayStr, todayStr);

  // Upcoming check-ins next 7 days
  const nextWeekStr = formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const upcomingRow = db.prepare(`
    SELECT COUNT(*) as upcoming_checkins
    FROM bookings
    WHERE booking_status = 'CONFIRMED'
      AND check_in_date >= ?
      AND check_in_date <= ?
  `).get(todayStr, nextWeekStr);

  // Total accommodation capacity units
  const totalUnitsRow = db.prepare('SELECT SUM(total_units) as total_units FROM accommodations').get();

  // Refund metrics
  const refundRow = db.prepare(`
    SELECT
      COALESCE(SUM(refund_amount), 0) as total_refunds,
      SUM(CASE WHEN refund_status = 'PENDING_REFUND' THEN 1 ELSE 0 END) as pending_refunds_count
    FROM bookings
  `).get();

  const totalRefunds = refundRow.total_refunds || 0;
  const netRevenue = Math.max(0, revRow.total_revenue - totalRefunds);

  // Recent 6 bookings
  const recentBookings = db.prepare(`
    SELECT b.id, b.booking_reference, b.customer_name, b.customer_phone,
           b.check_in_date, b.check_out_date, b.total_nights, b.total_amount,
           b.booking_status, b.payment_status, b.refund_status, b.refund_amount,
           b.stay_type_summary, b.created_at,
           a.name as accommodation_name
    FROM bookings b
    JOIN accommodations a ON b.accommodation_id = a.id
    ORDER BY b.id DESC
    LIMIT 6
  `).all();

  return {
    totalRevenue: revRow.total_revenue,
    totalRefunds,
    netRevenue,
    pendingRefundsCount: refundRow.pending_refunds_count || 0,
    totalBookings: countsRow.total_bookings || 0,
    confirmedBookings: countsRow.confirmed_count || 0,
    checkedInBookings: countsRow.checked_in_count || 0,
    checkedOutBookings: countsRow.checked_out_count || 0,
    cancelledBookings: countsRow.cancelled_count || 0,
    activeStaysToday: activeStaysRow.active_stays || 0,
    upcomingCheckins: upcomingRow.upcoming_checkins || 0,
    totalCampUnits: totalUnitsRow.total_units || 0,
    recentBookings
  };
}

function getFinanceOverview() {
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN booking_status != 'CANCELLED' THEN total_amount ELSE 0 END), 0) as gross_revenue,
      COALESCE(SUM(refund_amount), 0) as total_refunds,
      COALESCE(SUM(CASE WHEN refund_status = 'PENDING_REFUND' THEN refund_amount ELSE 0 END), 0) as pending_refunds_amount,
      SUM(CASE WHEN refund_status = 'PENDING_REFUND' THEN 1 ELSE 0 END) as pending_refunds_count,
      SUM(CASE WHEN refund_status = 'REFUNDED' THEN 1 ELSE 0 END) as completed_refunds_count
    FROM bookings
  `).get();

  const byPaymentMethod = db.prepare(`
    SELECT payment_method, COUNT(*) as count, SUM(total_amount) as total_amount
    FROM bookings
    WHERE booking_status != 'CANCELLED'
    GROUP BY payment_method
  `).all();

  const recentTransactions = db.prepare(`
    SELECT id, booking_reference, customer_name, customer_email, transaction_id,
           payment_method, payment_status, total_amount, booking_status,
           refund_amount, refund_percentage, refund_status, cancellation_reason, created_at
    FROM bookings
    ORDER BY id DESC
    LIMIT 30
  `).all();

  return {
    grossRevenue: summary.gross_revenue,
    totalRefunds: summary.total_refunds,
    netRevenue: Math.max(0, summary.gross_revenue - summary.total_refunds),
    pendingRefundsAmount: summary.pending_refunds_amount,
    pendingRefundsCount: summary.pending_refunds_count || 0,
    completedRefundsCount: summary.completed_refunds_count || 0,
    byPaymentMethod,
    recentTransactions
  };
}

function updateRefundStatus(bookingId, refundStatus) {
  const allowed = ['PENDING_REFUND', 'REFUNDED', 'NO_REFUND', 'NOT_APPLICABLE'];
  if (!allowed.includes(refundStatus)) {
    throw new Error(`Invalid refund status: ${refundStatus}`);
  }

  db.prepare('UPDATE bookings SET refund_status = ? WHERE id = ?').run(refundStatus, bookingId);
  return db.prepare('SELECT id, booking_reference, refund_amount, refund_status FROM bookings WHERE id = ?').get(bookingId);
}

/**
 * Bookings Management
 */
function getAdminBookings({ status = 'ALL', search = '', limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT b.id, b.booking_reference, b.customer_name, b.customer_email, b.customer_phone,
           b.customer_city, b.check_in_date, b.check_out_date, b.num_adults, b.num_children,
           b.total_nights, b.stay_type_summary, b.base_accommodation_amount, b.extra_guests_amount,
           b.package_amount, b.add_ons_amount, b.subtotal, b.tax_amount, b.total_amount,
           b.special_requests, b.booking_status, b.payment_status, b.created_at,
           b.payment_method, b.transaction_id, b.cancellation_reason, b.cancelled_at,
           b.refund_amount, b.refund_percentage, b.refund_status,
           a.name as accommodation_name, a.slug as accommodation_slug,
           p.name as package_name
    FROM bookings b
    JOIN accommodations a ON b.accommodation_id = a.id
    JOIN packages p ON b.package_id = p.id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'ALL') {
    sql += ' AND b.booking_status = ?';
    params.push(status);
  }

  if (search && search.trim()) {
    const s = `%${search.trim().toLowerCase()}%`;
    sql += ` AND (
      LOWER(b.booking_reference) LIKE ? OR
      LOWER(b.customer_name) LIKE ? OR
      LOWER(b.customer_email) LIKE ? OR
      LOWER(b.customer_phone) LIKE ?
    )`;
    params.push(s, s, s, s);
  }

  sql += ' ORDER BY b.id DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 50, Number(offset) || 0);

  const bookings = db.prepare(sql).all(...params);

  // Count total for pagination
  let countSql = 'SELECT COUNT(*) as count FROM bookings b WHERE 1=1';
  const countParams = [];
  if (status && status !== 'ALL') {
    countSql += ' AND b.booking_status = ?';
    countParams.push(status);
  }
  if (search && search.trim()) {
    const s = `%${search.trim().toLowerCase()}%`;
    countSql += ` AND (
      LOWER(b.booking_reference) LIKE ? OR
      LOWER(b.customer_name) LIKE ? OR
      LOWER(b.customer_email) LIKE ? OR
      LOWER(b.customer_phone) LIKE ?
    )`;
    countParams.push(s, s, s, s);
  }
  const totalCount = db.prepare(countSql).get(...countParams).count;

  return { bookings, totalCount };
}

function updateBookingStatus(id, newStatus) {
  const allowed = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}. Allowed: ${allowed.join(', ')}`);
  }

  const existing = db.prepare('SELECT id, booking_reference FROM bookings WHERE id = ?').get(id);
  if (!existing) {
    throw new Error(`Booking with ID ${id} not found`);
  }

  db.prepare('UPDATE bookings SET booking_status = ? WHERE id = ?').run(newStatus, id);
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

/**
 * Accommodations Management
 */
function getAdminAccommodations() {
  const rows = db.prepare('SELECT * FROM accommodations ORDER BY sort_order ASC, id ASC').all();
  return rows.map(r => ({
    ...r,
    amenities: JSON.parse(r.amenities || '[]'),
    features: JSON.parse(r.features || '[]')
  }));
}

function updateAccommodation(id, data) {
  const existing = db.prepare('SELECT id FROM accommodations WHERE id = ?').get(id);
  if (!existing) throw new Error(`Accommodation with ID ${id} not found`);

  const allowedCols = [
    'name', 'tagline', 'description', 'image_url',
    'base_capacity', 'max_capacity', 'extra_guest_rate', 'total_units',
    'weekday_rate', 'weekend_rate', 'special_event_rate',
    'amenities', 'features', 'sort_order'
  ];

  const fields = [];
  const params = [];

  for (const col of allowedCols) {
    if (data[col] !== undefined) {
      fields.push(`${col} = ?`);
      let val = data[col];
      if (col === 'amenities' || col === 'features') {
        val = typeof val === 'string' ? val : JSON.stringify(val);
      } else if (['base_capacity', 'max_capacity', 'extra_guest_rate', 'total_units', 'weekday_rate', 'weekend_rate', 'special_event_rate', 'sort_order'].includes(col)) {
        val = Number(val);
      }
      params.push(val);
    }
  }

  if (fields.length > 0) {
    params.push(id);
    db.prepare(`UPDATE accommodations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM accommodations WHERE id = ?').get(id);
  return {
    ...updated,
    amenities: JSON.parse(updated.amenities || '[]'),
    features: JSON.parse(updated.features || '[]')
  };
}

function createAccommodation(data) {
  const {
    slug, name, tagline, description, image_url,
    base_capacity = 2, max_capacity = 4, extra_guest_rate = 800, total_units = 5,
    weekday_rate, weekend_rate, special_event_rate,
    amenities = [], features = [], sort_order = 0
  } = data;

  if (!slug || !name || !weekday_rate || !weekend_rate || !special_event_rate) {
    throw new Error('slug, name, weekday_rate, weekend_rate, and special_event_rate are required');
  }

  const res = db.prepare(`
    INSERT INTO accommodations (
      slug, name, tagline, description, image_url,
      base_capacity, max_capacity, extra_guest_rate, total_units,
      weekday_rate, weekend_rate, special_event_rate,
      amenities, features, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug.trim().toLowerCase(), name.trim(), tagline || '', description || '', image_url || '',
    Number(base_capacity), Number(max_capacity), Number(extra_guest_rate), Number(total_units),
    Number(weekday_rate), Number(weekend_rate), Number(special_event_rate),
    typeof amenities === 'string' ? amenities : JSON.stringify(amenities),
    typeof features === 'string' ? features : JSON.stringify(features),
    Number(sort_order)
  );

  return db.prepare('SELECT * FROM accommodations WHERE id = ?').get(res.lastInsertRowid);
}

function deleteAccommodation(id) {
  // Check if active bookings exist
  const activeBookings = db.prepare(`
    SELECT COUNT(*) as count FROM bookings WHERE accommodation_id = ? AND booking_status != 'CANCELLED'
  `).get(id);

  if (activeBookings && activeBookings.count > 0) {
    throw new Error(`Cannot delete accommodation: It has ${activeBookings.count} active reservations.`);
  }

  db.prepare('DELETE FROM accommodations WHERE id = ?').run(id);
  return { success: true };
}

/**
 * Packages Management
 */
function getAdminPackages() {
  const rows = db.prepare('SELECT * FROM packages ORDER BY id ASC').all();
  return rows.map(r => ({
    ...r,
    inclusions: JSON.parse(r.inclusions || '[]')
  }));
}

function createPackage(data) {
  const { slug, name, badge, description, per_person_rate = 0, flat_rate = 0, inclusions = [], popular = 0, image_url = '' } = data;
  if (!slug || !name) throw new Error('Package slug and name are required');

  const res = db.prepare(`
    INSERT INTO packages (slug, name, badge, description, per_person_rate, flat_rate, inclusions, popular, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug.trim().toLowerCase(), name.trim(), badge || '', description || '',
    Number(per_person_rate), Number(flat_rate),
    typeof inclusions === 'string' ? inclusions : JSON.stringify(inclusions),
    Number(popular ? 1 : 0), image_url
  );

  return db.prepare('SELECT * FROM packages WHERE id = ?').get(res.lastInsertRowid);
}

function updatePackage(id, data) {
  const existing = db.prepare('SELECT id FROM packages WHERE id = ?').get(id);
  if (!existing) throw new Error(`Package with ID ${id} not found`);

  const allowedCols = ['name', 'badge', 'description', 'per_person_rate', 'flat_rate', 'inclusions', 'popular', 'image_url'];
  const fields = [];
  const params = [];

  for (const col of allowedCols) {
    if (data[col] !== undefined) {
      fields.push(`${col} = ?`);
      let val = data[col];
      if (col === 'inclusions') {
        val = typeof val === 'string' ? val : JSON.stringify(val);
      } else if (col === 'per_person_rate' || col === 'flat_rate') {
        val = Number(val);
      } else if (col === 'popular') {
        val = Number(val ? 1 : 0);
      }
      params.push(val);
    }
  }

  if (fields.length > 0) {
    params.push(id);
    db.prepare(`UPDATE packages SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM packages WHERE id = ?').get(id);
  return {
    ...updated,
    inclusions: JSON.parse(updated.inclusions || '[]')
  };
}

function deletePackage(id) {
  const activeBookings = db.prepare('SELECT COUNT(*) as count FROM bookings WHERE package_id = ? AND booking_status != \'CANCELLED\'').get(id);
  if (activeBookings && activeBookings.count > 0) {
    throw new Error(`Cannot delete package: It is linked to ${activeBookings.count} active reservations.`);
  }
  db.prepare('DELETE FROM packages WHERE id = ?').run(id);
  return { success: true };
}

/**
 * Special Events Management
 */
function getAdminEvents() {
  const rows = db.prepare('SELECT * FROM special_events ORDER BY start_date ASC').all();
  return rows.map(r => ({
    ...r,
    included_highlights: JSON.parse(r.included_highlights || '[]')
  }));
}

function createEvent(data) {
  const { slug, name, tagline, description, start_date, end_date, badge_text, price_multiplier = 1.0, included_highlights = [], image_url = '', is_active = 1 } = data;
  if (!slug || !name || !start_date || !end_date) {
    throw new Error('slug, name, start_date, and end_date are required');
  }

  const res = db.prepare(`
    INSERT INTO special_events (
      slug, name, tagline, description, start_date, end_date,
      badge_text, price_multiplier, included_highlights, image_url, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug.trim().toLowerCase(), name.trim(), tagline || '', description || '',
    start_date, end_date, badge_text || '', Number(price_multiplier),
    typeof included_highlights === 'string' ? included_highlights : JSON.stringify(included_highlights),
    image_url, Number(is_active ? 1 : 0)
  );

  return db.prepare('SELECT * FROM special_events WHERE id = ?').get(res.lastInsertRowid);
}

function updateEvent(id, data) {
  const existing = db.prepare('SELECT id FROM special_events WHERE id = ?').get(id);
  if (!existing) throw new Error(`Special event with ID ${id} not found`);

  const allowedCols = ['name', 'tagline', 'description', 'start_date', 'end_date', 'badge_text', 'price_multiplier', 'included_highlights', 'image_url', 'is_active'];
  const fields = [];
  const params = [];

  for (const col of allowedCols) {
    if (data[col] !== undefined) {
      fields.push(`${col} = ?`);
      let val = data[col];
      if (col === 'included_highlights') {
        val = typeof val === 'string' ? val : JSON.stringify(val);
      } else if (col === 'price_multiplier') {
        val = Number(val);
      } else if (col === 'is_active') {
        val = Number(val ? 1 : 0);
      }
      params.push(val);
    }
  }

  if (fields.length > 0) {
    params.push(id);
    db.prepare(`UPDATE special_events SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM special_events WHERE id = ?').get(id);
  return {
    ...updated,
    included_highlights: JSON.parse(updated.included_highlights || '[]')
  };
}

function deleteEvent(id) {
  db.prepare('DELETE FROM special_events WHERE id = ?').run(id);
  return { success: true };
}

/**
 * Customers Directory
 */
function getAdminCustomers({ search = '' } = {}) {
  let sql = `
    SELECT
      customer_email,
      customer_name,
      customer_phone,
      customer_city,
      COUNT(id) as total_bookings,
      SUM(CASE WHEN booking_status != 'CANCELLED' THEN total_amount ELSE 0 END) as total_spent,
      MAX(created_at) as last_booking_date
    FROM bookings
    WHERE 1=1
  `;
  const params = [];

  if (search && search.trim()) {
    const s = `%${search.trim().toLowerCase()}%`;
    sql += ` AND (
      LOWER(customer_name) LIKE ? OR
      LOWER(customer_email) LIKE ? OR
      LOWER(customer_phone) LIKE ? OR
      LOWER(customer_city) LIKE ?
    )`;
    params.push(s, s, s, s);
  }

  sql += ' GROUP BY customer_email ORDER BY last_booking_date DESC';
  const customers = db.prepare(sql).all(...params);

  return customers;
}

function getCustomerBookingHistory(email) {
  if (!email) return [];
  return db.prepare(`
    SELECT b.*, a.name as accommodation_name, p.name as package_name
    FROM bookings b
    JOIN accommodations a ON b.accommodation_id = a.id
    JOIN packages p ON b.package_id = p.id
    WHERE LOWER(b.customer_email) = LOWER(?)
    ORDER BY b.id DESC
  `).all(email.trim());
}

/**
 * Availability Management & Calendar Inspector
 */
function getAvailabilityOverview(startDateStr, numDays = 14) {
  const start = startDateStr ? parseDate(startDateStr) : new Date();
  const accommodations = db.prepare('SELECT id, name, slug, total_units, weekday_rate, weekend_rate, special_event_rate FROM accommodations ORDER BY sort_order ASC').all();
  const activeEvents = db.prepare('SELECT * FROM special_events WHERE is_active = 1').all();

  const days = [];
  const curr = new Date(start);

  // Statement to fetch active bookings overlapping a specific date
  const bookingsOnDateStmt = db.prepare(`
    SELECT b.id, b.booking_reference, b.customer_name, b.customer_phone,
           b.accommodation_id, b.booking_status, b.num_adults, b.num_children
    FROM bookings b
    WHERE b.booking_status != 'CANCELLED'
      AND b.check_in_date <= ?
      AND b.check_out_date > ?
  `);

  for (let i = 0; i < numDays; i++) {
    const dateStr = formatDate(curr);
    const dayName = curr.toLocaleDateString('en-US', { weekday: 'short' });
    const classification = classifyNight(dateStr, activeEvents);

    const activeBookings = bookingsOnDateStmt.all(dateStr, dateStr);

    const accStatus = accommodations.map(acc => {
      const bookedList = activeBookings.filter(b => b.accommodation_id === acc.id);
      const bookedCount = bookedList.length;
      const availableUnits = Math.max(0, acc.total_units - bookedCount);
      const occupancyPercent = acc.total_units > 0 ? Math.round((bookedCount / acc.total_units) * 100) : 0;

      return {
        accommodationId: acc.id,
        accommodationName: acc.name,
        totalUnits: acc.total_units,
        bookedUnits: bookedCount,
        availableUnits,
        occupancyPercent,
        bookings: bookedList
      };
    });

    const totalCampUnits = accommodations.reduce((sum, a) => sum + a.total_units, 0);
    const totalCampBooked = accStatus.reduce((sum, a) => sum + a.bookedUnits, 0);
    const overallOccupancy = totalCampUnits > 0 ? Math.round((totalCampBooked / totalCampUnits) * 100) : 0;

    days.push({
      date: dateStr,
      dayName,
      dayClassification: classification,
      totalCampUnits,
      totalCampBooked,
      overallOccupancy,
      accommodations: accStatus
    });

    curr.setDate(curr.getDate() + 1);
  }

  return {
    startDate: formatDate(start),
    numDays,
    accommodations,
    days
  };
}

module.exports = {
  loginAdmin,
  verifySession,
  logoutAdmin,
  getDashboardStats,
  getAdminBookings,
  updateBookingStatus,
  getAdminAccommodations,
  createAccommodation,
  updateAccommodation,
  deleteAccommodation,
  getAdminPackages,
  createPackage,
  updatePackage,
  deletePackage,
  getAdminEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getAdminCustomers,
  getCustomerBookingHistory,
  getAvailabilityOverview,
  getFinanceOverview,
  updateRefundStatus
};
