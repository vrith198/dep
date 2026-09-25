// Camp Sandrush Admin Application
const adminState = {
  token: localStorage.getItem('sandrush_admin_token') || null,
  currentUser: null,
  activeTab: 'overview',
  stats: null,
  bookings: [],
  bookingFilter: 'ALL',
  bookingSearch: '',
  accommodations: [],
  packages: [],
  events: [],
  customers: [],
  availabilityOverview: null,
  finance: null,
  financeFilter: 'ALL'
};

// Currency formatter
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount || 0);
}

// Date formatter
function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Authenticated Fetch Helper
async function authFetch(url, options = {}) {
  const headers = options.headers || {};
  if (adminState.token) {
    headers['Authorization'] = `Bearer ${adminState.token}`;
  }
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Unauthorized');
  }
  return res.json();
}

function handleUnauthorized() {
  localStorage.removeItem('sandrush_admin_token');
  adminState.token = null;
  adminState.currentUser = null;
  document.getElementById('loginGate').classList.remove('hidden');
  document.getElementById('adminPortal').classList.add('hidden');
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  setupLoginHandler();

  if (adminState.token) {
    try {
      const meRes = await authFetch('/api/admin/me');
      if (meRes.success && meRes.data) {
        adminState.currentUser = meRes.data;
        showAdminPortal();
      } else {
        handleUnauthorized();
      }
    } catch (e) {
      handleUnauthorized();
    }
  } else {
    document.getElementById('loginGate').classList.remove('hidden');
  }
});

// Setup Login Handler
function setupLoginHandler() {
  const form = document.getElementById('adminLoginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errBox = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    errBox.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = 'Verifying credentials...';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (data.success && data.data) {
        adminState.token = data.data.token;
        adminState.currentUser = data.data.user;
        localStorage.setItem('sandrush_admin_token', adminState.token);
        showAdminPortal();
      } else {
        errBox.textContent = data.error || 'Invalid credentials';
        errBox.classList.remove('hidden');
      }
    } catch (err) {
      errBox.textContent = 'Server connection error. Please try again.';
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>Authenticate & Open Console</span> <span>→</span>';
    }
  });
}

function handleLogout() {
  if (adminState.token) {
    fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminState.token}` }
    }).catch(() => {});
  }
  handleUnauthorized();
}

function showAdminPortal() {
  document.getElementById('loginGate').classList.add('hidden');
  document.getElementById('adminPortal').classList.remove('hidden');
  document.getElementById('adminUsernameBadge').textContent = adminState.currentUser ? adminState.currentUser.username : 'Admin';

  // Set default availability start date to today
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('availStartDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = today;
  }

  loadDashboardStats();
  loadBookings();
}

// Tab Switching
window.switchTab = function(tabName) {
  adminState.activeTab = tabName;

  // Update tab buttons
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.className = 'admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-600 hover:bg-slate-100';
  });
  const activeBtn = document.getElementById(`tab_${tabName}`);
  if (activeBtn) {
    activeBtn.className = 'admin-tab-btn px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-teal-600 text-white shadow-sm';
  }

  // Update views
  document.querySelectorAll('.admin-view').forEach(view => view.classList.add('hidden'));
  const activeView = document.getElementById(`view_${tabName}`);
  if (activeView) activeView.classList.remove('hidden');

  // Trigger data loads
  if (tabName === 'overview') loadDashboardStats();
  if (tabName === 'bookings') loadBookings();
  if (tabName === 'availability') loadAvailabilityOverview();
  if (tabName === 'accommodations') loadAccommodations();
  if (tabName === 'packages') loadPackages();
  if (tabName === 'events') loadEvents();
  if (tabName === 'customers') loadCustomers();
  if (tabName === 'finance') loadFinanceOverview();
};

/* ==========================================================================
   1. DASHBOARD & KPIS
   ========================================================================== */
async function loadDashboardStats() {
  try {
    const res = await authFetch('/api/admin/stats');
    if (!res.success) return;
    const s = res.data;
    adminState.stats = s;

    document.getElementById('statRevenue').textContent = formatCurrency(s.totalRevenue);
    document.getElementById('statTotalBookings').textContent = s.totalBookings;
    document.getElementById('statConfirmedBadge').textContent = `${s.confirmedBookings} Confirmed Stays`;
    document.getElementById('statActiveToday').textContent = s.activeStaysToday;
    document.getElementById('statUpcomingCheckins').textContent = s.upcomingCheckins;

    const badge = document.getElementById('badgeBookingsCount');
    if (badge) badge.textContent = s.totalBookings;

    // Check pending refunds badge
    authFetch('/api/admin/finance').then(fRes => {
      if (fRes.success && fRes.data) {
        const pBadge = document.getElementById('badgePendingRefunds');
        if (pBadge) {
          if (fRes.data.pendingRefundsCount > 0) {
            pBadge.textContent = fRes.data.pendingRefundsCount;
            pBadge.classList.remove('hidden');
          } else {
            pBadge.classList.add('hidden');
          }
        }
      }
    }).catch(() => {});

    // Render Recent Bookings Table
    const tbody = document.getElementById('recentBookingsTbody');
    if (!tbody) return;

    if (!s.recentBookings || s.recentBookings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400">No customer bookings yet.</td></tr>';
      return;
    }

    tbody.innerHTML = s.recentBookings.map(b => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-mono font-bold text-teal-800">${b.booking_reference}</td>
        <td class="p-3">
          <span class="font-bold text-slate-900 block">${b.customer_name}</span>
          <span class="text-[11px] text-slate-400">${b.customer_phone}</span>
        </td>
        <td class="p-3">
          <span class="font-medium text-slate-700 block">${b.check_in_date} → ${b.check_out_date}</span>
          <span class="text-[10px] text-slate-400">${b.total_nights} Nights • ${b.stay_type_summary}</span>
        </td>
        <td class="p-3 font-medium text-slate-800">${b.accommodation_name}</td>
        <td class="p-3 font-bold text-slate-900">${formatCurrency(b.total_amount)}</td>
        <td class="p-3">${getStatusBadge(b.booking_status)}</td>
        <td class="p-3 text-right">
          <button onclick="viewBookingDetails('${b.booking_reference}')" class="px-2.5 py-1 text-teal-700 hover:bg-teal-50 rounded-lg font-bold">Details</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function getStatusBadge(status) {
  let color = 'bg-slate-100 text-slate-700 border-slate-200';
  if (status === 'CONFIRMED') color = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'CHECKED_IN') color = 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'CHECKED_OUT') color = 'bg-purple-50 text-purple-700 border-purple-200';
  if (status === 'CANCELLED') color = 'bg-rose-50 text-rose-700 border-rose-200';
  return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${color}">${status}</span>`;
}

