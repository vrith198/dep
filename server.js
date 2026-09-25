const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { db } = require('./db');
const { calculateStayPricing } = require('./services/pricingService');
const { checkAvailability, createBooking, getBookingByReference, calculateCancellationRefund, cancelBooking } = require('./services/bookingService');
const adminService = require('./services/adminService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ==========================================================================
   PUBLIC CUSTOMER API ROUTES
   ========================================================================== */

// 1. Get all accommodations
app.get('/api/accommodations', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM accommodations ORDER BY sort_order ASC').all();
    const formatted = rows.map(r => ({
      ...r,
      amenities: JSON.parse(r.amenities || '[]'),
      features: JSON.parse(r.features || '[]')
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get all packages
app.get('/api/packages', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM packages ORDER BY id ASC').all();
    const formatted = rows.map(r => ({
      ...r,
      inclusions: JSON.parse(r.inclusions || '[]')
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Get special events
app.get('/api/special-events', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM special_events WHERE is_active = 1 ORDER BY start_date ASC').all();
    const formatted = rows.map(r => ({
      ...r,
      included_highlights: JSON.parse(r.included_highlights || '[]')
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Get add-ons
app.get('/api/add-ons', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM add_ons ORDER BY price ASC').all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Date Availability Check
app.get('/api/availability', (req, res) => {
  try {
    const check_in = req.query.check_in || req.query.checkInDate;
    const check_out = req.query.check_out || req.query.checkOutDate;
    const accommodation_id = req.query.accommodation_id || req.query.accommodationId;
    if (!check_in || !check_out) {
      return res.status(400).json({
        success: false,
        error: 'check_in (or checkInDate) and check_out (or checkOutDate) query parameters are required (YYYY-MM-DD)'
      });
    }

    const results = checkAvailability(check_in, check_out, accommodation_id ? Number(accommodation_id) : null);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6. Live Pricing Preview
app.post('/api/pricing-preview', (req, res) => {
  try {
    const {
      accommodationId,
      packageId,
      checkInDate,
      checkOutDate,
      numAdults,
      numChildren,
      selectedAddOns
    } = req.body;

    const pricing = calculateStayPricing({
      accommodationId: Number(accommodationId),
      packageId: Number(packageId),
      checkInDate,
      checkOutDate,
      numAdults: Number(numAdults || 2),
      numChildren: Number(numChildren || 0),
      selectedAddOns: selectedAddOns || []
    });

    res.json({ success: true, data: pricing });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 7. Create Confirmed Booking
app.post('/api/bookings', (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      customerCity,
      accommodationId,
      packageId,
      checkInDate,
      checkOutDate,
      numAdults,
      numChildren,
      selectedAddOns,
      specialRequests,
      paymentMethod
    } = req.body;

    const booking = createBooking({
      customerName,
      customerEmail,
      customerPhone,
      customerCity,
      accommodationId: Number(accommodationId),
      packageId: Number(packageId),
      checkInDate,
      checkOutDate,
      numAdults: Number(numAdults || 2),
      numChildren: Number(numChildren || 0),
      selectedAddOns: selectedAddOns || [],
      specialRequests,
      paymentMethod
    });

    res.status(201).json({
      success: true,
      message: 'Booking confirmed successfully!',
      data: booking
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. Lookup Booking by Reference ID
app.get('/api/bookings/:reference', (req, res) => {
  try {
    const { reference } = req.params;
    const booking = getBookingByReference(reference);

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: `No booking found with reference ID "${reference}". Please double-check and try again.`
      });
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8b. Cancellation & Refund Preview
app.get('/api/bookings/:reference/cancellation-preview', (req, res) => {
  try {
    const { reference } = req.params;
    const booking = getBookingByReference(reference);
    if (!booking) {
      return res.status(404).json({ success: false, error: `Booking reference "${reference}" not found` });
    }
    const refundInfo = calculateCancellationRefund(booking);
    res.json({
      success: true,
      data: {
        booking,
        refundInfo,
        ...refundInfo,
        ruleDescription: refundInfo.policyTier,
        applicablePolicy: refundInfo.policyDescription,
        totalAmount: booking.total_amount
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8c. Execute Booking Cancellation (Customer & Admin)
app.post('/api/bookings/:reference/cancel', (req, res) => {
  try {
    const { reference } = req.params;
    const { emailOrPhone, reason } = req.body;
    const result = cancelBooking({
      bookingReference: reference,
      emailOrPhone,
      reason,
      isAdmin: false
    });
    res.json({
      success: true,
      message: 'Booking cancelled successfully. Unit inventory has been freed up.',
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ==========================================================================
   ADMIN AUTHENTICATION & MANAGEMENT API ROUTES
   ========================================================================== */

// Admin Authentication Middleware
function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (req.headers['x-admin-token'] || req.query.admin_token);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Admin authentication token required'
    });
  }

  const user = adminService.verifySession(token);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Session invalid or expired. Please login again.'
    });
  }

  req.adminUser = user;
  next();
}

// 9. Admin Login
app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const result = adminService.loginAdmin(username, password);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
});

// 10. Admin Logout
app.post('/api/admin/logout', (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.headers['x-admin-token'];
    adminService.logoutAdmin(token);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Admin Me (Session Verification)
app.get('/api/admin/me', adminAuthMiddleware, (req, res) => {
  res.json({ success: true, data: req.adminUser });
});

// 12. Admin Dashboard Stats
app.get('/api/admin/stats', adminAuthMiddleware, (req, res) => {
  try {
    const stats = adminService.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Admin Bookings Management
app.get('/api/admin/bookings', adminAuthMiddleware, (req, res) => {
  try {
    const result = adminService.getAdminBookings(req.query);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/admin/bookings/:id/status', adminAuthMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updated = adminService.updateBookingStatus(Number(id), status);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 14. Admin Accommodations Management
app.get('/api/admin/accommodations', adminAuthMiddleware, (req, res) => {
  try {
    const result = adminService.getAdminAccommodations();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/accommodations', adminAuthMiddleware, (req, res) => {
  try {
    const created = adminService.createAccommodation(req.body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/accommodations/:id', adminAuthMiddleware, (req, res) => {
  try {
    const updated = adminService.updateAccommodation(Number(req.params.id), req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/accommodations/:id', adminAuthMiddleware, (req, res) => {
  try {
    const result = adminService.deleteAccommodation(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 15. Admin Packages Management
app.get('/api/admin/packages', adminAuthMiddleware, (req, res) => {
  try {
    const result = adminService.getAdminPackages();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/packages', adminAuthMiddleware, (req, res) => {
  try {
    const created = adminService.createPackage(req.body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/packages/:id', adminAuthMiddleware, (req, res) => {
  try {
    const updated = adminService.updatePackage(Number(req.params.id), req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/packages/:id', adminAuthMiddleware, (req, res) => {
  try {
    const result = adminService.deletePackage(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 16. Admin Special Events Management
app.get('/api/admin/events', adminAuthMiddleware, (req, res) => {
  try {
    const result = adminService.getAdminEvents();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/events', adminAuthMiddleware, (req, res) => {
  try {
    const created = adminService.createEvent(req.body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/events/:id', adminAuthMiddleware, (req, res) => {
  try {
    const updated = adminService.updateEvent(Number(req.params.id), req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/events/:id', adminAuthMiddleware, (req, res) => {
  try {
    const result = adminService.deleteEvent(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 17. Admin Customers Management
app.get('/api/admin/customers', adminAuthMiddleware, (req, res) => {
  try {
    const customers = adminService.getAdminCustomers(req.query);
    res.json({ success: true, data: customers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/customers/:email/history', adminAuthMiddleware, (req, res) => {
  try {
    const history = adminService.getCustomerBookingHistory(req.params.email);
    res.json({ success: true, data: history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 18. Admin Availability Overview
app.get('/api/admin/availability-overview', adminAuthMiddleware, (req, res) => {
  try {
    const { start_date, num_days } = req.query;
    const overview = adminService.getAvailabilityOverview(start_date, Number(num_days || 14));
    res.json({ success: true, data: overview });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 19. Admin Finance Overview
app.get('/api/admin/finance', adminAuthMiddleware, (req, res) => {
  try {
    const finance = adminService.getFinanceOverview();
    res.json({ success: true, data: finance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 20. Update Refund Status
app.patch('/api/admin/bookings/:id/refund', adminAuthMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { refundStatus } = req.body;
    const updated = adminService.updateRefundStatus(Number(id), refundStatus);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

const PUBLIC_DIR = path.join(__dirname, 'public');

// Explicit Admin Portal route
app.get('/admin', (req, res) => {
  res.sendFile('admin.html', { root: PUBLIC_DIR });
});

// Fallback route for SPA client-side routing
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    if (req.path.startsWith('/admin')) {
      return res.sendFile('admin.html', { root: PUBLIC_DIR });
    }
    return res.sendFile('index.html', { root: PUBLIC_DIR });
  }
  next();
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Camp Sandrush server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
