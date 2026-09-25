# Camp Sandrush — Coastal Camping & Glamping Resort

A full-stack customer booking platform and SQLite database for **Camp Sandrush**, featuring dynamic pricing for **weekdays**, **weekends**, and **special-events**, real-time unit availability, experience packages, custom add-ons, atomic booking creation, and printable booking confirmation vouchers.

---

## 🌟 Key Features

1. **Dynamic Stay & Pricing Engine**:
   - **Weekday Calm (Mon - Thu)**: Serene, uncrowded beach experience at value rates.
   - **Weekend Vibe (Fri - Sun)**: Acoustic music, bonfires, beach barbecues, and weekend rates.
   - **Special Events & Festivals**: Curated date spans (e.g. *Autumn Equinox Chillout*, *Sunset Solstice Beach Fest*, *Diwali Lights Carnival*, *New Year Beach Gala*) with special event tariffs and festival inclusions.
   - **Mixed Stay Support**: Automatically calculates itemized night-by-night rates when a reservation spans weekdays, weekends, and event dates.

2. **Accommodation Options**:
   - **Luxury Stargazing Dome**: Climate-controlled geodesic dome with skylight roof & private deck.
   - **Oceanfront Wooden Chalet**: Teakwood villa with panoramic beach balcony & direct shore access.
   - **Sunset Bohemian Safari Tent**: Elevated safari tent with bohemian decor & private veranda.
   - **Standard Cozy Beach Tent**: Double-layered waterproof Swiss tent pitched directly on the sand.
   - **Family Coastal Cabana**: Two-bedroom retreat for families/groups up to 6 guests.

3. **Curated Experience Packages**:
   - **Classic Beach Escape**: Included with every stay (Welcome coconut drink, buffet breakfast, evening tea/snacks, campfire, volleyball & games).
   - **Sundowner & BBQ Feast**: Live beachfront barbecue grill station + chef's dinner buffet + marshmallow roasting.
   - **Thrills & Waves Adventure**: Jet ski ride + banana boat ride + guided sunrise sea kayaking.
   - **Romantic Starlit Rendezvous**: Private candlelit dining table on the sand + 4-course dinner + wine/mocktail + star telescope session.
   - **All-Access Beach Party Pass**: VIP stage entry + DJ sets + 2 cocktail tokens + midnight snack bar.

4. **Real-time Inventory & Date Availability**:
   - Checks booked units across any selected date range against total unit capacity for each accommodation.
   - Live availability status tags (*Available*, *Only X Left!*, *Sold Out*).
   - Atomic reservation transactions to strictly prevent double-booking or overbooking.

5. **Customer Booking Wizard & Live Transparency**:
   - Date pickers with quick preset buttons (*This Weekend*, *Weekday Calm*, *Special Events*).
   - Guest count selector with capacity checks and extra guest fee calculations.
   - Custom add-on toggles (Scuba intro, Beach cruiser bicycles, Late checkout, Anniversary cake, Astrophotography).
   - Live Order Summary sidebar displaying night-by-night breakdown, subtotal, 12% GST, and total amount payable.

6. **Booking Confirmation & Self-Service Lookup**:
   - Generates memorable references: `CSR-2026-XXXXX`.
   - Dedicated confirmation voucher (`/confirmation.html?ref=...`) with printable view (`@media print`).
   - Self-service booking lookup page (`/my-booking.html`) where guests can enter their reference ID anytime to view their confirmed reservation.

---

## 📂 Project Architecture

```
camp-sandrush/
├── package.json               # Dependencies and scripts (express, cors)
├── server.js                  # Express REST API & static file server
├── db.js                      # node:sqlite database, schema initialization & seed data
├── services/
│   ├── pricingService.js      # Weekday/weekend/special event classification & pricing engine
│   └── bookingService.js      # Inventory tracking, atomic booking creation & lookup
├── public/                    # Customer frontend website
│   ├── index.html             # Landing page, accommodations showcase, booking wizard
│   ├── confirmation.html      # Confirmation voucher with itemized receipt & print view
│   ├── my-booking.html        # Booking lookup portal
│   ├── css/
│   │   └── style.css          # Theme styling, badges, glassmorphism, print rules
│   └── js/
│       └── app.js             # Client state, dynamic preview calculation, booking submission
└── test/
    ├── pricing.test.js        # Unit tests for pricing logic & capacity limits
    ├── availability_and_booking.test.js # Overbooking prevention & unit decrementing tests
    └── e2e_api.test.js        # End-to-end HTTP API and static serving tests
```

---

## 🗄️ Database Schema

The database uses Node 24's built-in `node:sqlite` (stored at `camp_sandrush.db`):

- `accommodations`: id, slug, name, tagline, description, image_url, base_capacity, max_capacity, extra_guest_rate, total_units, weekday_rate, weekend_rate, special_event_rate, amenities (JSON), features (JSON).
- `special_events`: id, slug, name, tagline, description, start_date, end_date, badge_text, price_multiplier, included_highlights (JSON), image_url, is_active.
- `packages`: id, slug, name, badge, description, per_person_rate, flat_rate, inclusions (JSON), popular, image_url.
- `add_ons`: id, slug, name, description, price, charge_type, icon.
- `bookings`: id, booking_reference, customer_name, customer_email, customer_phone, customer_city, check_in_date, check_out_date, num_adults, num_children, total_nights, accommodation_id, package_id, stay_type_summary, night_breakdown_json, base_accommodation_amount, extra_guests_amount, package_amount, add_ons_amount, subtotal, tax_amount, total_amount, special_requests, booking_status, payment_status, created_at.
- `booking_add_ons`: id, booking_id, add_on_id, quantity, unit_price, total_price.