/* ==========================================================================
   2. BOOKINGS MANAGEMENT
   ========================================================================== */
window.filterBookings = function(status) {
  adminState.bookingFilter = status;
  document.querySelectorAll('.booking-filter-btn').forEach(btn => {
    btn.className = 'booking-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200';
  });
  const activeBtn = document.getElementById(`filter_${status}`);
  if (activeBtn) activeBtn.className = 'booking-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-600 text-white';

  loadBookings();
};

let searchTimer = null;
window.handleBookingSearch = function(query) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    adminState.bookingSearch = query;
    loadBookings();
  }, 250);
};

async function loadBookings() {
  try {
    let url = `/api/admin/bookings?status=${adminState.bookingFilter}`;
    if (adminState.bookingSearch) url += `&search=${encodeURIComponent(adminState.bookingSearch)}`;

    const res = await authFetch(url);
    if (!res.success) return;

    adminState.bookings = res.data.bookings || [];
    const tbody = document.getElementById('bookingsTableBody');
    if (!tbody) return;

    if (adminState.bookings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400">No bookings match the selected criteria.</td></tr>';
      return;
    }

    tbody.innerHTML = adminState.bookings.map(b => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3.5 font-mono font-bold text-teal-800">${b.booking_reference}</td>
        <td class="p-3.5">
          <span class="font-bold text-slate-900 block">${b.customer_name}</span>
          <span class="text-[11px] text-slate-500">${b.customer_email} • ${b.customer_phone}</span>
        </td>
        <td class="p-3.5">
          <span class="font-semibold text-slate-800 block">${formatDisplayDate(b.check_in_date)} → ${formatDisplayDate(b.check_out_date)}</span>
          <span class="text-[10px] text-slate-400">${b.total_nights} Nights • ${b.num_adults} Adults${b.num_children ? `, ${b.num_children} Children` : ''}</span>
        </td>
        <td class="p-3.5">
          <span class="font-medium text-slate-900 block">${b.accommodation_name}</span>
          <span class="text-[10px] text-teal-700 font-semibold">${b.stay_type_summary}</span>
        </td>
        <td class="p-3.5 font-medium text-slate-700">${b.package_name}</td>
        <td class="p-3.5 font-black text-slate-900">${formatCurrency(b.total_amount)}</td>
        <td class="p-3.5">${getStatusBadge(b.booking_status)}</td>
        <td class="p-3.5 text-right whitespace-nowrap space-x-1">
          <button onclick="viewBookingDetails('${b.booking_reference}')" class="px-2.5 py-1 text-xs font-bold text-teal-700 hover:bg-teal-50 rounded-lg">View</button>
          ${b.booking_status === 'CONFIRMED' ? `
            <button onclick="changeBookingStatus(${b.id}, 'CHECKED_IN')" class="px-2 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg">Check-in</button>
            <button onclick="changeBookingStatus(${b.id}, 'CANCELLED')" class="px-2 py-1 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg">Cancel</button>
          ` : ''}
          ${b.booking_status === 'CHECKED_IN' ? `
            <button onclick="changeBookingStatus(${b.id}, 'CHECKED_OUT')" class="px-2 py-1 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg">Check-out</button>
          ` : ''}
          ${b.booking_status === 'CANCELLED' ? `
            <button onclick="changeBookingStatus(${b.id}, 'CONFIRMED')" class="px-2 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg">Re-confirm</button>
          ` : ''}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load bookings:', err);
  }
}

window.changeBookingStatus = async function(id, newStatus) {
  const confirmMsg = newStatus === 'CANCELLED'
    ? 'Are you sure you want to cancel this booking? The accommodation unit will be released back to public availability immediately.'
    : `Update booking status to ${newStatus}?`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await authFetch(`/api/admin/bookings/${id}/status`, {
      method: 'PATCH',
      body: { status: newStatus }
    });

    if (res.success) {
      loadBookings();
      loadDashboardStats();
      if (adminState.activeTab === 'availability') {
        loadAvailabilityOverview();
      }
    } else {
      alert(res.error || 'Failed to update status');
    }
  } catch (err) {
    alert('Error updating status');
  }
};

