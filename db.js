const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'camp_sandrush.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode & foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accommodations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      tagline TEXT,
      description TEXT NOT NULL,
      image_url TEXT,
      base_capacity INTEGER NOT NULL DEFAULT 2,
      max_capacity INTEGER NOT NULL DEFAULT 4,
      extra_guest_rate REAL NOT NULL DEFAULT 800,
      total_units INTEGER NOT NULL DEFAULT 6,
      weekday_rate REAL NOT NULL,
      weekend_rate REAL NOT NULL,
      special_event_rate REAL NOT NULL,
      amenities TEXT NOT NULL, -- JSON array
      features TEXT NOT NULL,  -- JSON array
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS special_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      tagline TEXT,
      description TEXT NOT NULL,
      start_date TEXT NOT NULL, -- YYYY-MM-DD
      end_date TEXT NOT NULL,   -- YYYY-MM-DD
      badge_text TEXT,
      price_multiplier REAL DEFAULT 1.0,
      included_highlights TEXT NOT NULL, -- JSON array
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      badge TEXT,
      description TEXT NOT NULL,
      per_person_rate REAL NOT NULL DEFAULT 0,
      flat_rate REAL NOT NULL DEFAULT 0,
      inclusions TEXT NOT NULL, -- JSON array
      popular INTEGER NOT NULL DEFAULT 0,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS add_ons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price REAL NOT NULL,
      charge_type TEXT NOT NULL, -- 'per_person', 'per_stay', 'per_night'
      icon TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_reference TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_city TEXT,
      check_in_date TEXT NOT NULL,
      check_out_date TEXT NOT NULL,
      num_adults INTEGER NOT NULL,
      num_children INTEGER NOT NULL DEFAULT 0,
      total_nights INTEGER NOT NULL,
      accommodation_id INTEGER NOT NULL,
      package_id INTEGER NOT NULL,
      stay_type_summary TEXT NOT NULL,
      night_breakdown_json TEXT NOT NULL,
      base_accommodation_amount REAL NOT NULL,
      extra_guests_amount REAL NOT NULL DEFAULT 0,
      package_amount REAL NOT NULL DEFAULT 0,
      add_ons_amount REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL,
      total_amount REAL NOT NULL,
      special_requests TEXT,
      booking_status TEXT NOT NULL DEFAULT 'CONFIRMED',
      payment_status TEXT NOT NULL DEFAULT 'CONFIRMED_ONLINE',
      created_at TEXT NOT NULL,
      FOREIGN KEY (accommodation_id) REFERENCES accommodations(id),
      FOREIGN KEY (package_id) REFERENCES packages(id)
    );

    CREATE TABLE IF NOT EXISTS booking_add_ons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      add_on_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
      FOREIGN KEY (add_on_id) REFERENCES add_ons(id)
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );
  `);

  seedInitialData();
  seedAdminUser();
  migrateBookingsTable();
}

function migrateBookingsTable() {
  const columns = db.prepare("PRAGMA table_info(bookings)").all().map(c => c.name);
  const addCol = (name, type, defaultVal) => {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${type} DEFAULT ${defaultVal};`);
    }
  };

  addCol('payment_method', 'TEXT', "'DEMO_UPI'");
  addCol('transaction_id', 'TEXT', "NULL");
  addCol('cancellation_reason', 'TEXT', "NULL");
  addCol('cancelled_at', 'TEXT', "NULL");
  addCol('refund_amount', 'REAL', "0");
  addCol('refund_percentage', 'INTEGER', "0");
  addCol('refund_status', 'TEXT', "'NOT_APPLICABLE'");
}