---

## 🚀 Running the Project

### Prerequisites
- Node.js v22.5+ or v24+ (uses built-in `node:sqlite`)
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Run All Automated Tests
```bash
npm test
```
7. **Protected Admin Management Console (`/admin`)**:
   - **Secure Authentication**: Token-based authentication with Scrypt password hashing (`admin` / `sandrush2026!`).
   - **KPI Summary Cards**: Real-time Gross Revenue, Total Bookings, In-Camp Stays Today, Upcoming 7-day Check-ins, and Camp Capacity.
   - **Bookings Management**: Filter by status (`CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`), search by guest name/email/phone/reference, check-in guests, check-out guests, and cancellation with instant inventory release.
   - **Accommodations CRUD**: Edit weekday/weekend/event tariffs, adjust total units, capacity thresholds, descriptions, and amenities.
   - **Packages CRUD**: Manage per-person and flat package tariffs, inclusions, and popular badges.
   - **Special Events Management**: Schedule new festivals, configure dates, price multipliers, and toggle active status.
   - **Customer Directory**: Unified customer profiles aggregated across bookings with lifetime spend and reservation history.
   - **Availability & Occupancy Matrix**: Day-by-day camp occupancy inspector showing booked vs total units and the exact guests occupying each accommodation.

---

## 📂 Project Architecture

```
camp-sandrush/
├── package.json               # Dependencies and scripts (express, cors)
├── server.js                  # Express REST API, Admin API & static file server
├── db.js                      # node:sqlite database, schema initialization & seed data
├── services/
│   ├── pricingService.js      # Weekday/weekend/special event classification & pricing engine
│   ├── bookingService.js      # Inventory tracking, atomic booking creation & lookup
│   └── adminService.js        # Admin authentication, stats, CRUD, customers & occupancy matrix
├── public/                    # Frontend client files
│   ├── index.html             # Customer landing page & booking wizard
│   ├── admin.html             # Protected Admin Management Console
│   ├── confirmation.html      # Confirmation voucher with itemized receipt & print view
│   ├── my-booking.html        # Booking lookup portal
│   ├── css/
│   │   └── style.css          # Theme styling, badges, glassmorphism, print rules
│   └── js/
│       ├── app.js             # Customer application controller
│       └── admin.js           # Admin portal controller
└── test/
    ├── pricing.test.js        # Unit tests for pricing logic & capacity limits
    ├── availability_and_booking.test.js # Overbooking prevention & unit decrementing tests
    ├── e2e_api.test.js        # End-to-end HTTP API and customer workflow tests
    └── admin.test.js          # Admin authentication, CRUD, and status transition tests
```

---

## 🗄️ Database Schema

The database uses Node 24's built-in `node:sqlite` (stored at `camp_sandrush.db`):

- `admin_users`: id, username, password_hash, salt, role, created_at.
- `admin_sessions`: token, user_id, created_at, expires_at.
- `accommodations`: id, slug, name, tagline, description, image_url, base_capacity, max_capacity, extra_guest_rate, total_units, weekday_rate, weekend_rate, special_event_rate, amenities (JSON), features (JSON).
- `special_events`: id, slug, name, tagline, description, start_date, end_date, badge_text, price_multiplier, included_highlights (JSON), image_url, is_active.
- `packages`: id, slug, name, badge, description, per_person_rate, flat_rate, inclusions (JSON), popular, image_url.
- `add_ons`: id, slug, name, description, price, charge_type, icon.
- `bookings`: id, booking_reference, customer_name, customer_email, customer_phone, customer_city, check_in_date, check_out_date, num_adults, num_children, total_nights, accommodation_id, package_id, stay_type_summary, night_breakdown_json, base_accommodation_amount, extra_guests_amount, package_amount, add_ons_amount, subtotal, tax_amount, total_amount, special_requests, booking_status, payment_status, created_at.
- `booking_add_ons`: id, booking_id, add_on_id, quantity, unit_price, total_price.

---

## 🚀 Running the Project

### Prerequisites
- Node.js v22.5+ or v24+ (uses built-in `node:sqlite`)
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Run All Automated Tests
```bash
npm test
```
Runs:
- `test/pricing.test.js`: Validates weekday, weekend, special event, mixed stay, extra guest, package, and add-on pricing rules.
- `test/availability_and_booking.test.js`: Validates real-time unit counting, overbooking rejection, and reference generation.
- `test/e2e_api.test.js`: Validates all HTTP API routes and static asset serving.
- `test/admin.test.js`: Validates admin authentication, session tokens, booking status transitions, inventory release on cancellation, accommodations/packages/events CRUD, and availability overview.

### 3. Start the Web Server
```bash
npm start
```
Open in your browser:
- **Customer Website & Booking Wizard**: [http://localhost:3000/](http://localhost:3000/)
- **Admin Management Console**: [http://localhost:3000/admin](http://localhost:3000/admin)
  - **Username**: `admin`
  - **Password**: `sandrush2026!`
- **Booking Lookup Portal**: [http://localhost:3000/my-booking.html](http://localhost:3000/my-booking.html)
- **Confirmation Voucher View**: [http://localhost:3000/confirmation.html?ref=CSR-2026-XXXXX](http://localhost:3000/confirmation.html?ref=CSR-2026-XXXXX)