window.viewBookingDetails = async function(reference) {
  try {
    const res = await authFetch(`/api/admin/bookings/${reference}`);
    if (!res.success || !res.data) {
      alert('Booking details not found');
      return;
    }
    const b = res.data;
    const modal = document.getElementById('bookingModal');
    const content = document.getElementById('bookingModalContent');

    content.innerHTML = `
      <div class="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Booking Reference</span>
          <h3 class="text-xl font-black font-mono text-teal-800">${b.booking_reference}</h3>
        </div>
        <div class="flex items-center gap-3">
          ${getStatusBadge(b.booking_status)}
          <button onclick="closeModal('bookingModal')" class="text-slate-400 hover:text-slate-700 text-lg font-bold">✕</button>
        </div>
      </div>

      <div class="space-y-6 text-xs text-slate-700">
        <!-- Guest Details -->
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
          <span class="block font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-2">Guest Profile</span>
          <div class="grid grid-cols-2 gap-2">
            <div>Name: <strong class="text-slate-900">${b.customer_name}</strong></div>
            <div>Email: <strong class="text-slate-900">${b.customer_email}</strong></div>
            <div>Phone: <strong class="text-slate-900">${b.customer_phone}</strong></div>
            <div>City: <strong class="text-slate-900">${b.customer_city || 'Not provided'}</strong></div>
          </div>
        </div>

        <!-- Stay Details -->
        <div class="grid grid-cols-2 gap-4">
          <div class="p-4 bg-teal-50/50 rounded-xl border border-teal-100">
            <span class="block font-bold text-teal-900 uppercase text-[10px] tracking-wider mb-1">Accommodation</span>
            <h4 class="font-bold text-slate-900 text-sm">${b.accommodation_name}</h4>
            <span class="text-slate-500">${b.stay_type_summary} • ${b.total_nights} Nights</span>
          </div>

          <div class="p-4 bg-amber-50/50 rounded-xl border border-amber-100">
            <span class="block font-bold text-amber-900 uppercase text-[10px] tracking-wider mb-1">Package</span>
            <h4 class="font-bold text-slate-900 text-sm">${b.package_name}</h4>
            <span class="text-slate-500">${b.package_badge || 'Standard Package'}</span>
          </div>
        </div>

        <!-- Dates & Guests -->
        <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
          <div>Dates: <strong>${formatDisplayDate(b.check_in_date)}</strong> → <strong>${formatDisplayDate(b.check_out_date)}</strong></div>
          <div>Party: <strong>${b.num_adults} Adults${b.num_children ? `, ${b.num_children} Children` : ''}</strong></div>
        </div>

        <!-- Night Breakdown -->
        <div>
          <span class="block font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-2">Itemized Nightly Tariffs</span>
          <div class="border border-slate-200 rounded-xl overflow-hidden">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-100 text-slate-600 font-bold">
                <tr>
                  <th class="p-2.5">Date</th>
                  <th class="p-2.5">Tariff Class</th>
                  <th class="p-2.5 text-right">Night Rate</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${(b.night_breakdown || []).map(n => `
                  <tr>
                    <td class="p-2.5 font-medium">${formatDisplayDate(n.date)} (${n.dayName})</td>
                    <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] ${n.type === 'weekend' ? 'bg-blue-100 text-blue-800' : (n.type === 'special_event' ? 'bg-amber-100 text-amber-900 font-bold' : 'bg-emerald-100 text-emerald-800')}">${n.badgeText || n.type}</span></td>
                    <td class="p-2.5 text-right font-bold text-slate-900">${formatCurrency(n.rate)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Add-ons -->
        ${(b.add_ons && b.add_ons.length > 0) ? `
          <div>
            <span class="block font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-2">Selected Add-ons</span>
            <div class="space-y-1">
              ${b.add_ons.map(ao => `
                <div class="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                  <span>${ao.name} (Qty: ${ao.quantity})</span>
                  <strong>${formatCurrency(ao.total_price)}</strong>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Special Requests -->
        ${b.special_requests ? `
          <div>
            <span class="block font-bold text-slate-900 uppercase text-[10px] tracking-wider mb-1">Guest Special Request</span>
            <p class="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 italic">${b.special_requests}</p>
          </div>
        ` : ''}

        <!-- Financial Summary -->
        <div class="p-4 bg-slate-900 text-white rounded-xl space-y-1">
          <div class="flex justify-between text-slate-300">
            <span>Subtotal:</span>
            <span>${formatCurrency(b.subtotal)}</span>
          </div>
          <div class="flex justify-between text-slate-300">
            <span>Taxes & GST (12%):</span>
            <span>${formatCurrency(b.tax_amount)}</span>
          </div>
          <div class="flex justify-between text-base font-bold pt-2 border-t border-slate-700 text-emerald-400">
            <span>Total Tariff Paid:</span>
            <span>${formatCurrency(b.total_amount)}</span>
          </div>
          <div class="flex justify-between text-slate-400 text-[10px] pt-2 border-t border-slate-800">
            <span>Payment Method / Txn ID:</span>
            <span class="font-mono text-slate-300">${b.payment_method || 'DEMO_UPI'} • ${b.transaction_id || 'CSR-TXN'}</span>
          </div>
        </div>

        ${b.booking_status === 'CANCELLED' ? `
          <div class="p-4 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-900 space-y-1.5">
            <div class="font-bold flex items-center justify-between">
              <span>⚠️ Stay Cancelled ${b.cancelled_at ? `on ${b.cancelled_at.slice(0, 16)}` : ''}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-200 text-rose-900">${b.refund_status || 'NOT_APPLICABLE'}</span>
            </div>
            <div>Reason: <em>${b.cancellation_reason || 'Guest requested cancellation'}</em></div>
            <div class="flex justify-between pt-1 border-t border-rose-200 font-semibold">
              <span>Eligible Refund (${b.refund_percentage || 0}%):</span>
              <strong class="text-rose-950 font-bold">${formatCurrency(b.refund_amount || 0)}</strong>
            </div>
            ${b.refund_status === 'PENDING_REFUND' ? `
              <div class="pt-2 text-right">
                <button onclick="settleRefund(${b.id})" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs shadow-sm">
                  Mark Refund as Settled & Completed
                </button>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- Actions -->
        <div class="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <a href="/confirmation.html?ref=${b.booking_reference}" target="_blank" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl flex items-center gap-1.5">
            <span>Print Customer Voucher</span>
            <span>↗</span>
          </a>

          <div class="flex items-center gap-2">
            ${b.booking_status === 'CONFIRMED' ? `
              <button onclick="changeBookingStatus(${b.id}, 'CHECKED_IN'); closeModal('bookingModal');" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl">Check-in Guest</button>
              <button onclick="changeBookingStatus(${b.id}, 'CANCELLED'); closeModal('bookingModal');" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl">Cancel Reservation</button>
            ` : ''}
            ${b.booking_status === 'CHECKED_IN' ? `
              <button onclick="changeBookingStatus(${b.id}, 'CHECKED_OUT'); closeModal('bookingModal');" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl">Check-out Guest</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  } catch (err) {
    alert('Error loading booking details');
  }
};

/* ==========================================================================
   3. AVAILABILITY & OCCUPANCY MATRIX
   ========================================================================== */
window.loadAvailabilityOverview = async function() {
  const container = document.getElementById('availabilityOverviewContainer');
  if (!container) return;

  const startDate = document.getElementById('availStartDate')?.value || new Date().toISOString().split('T')[0];
  const numDays = document.getElementById('availDaysCount')?.value || 14;

  container.innerHTML = '<div class="text-center py-10 text-slate-400">Loading live availability matrix...</div>';

  try {
    const res = await authFetch(`/api/admin/availability-overview?start_date=${startDate}&num_days=${numDays}`);
    if (!res.success || !res.data) return;

    const data = res.data;
    adminState.availabilityOverview = data;

    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border border-slate-200 rounded-xl overflow-hidden">
          <thead class="bg-slate-900 text-white uppercase text-[10px] tracking-wider">
            <tr>
              <th class="p-3 border-r border-slate-700 min-w-[140px]">Date / Day</th>
              <th class="p-3 border-r border-slate-700">Category</th>
              ${data.accommodations.map(a => `
                <th class="p-3 text-center border-r border-slate-700 min-w-[150px]">
                  <span class="block font-bold">${a.name}</span>
                  <span class="text-[9px] text-slate-400 font-normal">Cap: ${a.total_units} Units</span>
                </th>
              `).join('')}
              <th class="p-3 text-center min-w-[110px]">Camp Occupancy</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            ${data.days.map(d => {
              const cat = d.dayClassification;
              let catBadge = 'bg-emerald-100 text-emerald-800';
              if (cat.type === 'weekend') catBadge = 'bg-blue-100 text-blue-800';
              if (cat.type === 'special_event') catBadge = 'bg-amber-100 text-amber-900 font-bold';

              let occBadge = 'text-emerald-700 bg-emerald-50';
              if (d.overallOccupancy > 60) occBadge = 'text-amber-700 bg-amber-50';
              if (d.overallOccupancy > 85) occBadge = 'text-rose-700 bg-rose-50 font-bold';

              return `
                <tr class="hover:bg-slate-50 transition">
                  <td class="p-3 border-r border-slate-200 font-bold text-slate-800">
                    <span>${formatDisplayDate(d.date)}</span>
                  </td>
                  <td class="p-3 border-r border-slate-200">
                    <span class="px-2 py-0.5 rounded text-[10px] ${catBadge}">
                      ${cat.badgeText || cat.type}
                    </span>
                  </td>
                  ${d.accommodations.map(acc => {
                    const isFull = acc.availableUnits === 0;
                    const isLow = acc.availableUnits <= 2 && !isFull;
                    let unitClass = 'text-emerald-700 bg-emerald-50 border-emerald-200';
                    if (isFull) unitClass = 'text-rose-700 bg-rose-50 border-rose-200 font-bold';
                    else if (isLow) unitClass = 'text-amber-700 bg-amber-50 border-amber-200 font-bold';

                    return `
                      <td class="p-3 text-center border-r border-slate-200">
                        <div class="inline-flex flex-col items-center">
                          <span class="px-2.5 py-1 rounded-lg text-xs border ${unitClass}">
                            ${acc.bookedUnits} / ${acc.totalUnits} Booked
                          </span>
                          <span class="text-[10px] text-slate-400 mt-0.5">
                            ${acc.availableUnits} free (${acc.occupancyPercent}%)
                          </span>
                          ${acc.bookings.length > 0 ? `
                            <button onclick="inspectDateBookings('${d.date}', '${acc.accommodationName.replace(/'/g, "\\'")}', ${JSON.stringify(acc.bookings).replace(/"/g, '&quot;')})" class="text-[10px] text-teal-700 underline font-semibold mt-1">
                              View ${acc.bookings.length} Guest${acc.bookings.length > 1 ? 's' : ''}
                            </button>
                          ` : ''}
                        </div>
                      </td>
                    `;
                  }).join('')}
                  <td class="p-3 text-center font-bold">
                    <span class="px-2 py-1 rounded-lg border ${occBadge}">${d.overallOccupancy}%</span>
                    <span class="block text-[10px] text-slate-400 mt-1">${d.totalCampBooked}/${d.totalCampUnits} Units</span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Failed to load availability overview:', err);
    container.innerHTML = '<div class="text-rose-600 text-center py-6">Failed to load availability matrix.</div>';
  }
};

window.inspectDateBookings = function(date, accName, bookings) {
  const modal = document.getElementById('bookingModal');
  const content = document.getElementById('bookingModalContent');

  content.innerHTML = `
    <div class="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
      <div>
        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Bookings on ${date}</span>
        <h3 class="text-lg font-bold text-slate-900">${accName}</h3>
      </div>
      <button onclick="closeModal('bookingModal')" class="text-slate-400 hover:text-slate-700 text-lg font-bold">✕</button>
    </div>

    <div class="space-y-3">
      ${bookings.map(b => `
        <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
          <div>
            <span class="font-mono font-bold text-teal-800">${b.booking_reference}</span>
            <h4 class="font-bold text-slate-900">${b.customer_name}</h4>
            <span class="text-slate-500">${b.customer_phone} • ${b.num_adults} Adults${b.num_children ? `, ${b.num_children} Children` : ''}</span>
          </div>
          <div class="text-right">
            ${getStatusBadge(b.booking_status)}
            <button onclick="closeModal('bookingModal'); viewBookingDetails('${b.booking_reference}');" class="block text-teal-700 font-bold hover:underline mt-2">
              Full Receipt →
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

/* ==========================================================================
   4. ACCOMMODATIONS MANAGEMENT
   ========================================================================== */
async function loadAccommodations() {
  try {
    const res = await authFetch('/api/admin/accommodations');
    if (!res.success) return;
    adminState.accommodations = res.data;
    const grid = document.getElementById('adminAccommodationsGrid');
    if (!grid) return;

    grid.innerHTML = adminState.accommodations.map(acc => `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
        <div>
          <div class="relative h-44 overflow-hidden">
            <img src="${acc.image_url}" alt="${acc.name}" class="w-full h-full object-cover" />
            <div class="absolute top-3 left-3 bg-night-900/80 backdrop-blur text-white text-[10px] font-bold px-2 py-0.5 rounded">
              Units: ${acc.total_units} Available
            </div>
            <div class="absolute top-3 right-3 bg-white/90 backdrop-blur text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded">
              Cap: ${acc.base_capacity}-${acc.max_capacity} Guests
            </div>
          </div>

          <div class="p-5">
            <h4 class="text-base font-bold text-slate-900">${acc.name}</h4>
            <p class="text-xs text-slate-500 mt-1 line-clamp-2">${acc.description}</p>

            <div class="grid grid-cols-3 gap-2 mt-4 text-center">
              <div class="p-2 bg-emerald-50 rounded-lg">
                <span class="block text-[9px] uppercase font-bold text-emerald-800">Weekday</span>
                <span class="text-xs font-black text-emerald-950">${formatCurrency(acc.weekday_rate)}</span>
              </div>
              <div class="p-2 bg-blue-50 rounded-lg">
                <span class="block text-[9px] uppercase font-bold text-blue-800">Weekend</span>
                <span class="text-xs font-black text-blue-950">${formatCurrency(acc.weekend_rate)}</span>
              </div>
              <div class="p-2 bg-amber-50 rounded-lg">
                <span class="block text-[9px] uppercase font-bold text-amber-800">Event</span>
                <span class="text-xs font-black text-amber-950">${formatCurrency(acc.special_event_rate)}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <span class="text-[11px] text-slate-500 font-medium">Extra guest: ${formatCurrency(acc.extra_guest_rate)}</span>
          <button onclick="openAccommodationModal(${acc.id})" class="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-lg shadow-sm">
            Edit Accommodation
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load accommodations:', err);
  }
}

window.openAccommodationModal = function(id) {
  const modal = document.getElementById('accEditModal');
  const title = document.getElementById('accModalTitle');
  const form = document.getElementById('accForm');

  if (id) {
    const acc = adminState.accommodations.find(a => a.id === id);
    if (!acc) return;
    title.textContent = `Edit Accommodation: ${acc.name}`;
    document.getElementById('accFormId').value = acc.id;
    document.getElementById('accFormName').value = acc.name;
    document.getElementById('accFormSlug').value = acc.slug;
    document.getElementById('accFormTagline').value = acc.tagline || '';
    document.getElementById('accFormDescription').value = acc.description || '';
    document.getElementById('accFormUnits').value = acc.total_units;
    document.getElementById('accFormBaseCap').value = acc.base_capacity;
    document.getElementById('accFormMaxCap').value = acc.max_capacity;
    document.getElementById('accFormWeekday').value = acc.weekday_rate;
    document.getElementById('accFormWeekend').value = acc.weekend_rate;
    document.getElementById('accFormEvent').value = acc.special_event_rate;
    document.getElementById('accFormExtraRate').value = acc.extra_guest_rate;
    document.getElementById('accFormImage').value = acc.image_url || '';
    document.getElementById('accFormAmenities').value = (acc.amenities || []).join(', ');
  } else {
    title.textContent = 'Add New Accommodation';
    form.reset();
    document.getElementById('accFormId').value = '';
    document.getElementById('accFormUnits').value = 5;
    document.getElementById('accFormBaseCap').value = 2;
    document.getElementById('accFormMaxCap').value = 4;
    document.getElementById('accFormExtraRate').value = 800;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.handleSaveAccommodation = async function(e) {
  e.preventDefault();
  const id = document.getElementById('accFormId').value;
  const amenitiesStr = document.getElementById('accFormAmenities').value;
  const amenities = amenitiesStr.split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    name: document.getElementById('accFormName').value.trim(),
    slug: document.getElementById('accFormSlug').value.trim(),
    tagline: document.getElementById('accFormTagline').value.trim(),
    description: document.getElementById('accFormDescription').value.trim(),
    total_units: Number(document.getElementById('accFormUnits').value),
    base_capacity: Number(document.getElementById('accFormBaseCap').value),
    max_capacity: Number(document.getElementById('accFormMaxCap').value),
    weekday_rate: Number(document.getElementById('accFormWeekday').value),
    weekend_rate: Number(document.getElementById('accFormWeekend').value),
    special_event_rate: Number(document.getElementById('accFormEvent').value),
    extra_guest_rate: Number(document.getElementById('accFormExtraRate').value),
    image_url: document.getElementById('accFormImage').value.trim(),
    amenities
  };

  try {
    let res;
    if (id) {
      res = await authFetch(`/api/admin/accommodations/${id}`, { method: 'PUT', body: payload });
    } else {
      res = await authFetch('/api/admin/accommodations', { method: 'POST', body: payload });
    }

    if (res.success) {
      closeModal('accEditModal');
      loadAccommodations();
    } else {
      alert(res.error || 'Failed to save accommodation');
    }
  } catch (err) {
    alert('Error saving accommodation');
  }
};

/* ==========================================================================
   5. PACKAGES MANAGEMENT
   ========================================================================== */
async function loadPackages() {
  try {
    const res = await authFetch('/api/admin/packages');
    if (!res.success) return;
    adminState.packages = res.data;
    const grid = document.getElementById('adminPackagesGrid');
    if (!grid) return;

    grid.innerHTML = adminState.packages.map(pkg => `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${pkg.popular ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">
              ${pkg.badge || 'Package'}
            </span>
            <span class="text-xs font-bold text-teal-700">
              ${pkg.flat_rate > 0 ? `${formatCurrency(pkg.flat_rate)} Flat` : (pkg.per_person_rate > 0 ? `${formatCurrency(pkg.per_person_rate)} / person` : 'Included')}
            </span>
          </div>

          <h4 class="text-base font-bold text-slate-900">${pkg.name}</h4>
          <p class="text-xs text-slate-500 mt-1">${pkg.description}</p>

          <ul class="mt-4 pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-600">
            ${(pkg.inclusions || []).map(inc => `<li class="flex items-center gap-1.5"><span class="text-teal-600">✓</span> ${inc}</li>`).join('')}
          </ul>
        </div>

        <div class="mt-6 pt-3 border-t border-slate-100 flex items-center justify-end">
          <button onclick="openPackageModal(${pkg.id})" class="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-lg shadow-sm">
            Edit Package
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load packages:', err);
  }
}

window.openPackageModal = function(id) {
  const modal = document.getElementById('pkgEditModal');
  const title = document.getElementById('pkgModalTitle');
  const form = document.getElementById('pkgForm');

  if (id) {
    const pkg = adminState.packages.find(p => p.id === id);
    if (!pkg) return;
    title.textContent = `Edit Package: ${pkg.name}`;
    document.getElementById('pkgFormId').value = pkg.id;
    document.getElementById('pkgFormName').value = pkg.name;
    document.getElementById('pkgFormSlug').value = pkg.slug;
    document.getElementById('pkgFormBadge').value = pkg.badge || '';
    document.getElementById('pkgFormDesc').value = pkg.description || '';
    document.getElementById('pkgFormPersonRate').value = pkg.per_person_rate;
    document.getElementById('pkgFormFlatRate').value = pkg.flat_rate;
    document.getElementById('pkgFormInclusions').value = (pkg.inclusions || []).join('\n');
    document.getElementById('pkgFormPopular').checked = Boolean(pkg.popular);
  } else {
    title.textContent = 'Add New Package';
    form.reset();
    document.getElementById('pkgFormId').value = '';
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.handleSavePackage = async function(e) {
  e.preventDefault();
  const id = document.getElementById('pkgFormId').value;
  const incStr = document.getElementById('pkgFormInclusions').value;
  const inclusions = incStr.split('\n').map(s => s.trim()).filter(Boolean);

  const payload = {
    name: document.getElementById('pkgFormName').value.trim(),
    slug: document.getElementById('pkgFormSlug').value.trim(),
    badge: document.getElementById('pkgFormBadge').value.trim(),
    description: document.getElementById('pkgFormDesc').value.trim(),
    per_person_rate: Number(document.getElementById('pkgFormPersonRate').value || 0),
    flat_rate: Number(document.getElementById('pkgFormFlatRate').value || 0),
    inclusions,
    popular: document.getElementById('pkgFormPopular').checked ? 1 : 0
  };

  try {
    let res;
    if (id) {
      res = await authFetch(`/api/admin/packages/${id}`, { method: 'PUT', body: payload });
    } else {
      res = await authFetch('/api/admin/packages', { method: 'POST', body: payload });
    }

    if (res.success) {
      closeModal('pkgEditModal');
      loadPackages();
    } else {
      alert(res.error || 'Failed to save package');
    }
  } catch (err) {
    alert('Error saving package');
  }
};

/* ==========================================================================
   6. SPECIAL EVENTS MANAGEMENT
   ========================================================================== */
async function loadEvents() {
  try {
    const res = await authFetch('/api/admin/events');
    if (!res.success) return;
    adminState.events = res.data;
    const grid = document.getElementById('adminEventsGrid');
    if (!grid) return;

    grid.innerHTML = adminState.events.map(ev => `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${ev.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">
              ${ev.is_active ? '● Active' : '○ Inactive'}
            </span>
            <span class="text-xs font-semibold text-amber-700">${ev.badge_text || 'Special'}</span>
          </div>

          <h4 class="text-base font-bold text-slate-900">${ev.name}</h4>
          <span class="text-xs font-mono text-teal-800 block mt-0.5">📅 ${ev.start_date} → ${ev.end_date}</span>
          <p class="text-xs text-slate-500 mt-2">${ev.description}</p>

          <ul class="mt-4 pt-3 border-t border-slate-100 space-y-1 text-xs text-slate-600">
            ${(ev.included_highlights || []).map(h => `<li class="flex items-center gap-1.5"><span class="text-amber-600">★</span> ${h}</li>`).join('')}
          </ul>
        </div>

        <div class="mt-6 pt-3 border-t border-slate-100 flex items-center justify-end">
          <button onclick="openEventModal(${ev.id})" class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-sm">
            Edit Event
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

window.openEventModal = function(id) {
  const modal = document.getElementById('eventEditModal');
  const title = document.getElementById('eventModalTitle');
  const form = document.getElementById('eventForm');

  if (id) {
    const ev = adminState.events.find(e => e.id === id);
    if (!ev) return;
    title.textContent = `Edit Event: ${ev.name}`;
    document.getElementById('eventFormId').value = ev.id;
    document.getElementById('eventFormName').value = ev.name;
    document.getElementById('eventFormSlug').value = ev.slug;
    document.getElementById('eventFormBadge').value = ev.badge_text || '';
    document.getElementById('eventFormStart').value = ev.start_date;
    document.getElementById('eventFormEnd').value = ev.end_date;
    document.getElementById('eventFormTagline').value = ev.tagline || '';
    document.getElementById('eventFormDesc').value = ev.description || '';
    document.getElementById('eventFormHighlights').value = (ev.included_highlights || []).join('\n');
    document.getElementById('eventFormActive').checked = Boolean(ev.is_active);
  } else {
    title.textContent = 'Create Special Event';
    form.reset();
    document.getElementById('eventFormId').value = '';
    document.getElementById('eventFormActive').checked = true;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.handleSaveEvent = async function(e) {
  e.preventDefault();
  const id = document.getElementById('eventFormId').value;
  const hlStr = document.getElementById('eventFormHighlights').value;
  const highlights = hlStr.split('\n').map(s => s.trim()).filter(Boolean);

  const payload = {
    name: document.getElementById('eventFormName').value.trim(),
    slug: document.getElementById('eventFormSlug').value.trim(),
    badge_text: document.getElementById('eventFormBadge').value.trim(),
    start_date: document.getElementById('eventFormStart').value,
    end_date: document.getElementById('eventFormEnd').value,
    tagline: document.getElementById('eventFormTagline').value.trim(),
    description: document.getElementById('eventFormDesc').value.trim(),
    included_highlights: highlights,
    is_active: document.getElementById('eventFormActive').checked ? 1 : 0
  };

  try {
    let res;
    if (id) {
      res = await authFetch(`/api/admin/events/${id}`, { method: 'PUT', body: payload });
    } else {
      res = await authFetch('/api/admin/events', { method: 'POST', body: payload });
    }

    if (res.success) {
      closeModal('eventEditModal');
      loadEvents();
    } else {
      alert(res.error || 'Failed to save event');
    }
  } catch (err) {
    alert('Error saving event');
  }
};

/* ==========================================================================
   7. CUSTOMERS DIRECTORY
   ========================================================================== */
let customerSearchTimer = null;
window.handleCustomerSearch = function(query) {
  clearTimeout(customerSearchTimer);
  customerSearchTimer = setTimeout(() => {
    loadCustomers(query);
  }, 250);
};

async function loadCustomers(search = '') {
  try {
    let url = '/api/admin/customers';
    if (search) url += `?search=${encodeURIComponent(search)}`;

    const res = await authFetch(url);
    if (!res.success) return;

    adminState.customers = res.data;
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;

    if (adminState.customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400">No customers registered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = adminState.customers.map(c => `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3.5 font-bold text-slate-900">${c.customer_name}</td>
        <td class="p-3.5 text-slate-600 font-mono">${c.customer_email}</td>
        <td class="p-3.5 text-slate-600">${c.customer_phone}</td>
        <td class="p-3.5 text-slate-500">${c.customer_city || '—'}</td>
        <td class="p-3.5 font-bold text-teal-800">${c.total_bookings} Stay${c.total_bookings > 1 ? 's' : ''}</td>
        <td class="p-3.5 font-black text-slate-900">${formatCurrency(c.total_spent)}</td>
        <td class="p-3.5 text-slate-500">${c.last_booking_date ? c.last_booking_date.slice(0, 10) : '—'}</td>
        <td class="p-3.5 text-right">
          <button onclick="viewCustomerHistory('${c.customer_email.replace(/'/g, "\\'")}')" class="px-3 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-bold rounded-lg border border-teal-200">
            View History →
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load customers:', err);
  }
}

window.viewCustomerHistory = async function(email) {
  try {
    const res = await authFetch(`/api/admin/customers/${encodeURIComponent(email)}/history`);
    if (!res.success || !res.data) return;

    const modal = document.getElementById('customerHistoryModal');
    document.getElementById('custHistoryEmail').textContent = `Showing all reservations for ${email}`;
    const container = document.getElementById('customerHistoryContent');

    if (res.data.length === 0) {
      container.innerHTML = '<p class="text-slate-400 text-center py-6">No reservations found.</p>';
    } else {
      container.innerHTML = res.data.map(b => `
        <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
          <div>
            <span class="font-mono font-bold text-teal-800">${b.booking_reference}</span>
            <h4 class="font-bold text-slate-900">${b.accommodation_name} • ${b.package_name}</h4>
            <span class="text-slate-500">${b.check_in_date} → ${b.check_out_date} (${b.total_nights} Nights)</span>
          </div>
          <div class="text-right">
            ${getStatusBadge(b.booking_status)}
            <span class="block font-black text-slate-900 mt-1">${formatCurrency(b.total_amount)}</span>
            <button onclick="closeModal('customerHistoryModal'); viewBookingDetails('${b.booking_reference}')" class="text-teal-700 underline font-semibold mt-1 block">
              Receipt
            </button>
          </div>
        </div>
      `).join('');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  } catch (err) {
    alert('Failed to load customer history');
  }
};

/* ==========================================================================
   8. FINANCE & REFUNDS MANAGEMENT
   ========================================================================== */
async function loadFinanceOverview() {
  try {
    const res = await authFetch('/api/admin/finance');
    if (!res.success || !res.data) return;

    const fin = res.data;
    adminState.finance = fin;

    document.getElementById('finGrossRevenue').textContent = formatCurrency(fin.grossRevenue);
    document.getElementById('finTotalRefunds').textContent = formatCurrency(fin.totalRefunds);
    document.getElementById('finNetRevenue').textContent = formatCurrency(fin.netRevenue);
    document.getElementById('finPendingAmount').textContent = formatCurrency(fin.pendingRefundsAmount);

    document.getElementById('finRefundsCountBadge').textContent = `${(fin.completedRefundsCount || 0) + (fin.pendingRefundsCount || 0)} Cancellations`;
    document.getElementById('finPendingCountBadge').textContent = `${fin.pendingRefundsCount || 0} Awaiting Settlement`;

    const pBadge = document.getElementById('badgePendingRefunds');
    if (pBadge) {
      if (fin.pendingRefundsCount > 0) {
        pBadge.textContent = fin.pendingRefundsCount;
        pBadge.classList.remove('hidden');
      } else {
        pBadge.classList.add('hidden');
      }
    }

    // Payment Methods Breakdown
    const pmContainer = document.getElementById('finPaymentMethodsGrid');
    if (pmContainer) {
      if (!fin.byPaymentMethod || fin.byPaymentMethod.length === 0) {
        pmContainer.innerHTML = '<p class="text-xs text-slate-400">No payment records yet.</p>';
      } else {
        pmContainer.innerHTML = fin.byPaymentMethod.map(pm => `
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span class="block text-xs font-bold text-slate-700">${pm.payment_method || 'Online'}</span>
            <span class="text-lg font-black text-teal-800 block mt-1">${formatCurrency(pm.total_amount)}</span>
            <span class="text-[10px] text-slate-500">${pm.count} Successful Booking${pm.count > 1 ? 's' : ''}</span>
          </div>
        `).join('');
      }
    }

    // Render Ledger
    renderFinanceLedger();
  } catch (err) {
    console.error('Failed to load finance data:', err);
  }
}

window.filterFinanceLedger = function(filter) {
  adminState.financeFilter = filter;
  document.querySelectorAll('.fin-filter-btn').forEach(btn => {
    btn.className = 'fin-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200';
  });
  const activeBtn = document.getElementById(`finFilter_${filter}`);
  if (activeBtn) activeBtn.className = 'fin-filter-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-600 text-white';

  renderFinanceLedger();
};

function renderFinanceLedger() {
  const tbody = document.getElementById('financeLedgerTbody');
  if (!tbody || !adminState.finance) return;

  let txns = adminState.finance.recentTransactions || [];
  const filter = adminState.financeFilter || 'ALL';

  if (filter === 'PENDING') {
    txns = txns.filter(t => t.refund_status === 'PENDING_REFUND');
  } else if (filter === 'REFUNDED') {
    txns = txns.filter(t => t.refund_status === 'REFUNDED');
  }

  if (txns.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400">No transactions matching this filter.</td></tr>';
    return;
  }

  tbody.innerHTML = txns.map(t => {
    let refundBadge = 'bg-slate-100 text-slate-600';
    if (t.refund_status === 'PENDING_REFUND') refundBadge = 'bg-amber-100 text-amber-900 border border-amber-300 font-bold';
    if (t.refund_status === 'REFUNDED') refundBadge = 'bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold';

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3.5">
          <span class="font-mono font-bold text-teal-800 block">${t.booking_reference}</span>
          <span class="text-[10px] text-slate-400 font-mono">${t.transaction_id || 'TXN-DIRECT'}</span>
        </td>
        <td class="p-3.5">
          <strong class="text-slate-900 block">${t.customer_name}</strong>
          <span class="text-[10px] text-slate-500 font-mono">${t.customer_email}</span>
        </td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${t.payment_method || 'DEMO_UPI'}</span>
        </td>
        <td class="p-3.5 font-bold text-slate-900">${formatCurrency(t.total_amount)}</td>
        <td class="p-3.5">${getStatusBadge(t.booking_status)}</td>
        <td class="p-3.5 font-bold ${t.refund_amount > 0 ? 'text-rose-700' : 'text-slate-400'}">
          ${t.refund_amount > 0 ? `${formatCurrency(t.refund_amount)} (${t.refund_percentage}%)` : '₹0'}
        </td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded-full text-[10px] ${refundBadge}">${t.refund_status || 'NOT_APPLICABLE'}</span>
        </td>
        <td class="p-3.5 text-right">
          ${t.refund_status === 'PENDING_REFUND' ? `
            <button onclick="settleRefund(${t.id})" class="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-[11px] shadow-sm">
              Settle Refund →
            </button>
          ` : `
            <button onclick="viewBookingDetails('${t.booking_reference}')" class="text-teal-700 hover:underline font-semibold text-xs">
              Audit
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

window.settleRefund = async function(bookingId) {
  if (!confirm(`Confirm settlement of this customer refund? This will mark the refund as fully disbursed to the customer.`)) return;

  try {
    const res = await authFetch(`/api/admin/bookings/${bookingId}/refund`, {
      method: 'PATCH',
      body: { refundStatus: 'REFUNDED' }
    });

    if (res.success) {
      alert('Refund marked as SETTLED & COMPLETED.');
      closeModal('bookingModal');
      loadFinanceOverview();
      loadBookings();
      loadDashboardStats();
    } else {
      alert(res.error || 'Failed to update refund status');
    }
  } catch (err) {
    alert('Error connecting to finance settlement service');
  }
};

/* ==========================================================================
   MODAL HELPERS
   ========================================================================== */
window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
};