function seedInitialData() {
  // Check if accommodations already seeded
  const existingAcc = db.prepare('SELECT count(*) as count FROM accommodations').get();
  if (existingAcc.count > 0) return;

  // 1. Seed Accommodations
  const insertAcc = db.prepare(`
    INSERT INTO accommodations (
      slug, name, tagline, description, image_url,
      base_capacity, max_capacity, extra_guest_rate, total_units,
      weekday_rate, weekend_rate, special_event_rate,
      amenities, features, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const accommodations = [
    {
      slug: 'luxury-glamping-dome',
      name: 'Luxury Stargazing Dome',
      tagline: 'Panoramic geodesic dome with skylight stargazing & beachside private deck',
      description: 'Experience pure coastal opulence inside our climate-controlled geodesic dome. Featuring a king-size bed, bohemian decor, personal telescope, plush ensuite bathroom, and an oceanfront wooden veranda.',
      image_url: 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?auto=format&fit=crop&w=800&q=80',
      base_capacity: 2,
      max_capacity: 4,
      extra_guest_rate: 999,
      total_units: 6,
      weekday_rate: 3499,
      weekend_rate: 4999,
      special_event_rate: 6499,
      amenities: JSON.stringify(['Air Conditioning', 'King Plush Bed', 'Ensuite Bathroom & Hot Shower', 'Private Stargazing Deck', 'Mini Refrigerator', 'Complimentary High-speed Wi-Fi', 'Artisanal Tea/Coffee Maker']),
      features: JSON.stringify(['100m to Shoreline', 'Skylight View', 'Electricity 24/7', 'Private Dining Space']),
      sort_order: 1
    },
    {
      slug: 'oceanfront-wooden-chalet',
      name: 'Oceanfront Wooden Chalet',
      tagline: 'Rustic teakwood villa with expansive ocean balcony & direct sandy pathway',
      description: 'Wake up to the rhythm of rolling waves in our handcrafted wood chalet. Features hand-carved furniture, sprawling bay windows, dual vanities, open sky shower, and private hammock garden.',
      image_url: 'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=800&q=80',
      base_capacity: 2,
      max_capacity: 4,
      extra_guest_rate: 1199,
      total_units: 4,
      weekday_rate: 4999,
      weekend_rate: 6999,
      special_event_rate: 8999,
      amenities: JSON.stringify(['Climate Control AC', 'Super King Bed', 'Open-Sky Rain Shower', 'Private Patio with Hammock', 'In-room Bluetooth Speaker', 'Gourmet Mini-bar', 'Electric Kettle']),
      features: JSON.stringify(['Direct Beach Access', 'Panoramic Sunset View', 'Dedicated Butler Service']),
      sort_order: 2
    },
    {
      slug: 'sunset-safari-tent',
      name: 'Sunset Bohemian Safari Tent',
      tagline: 'Elevated luxury safari tent with boho chic ambiance and teak deck',
      description: 'Perched on stilts under coconut palms, our Safari Tents blend adventure with comfort. Featuring woven cane furniture, queen size mattress, air cooler, and breezy shaded terrace.',
      image_url: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?auto=format&fit=crop&w=800&q=80',
      base_capacity: 2,
      max_capacity: 3,
      extra_guest_rate: 799,
      total_units: 8,
      weekday_rate: 2499,
      weekend_rate: 3799,
      special_event_rate: 4999,
      amenities: JSON.stringify(['Air Cooler & Ceiling Fan', 'Queen Size Spring Bed', 'Private Attached Washroom', 'Private Balcony', 'Reading Lamps', 'Charging Ports']),
      features: JSON.stringify(['Elevated Platform', 'Palm Grove Shade', 'Lush Garden Pathway']),
      sort_order: 3
    },
    {
      slug: 'standard-cozy-beach-tent',
      name: 'Standard Cozy Beach Tent',
      tagline: 'Authentic beachside waterproof tent pitched right on soft sands',
      description: 'For genuine camping enthusiasts who want to sleep closest to the waves. Premium double-layered all-weather Swiss canvas tent with foam mattresses, soft beddings, and warm fairy lights.',
      image_url: 'https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&w=800&q=80',
      base_capacity: 2,
      max_capacity: 3,
      extra_guest_rate: 599,
      total_units: 12,
      weekday_rate: 1499,
      weekend_rate: 2199,
      special_event_rate: 2999,
      amenities: JSON.stringify(['Thick Foam Mattresses', 'Fresh Linens & Pillows', 'Cozy Fairy Lights & Lantern', 'Access to Modern Clean Bathhouses', 'Phone Charging Hub']),
      features: JSON.stringify(['Pitch Right on Sand', 'Bonfire Ring Access', 'True Camping Vibe']),
      sort_order: 4
    },
    {
      slug: 'family-coastal-cabana',
      name: 'Family Coastal Cabana',
      tagline: 'Spacious two-bedroom retreat ideal for families and group vacations',
      description: 'Designed for families and groups of friends. Offers two queen beds, expansive living lounge, private lawn with double hammocks, dual air conditioning, and plenty of space for beach games.',
      image_url: 'https://images.unsplash.com/photo-1587061949409-02df41d5e562?auto=format&fit=crop&w=800&q=80',
      base_capacity: 4,
      max_capacity: 6,
      extra_guest_rate: 899,
      total_units: 4,
      weekday_rate: 5999,
      weekend_rate: 7999,
      special_event_rate: 9999,
      amenities: JSON.stringify(['Dual Inverter ACs', '2 Queen Beds + Sofa Bed', 'Large Ensuite Bathroom', 'Private Fenced Lawn', 'Outdoor Dining Table', 'Smart TV with Streaming', 'Board Games Set']),
      features: JSON.stringify(['Accommodates up to 6', 'Family Friendly', 'Private Lawn BBQ Setup']),
      sort_order: 5
    }
  ];

  for (const acc of accommodations) {
    insertAcc.run(
      acc.slug, acc.name, acc.tagline, acc.description, acc.image_url,
      acc.base_capacity, acc.max_capacity, acc.extra_guest_rate, acc.total_units,
      acc.weekday_rate, acc.weekend_rate, acc.special_event_rate,
      acc.amenities, acc.features, acc.sort_order
    );
  }

  // 2. Seed Special Events
  const insertEvent = db.prepare(`
    INSERT INTO special_events (
      slug, name, tagline, description, start_date, end_date,
      badge_text, price_multiplier, included_highlights, image_url, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const events = [
    {
      slug: 'autumn-equinox-chillout',
      name: 'Autumn Equinox Beach Chillout',
      tagline: 'Golden hour acoustic jam, beach lantern walk & barbecue night',
      description: 'Celebrate the welcoming ocean breeze with serene beach vibes, acoustic singer-songwriters under the fairy lights, open air barbecue bar, and barefoot beach stargazing.',
      start_date: '2026-09-25',
      end_date: '2026-09-28',
      badge_text: 'Live Happening Now',
      price_multiplier: 1.0,
      included_highlights: JSON.stringify(['Acoustic Live Music Session', 'Sunset Drum Circle', 'Floating Lanterns Ceremony', 'Complimentary Midnight Hot Cocoa']),
      image_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
      is_active: 1
    },
    {
      slug: 'sunset-solstice-fest',
      name: 'Sunset Solstice Beach Fest',
      tagline: 'Vibrant indie music, sunset DJ sessions, seaside flea market & craft cocktails',
      description: 'A 3-day beach festival showcasing indie artists, oceanfront yoga sessions at dawn, sunset chill-out DJ sets, beach volleyball tournaments, and artisanal coastal culinary stalls.',
      start_date: '2026-10-09',
      end_date: '2026-10-12',
      badge_text: 'Top Rated Festival',
      price_multiplier: 1.0,
      included_highlights: JSON.stringify(['All-Access Festival Pass', 'Sunset DJ Sundowner', 'Morning Beach Yoga & Meditation', 'Festival Welcome Swag Bag']),
      image_url: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=800&q=80',
      is_active: 1
    },
    {
      slug: 'diwali-lights-carnival',
      name: 'Diwali Lights & Waves Carnival',
      tagline: 'Eco-friendly beach illuminations, live folk fusion & grand festive banquet',
      description: 'Experience Diwali by the Arabian Sea! 1000+ clay diyas along the shore, live percussion fusion bands, sparkling sky lanterns, festive sweets bar, and a lavish coastal festive banquet.',
      start_date: '2026-11-06',
      end_date: '2026-11-09',
      badge_text: 'Grand Festive Celebration',
      price_multiplier: 1.0,
      included_highlights: JSON.stringify(['Grand Festive Beach Buffet', 'Diyas & Shore Lantern Lighting', 'Live Folk Fusion Band', 'Special Festive Gift Hamper']),
      image_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
      is_active: 1
    },
    {
      slug: 'super-full-moon-camp',
      name: 'Super Full Moon Acoustic Night',
      tagline: 'Telescope astrophotography, meditative waves, and midnight campfire stories',
      description: 'A magical night illuminated by the luminous super full moon reflecting over tranquil tides. Professional astronomy telescopes set up on the sand, soulful acoustic strings, and midnight s’mores.',
      start_date: '2026-11-20',
      end_date: '2026-11-23',
      badge_text: 'Limited Astro Night',
      price_multiplier: 1.0,
      included_highlights: JSON.stringify(['Astronomical Telescope Session', 'Moonlit Kayaking at High Tide', 'Campfire S\'mores & Acoustic Jam', 'Astrophotography Souvenir Photo']),
      image_url: 'https://images.unsplash.com/photo-1532767153582-b1a0e5145009?auto=format&fit=crop&w=800&q=80',
      is_active: 1
    },
    {
      slug: 'new-year-beach-gala',
      name: 'New Year Beach Rave & Starlight Gala',
      tagline: 'Ring in the New Year on the golden sands with international DJs & fireworks',
      description: 'The ultimate beach celebration to welcome the New Year. Non-stop live performances, countdown fireworks reflecting over the water, unlimited gourmet buffet, and sunrise breakfast by the ocean.',
      start_date: '2026-12-30',
      end_date: '2027-01-02',
      badge_text: 'Signature Mega Event',
      price_multiplier: 1.0,
      included_highlights: JSON.stringify(['Gala Dinner Buffet & Barbecue', 'Midnight Fireworks Extravaganza', 'Top DJ Live Performances', 'Champagne Toast at Midnight', 'Hangover Recovery Sunrise Breakfast']),
      image_url: 'https://images.unsplash.com/photo-1467810563316-b5476525c0f9?auto=format&fit=crop&w=800&q=80',
      is_active: 1
    }
  ];

  for (const ev of events) {
    insertEvent.run(
      ev.slug, ev.name, ev.tagline, ev.description,
      ev.start_date, ev.end_date, ev.badge_text,
      ev.price_multiplier, ev.included_highlights, ev.image_url, ev.is_active
    );
  }

  // 3. Seed Packages
  const insertPkg = db.prepare(`
    INSERT INTO packages (
      slug, name, badge, description, per_person_rate, flat_rate, inclusions, popular, image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const packages = [
    {
      slug: 'classic-beach-camp',
      name: 'Classic Beach Escape',
      badge: 'Essential',
      description: 'The quintessential beach camping experience. Simple, relaxed, and loaded with coastal hospitality.',
      per_person_rate: 0, // Included in accommodation base
      flat_rate: 0,
      inclusions: JSON.stringify([
        'Fresh Coconut Welcome Drink',
        'Hearty Breakfast Buffet (Indian & Continental)',
        'Evening High Tea with Coastal Snacks',
        'Beach Volleyball, Frisbee & Cricket Gear',
        'Community Campfire with Music'
      ]),
      popular: 0,
      image_url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=600&q=80'
    },
    {
      slug: 'sundowner-bbq-feast',
      name: 'Sundowner & BBQ Feast',
      badge: 'Most Popular',
      description: 'For foodies and music lovers. Savor live smoky beach barbecue under fairy lights with acoustic tunes.',
      per_person_rate: 899,
      flat_rate: 0,
      inclusions: JSON.stringify([
        'All Classic Escape Amenities Included',
        'Live Beachside BBQ Station (Veg & Non-Veg Skewers & Marinades)',
        'Gourmet Coastal Dinner Buffet (Seafood / Paneer Specialties)',
        'Marshmallow Roasting Pack for Bonfire',
        'Reserved Priority Seating at Acoustic Jam'
      ]),
      popular: 1,
      image_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80'
    },
    {
      slug: 'thrills-waves-adventure',
      name: 'Thrills & Waves Water Adventure',
      badge: 'Adrenaline Rush',
      description: 'Get your heart pumping with exhilarating watersports and guided sea kayaking along the coast.',
      per_person_rate: 1499,
      flat_rate: 0,
      inclusions: JSON.stringify([
        'All Classic Escape Amenities Included',
        'Jet Ski Ride with Certified Marine Instructor',
        'Banana Boat & Bumper Wave Ride',
        'Sunrise Guided Sea Kayaking Session',
        'Action Video Clip & Life Jackets Included'
      ]),
      popular: 0,
      image_url: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80'
    },
    {
      slug: 'romantic-starlit-date',
      name: 'Romantic Starlit Rendezvous',
      badge: 'Couples Favorite',
      description: 'An enchanting beachside candlelit dining experience crafted specially for couples.',
      per_person_rate: 0,
      flat_rate: 2299, // Flat couple rate
      inclusions: JSON.stringify([
        'All Classic Escape Amenities Included',
        'Private Cabana Candlelit Dining Table right on the sand',
        '4-Course Chef Curated Candlelight Dinner',
        'Bottle of Sparkling Juice / House Wine (or Mocktail Pitcher)',
        'Bouquet of Fresh Flowers & Heart-shaped Beach Cake',
        'Private Starlight Telescope Observation'
      ]),
      popular: 0,
      image_url: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=600&q=80'
    },
    {
      slug: 'festival-all-access-pass',
      name: 'All-Access Beach Party Pass',
      badge: 'Party Vibe',
      description: 'Full festival and nightlife immersion. Live DJ sets, cocktail tokens, and late-night grill station.',
      per_person_rate: 1299,
      flat_rate: 0,
      inclusions: JSON.stringify([
        'All Classic Escape Amenities Included',
        'VIP Entry to Live DJ & Band Stage',
        '2 Craft Cocktail / Beverage Tokens',
        'Midnight Munchies & Sliders Bar',
        'Neon Beach Glow Kit & Party Merchandise'
      ]),
      popular: 0,
      image_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80'
    }
  ];

  for (const pkg of packages) {
    insertPkg.run(
      pkg.slug, pkg.name, pkg.badge, pkg.description,
      pkg.per_person_rate, pkg.flat_rate, pkg.inclusions,
      pkg.popular, pkg.image_url
    );
  }

  // 4. Seed Add-ons
  const insertAddon = db.prepare(`
    INSERT INTO add_ons (
      slug, name, description, price, charge_type, icon
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const addOns = [
    {
      slug: 'scuba-diving-intro',
      name: 'Introductory Scuba Diving Experience',
      description: 'Discover underwater coral reef and marine life with a PADI divemaster. Includes gear & video.',
      price: 1899,
      charge_type: 'per_person',
      icon: 'waves'
    },
    {
      slug: 'beach-cruiser-bicycle',
      name: 'Beach Cruiser Bicycle (All-day Rental)',
      description: 'Cruise along the golden shorelines and explore the coconut groves and coastal fishing hamlets.',
      price: 350,
      charge_type: 'per_stay',
      icon: 'bike'
    },
    {
      slug: 'late-checkout-3pm',
      name: 'Lazy Late Checkout (Until 3:00 PM)',
      description: 'Extend your relaxation. Sleep in and enjoy the beach for an extra 4 hours.',
      price: 800,
      charge_type: 'per_stay',
      icon: 'clock'
    },
    {
      slug: 'celebration-cake-decor',
      name: 'Beach Birthday / Anniversary Cake & Fairy Decor',
      description: 'Surprise your companion with a fresh Dutch chocolate cake, candles, and fairy-lit tent canopy.',
      price: 750,
      charge_type: 'per_stay',
      icon: 'gift'
    },
    {
      slug: 'astrophotography-portrait',
      name: 'Milky Way & Night Sky Photo Shoot',
      description: 'Professional high-resolution portraits of you under the starry galaxy with long-exposure gear.',
      price: 999,
      charge_type: 'per_stay',
      icon: 'camera'
    }
  ];

  for (const ao of addOns) {
    insertAddon.run(
      ao.slug, ao.name, ao.description, ao.price, ao.charge_type, ao.icon
    );
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  try {
    const check = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch (e) {
    return false;
  }
}

function seedAdminUser() {
  const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'sandrush2026!';
    const { hash, salt } = hashPassword(defaultPassword);
    db.prepare(`
      INSERT INTO admin_users (username, password_hash, salt, role, created_at)
      VALUES (?, ?, ?, 'ADMIN', ?)
    `).run('admin', hash, salt, new Date().toISOString());
  }
}

// Initialize tables and seed data upon loading
initSchema();

module.exports = {
  db,
  initSchema,
  hashPassword,
  verifyPassword
};
