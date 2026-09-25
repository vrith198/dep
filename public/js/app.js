// Camp Sandrush Client Application
const appState = {
  accommodations: [],
  packages: [],
  specialEvents: [],
  addOns: [],
  availability: {}, // map accId -> availability info
  selectedStayType: 'all', // 'all', 'weekday', 'weekend', 'special'
  checkInDate: '',
  checkOutDate: '',
  numAdults: 2,
  numChildren: 0,
  selectedAccommodationId: null,
  selectedPackageId: null,
  selectedAddOns: {}, // { [addOnId]: quantity }
  pricing: null,
  isLoadingPricing: false
};

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount || 0);
}

// Format date nicely (e.g. "Fri, 25 Sep 2026")
function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Add days to a YYYY-MM-DD string
function addDaysToDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get today's local date string
function getTodayDateStr() {
  const dt = new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  // Set default dates: check-in next Friday, check-out next Sunday
  initDefaultDates();
  await loadInitialData();
  setupEventListeners();
  await checkAvailabilityAndPricing();
});

function initDefaultDates() {
  const today = new Date();
  const day = today.getDay(); // 0 is Sunday, 5 is Friday
  
  // Find next Friday
  let daysUntilFriday = (5 - day + 7) % 7;
  if (daysUntilFriday === 0) daysUntilFriday = 7; // next week's Friday if today is Friday
  
  const checkIn = new Date(today);
  checkIn.setDate(today.getDate() + daysUntilFriday);
  
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkIn.getDate() + 2); // 2 nights (Fri to Sun)

  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayNum = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dayNum}`;
  };

  appState.checkInDate = fmt(checkIn);
  appState.checkOutDate = fmt(checkOut);

  // Set input values
  const inEl = document.getElementById('checkInInput');
  const outEl = document.getElementById('checkOutInput');
  const heroIn = document.getElementById('heroCheckIn');
  const heroOut = document.getElementById('heroCheckOut');

  const minDate = getTodayDateStr();
  if (inEl) {
    inEl.min = minDate;
    inEl.value = appState.checkInDate;
  }
  if (outEl) {
    outEl.min = minDate;
    outEl.value = appState.checkOutDate;
  }
  if (heroIn) {
    heroIn.min = minDate;
    heroIn.value = appState.checkInDate;
  }
  if (heroOut) {
    heroOut.min = minDate;
    heroOut.value = appState.checkOutDate;
  }
}

async function loadInitialData() {
  try {
    const [accRes, pkgRes, evRes, addOnRes] = await Promise.all([
      fetch('/api/accommodations').then(r => r.json()),
      fetch('/api/packages').then(r => r.json()),
      fetch('/api/special-events').then(r => r.json()),
      fetch('/api/add-ons').then(r => r.json())
    ]);

    if (accRes.success) appState.accommodations = accRes.data;
    if (pkgRes.success) appState.packages = pkgRes.data;
    if (evRes.success) appState.specialEvents = evRes.data;
    if (addOnRes.success) appState.addOns = addOnRes.data;

    // Default select first accommodation and most popular package
    if (appState.accommodations.length > 0) {
      appState.selectedAccommodationId = appState.accommodations[0].id;
    }
    const popPkg = appState.packages.find(p => p.popular) || appState.packages[0];
    if (popPkg) {
      appState.selectedPackageId = popPkg.id;
    }

    renderSpecialEventsList();
    renderPackagesList();
    renderAddOnsList();
  } catch (err) {
    console.error('Failed to load initial data:', err);
    showToast('Failed to load camp options. Please refresh.', 'error');
  }
}

// Render Special Events Section
function renderSpecialEventsList() {
  const container = document.getElementById('specialEventsContainer');
  if (!container) return;

  if (appState.specialEvents.length === 0) {
    container.innerHTML = '<p class="text-slate-500">No upcoming special events right now.</p>';
    return;
  }

  container.innerHTML = appState.specialEvents.map(event => {
    const highlights = event.included_highlights || [];
    return `
      <div class="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden card-hover-effect flex flex-col">
        <div class="relative h-48 overflow-hidden">
          <img src="${event.image_url}" alt="${event.name}" class="w-full h-full object-cover transition-transform duration-500 hover:scale-105" />
          <div class="absolute top-3 left-3 bg-amber-500 text-white font-semibold text-xs px-3 py-1 rounded-full shadow-md">
            ★ ${event.badge_text || 'Featured Event'}
          </div>
          <div class="absolute bottom-3 right-3 bg-night-900/80 backdrop-blur text-white text-xs px-2.5 py-1 rounded-lg">
            📅 ${formatDisplayDate(event.start_date)} - ${formatDisplayDate(event.end_date)}
          </div>
        </div>
        <div class="p-6 flex-1 flex flex-col justify-between">
          <div>
            <h3 class="text-xl font-bold text-slate-800">${event.name}</h3>
            <p class="text-sm text-teal-700 font-medium mt-1">${event.tagline || ''}</p>
            <p class="text-sm text-slate-600 mt-2 line-clamp-2">${event.description}</p>
            
            <div class="mt-4 pt-4 border-t border-slate-100">
              <span class="text-xs uppercase font-bold tracking-wider text-slate-400">Festival Inclusions:</span>
              <ul class="mt-2 space-y-1 text-xs text-slate-600">
                ${highlights.slice(0, 3).map(h => `<li class="flex items-center gap-1.5"><span class="text-teal-600">✓</span> ${h}</li>`).join('')}
              </ul>
            </div>
          </div>

          <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span class="text-xs text-slate-500 font-medium">Special Event Tariff</span>
            <button onclick="selectSpecialEvent('${event.start_date}', '${event.end_date}', '${event.name.replace(/'/g, "\\'")}')" class="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-semibold rounded-xl shadow-sm transition">
              Book This Event →
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 1-Click Select Special Event
window.selectSpecialEvent = function(startDate, endDate, eventName) {
  appState.checkInDate = startDate;
  appState.checkOutDate = endDate;

  const inEl = document.getElementById('checkInInput');
  const outEl = document.getElementById('checkOutInput');
  const heroIn = document.getElementById('heroCheckIn');
  const heroOut = document.getElementById('heroCheckOut');

  if (inEl) inEl.value = startDate;
  if (outEl) outEl.value = endDate;
  if (heroIn) heroIn.value = startDate;
  if (heroOut) heroOut.value = endDate;

  showToast(`Selected "${eventName}" dates (${startDate} to ${endDate})!`, 'success');

  const bookingSection = document.getElementById('bookingSection');
  if (bookingSection) {
    bookingSection.scrollIntoView({ behavior: 'smooth' });
  }

  checkAvailabilityAndPricing();
};

// Render Accommodations list
function renderAccommodationsList() {
  const container = document.getElementById('accommodationsContainer');
  if (!container) return;

  container.innerHTML = appState.accommodations.map(acc => {
    const availInfo = appState.availability[acc.id] || {
      is_available: true,
      available_units: acc.total_units,
      status_text: `${acc.total_units} Available`
    };

    const isSelected = appState.selectedAccommodationId === acc.id;
    const isSoldOut = !availInfo.is_available;

    let stockBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (isSoldOut) {
      stockBadgeClass = 'bg-rose-50 text-rose-700 border-rose-200';
    } else if (availInfo.available_units <= 2) {
      stockBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
    }

    return `
      <div class="relative bg-white rounded-2xl border ${isSelected ? 'border-teal-500 ring-2 ring-teal-500/20 shadow-md' : 'border-slate-200 shadow-sm'} ${isSoldOut ? 'opacity-70 grayscale-[30%]' : ''} overflow-hidden card-hover-effect flex flex-col justify-between">
        <div>
          <div class="relative h-52 overflow-hidden">
            <img src="${acc.image_url}" alt="${acc.name}" class="w-full h-full object-cover" />
            <div class="absolute top-3 left-3 bg-night-900/80 backdrop-blur text-white text-xs font-semibold px-2.5 py-1 rounded-md">
              Capacity: ${acc.base_capacity}-${acc.max_capacity} Guests
            </div>
            <div class="absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-md border ${stockBadgeClass} shadow-sm">
              ${availInfo.status_text}
            </div>
          </div>

          <div class="p-5">
            <h3 class="text-xl font-bold text-slate-800">${acc.name}</h3>
            <p class="text-xs text-slate-500 mt-1 line-clamp-2">${acc.description}</p>

            <!-- Pricing Badges -->
            <div class="grid grid-cols-3 gap-1.5 mt-4 text-center">
              <div class="p-2 rounded-lg bg-emerald-50/70 border border-emerald-100">
                <span class="block text-[10px] text-emerald-800 font-semibold uppercase">Weekday</span>
                <span class="text-xs font-bold text-emerald-900">${formatCurrency(acc.weekday_rate)}</span>
                <span class="text-[9px] text-emerald-700 block">/night</span>
              </div>
              <div class="p-2 rounded-lg bg-blue-50/70 border border-blue-100">
                <span class="block text-[10px] text-blue-800 font-semibold uppercase">Weekend</span>
                <span class="text-xs font-bold text-blue-900">${formatCurrency(acc.weekend_rate)}</span>
                <span class="text-[9px] text-blue-700 block">/night</span>
              </div>
              <div class="p-2 rounded-lg bg-amber-50/70 border border-amber-100">
                <span class="block text-[10px] text-amber-800 font-semibold uppercase">Event</span>
                <span class="text-xs font-bold text-amber-900">${formatCurrency(acc.special_event_rate)}</span>
                <span class="text-[9px] text-amber-700 block">/night</span>
              </div>
            </div>

            <!-- Amenities Chips -->
            <div class="flex flex-wrap gap-1.5 mt-3.5">
              ${(acc.amenities || []).slice(0, 3).map(a => `<span class="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">• ${a}</span>`).join('')}
              ${(acc.amenities || []).length > 3 ? `<span class="text-[11px] text-teal-600 font-medium px-1">+${acc.amenities.length - 3} more</span>` : ''}
            </div>
          </div>
        </div>

        <div class="p-5 pt-0 border-t border-slate-100 flex items-center justify-between gap-2 mt-2">
          <button type="button" onclick="openAccommodationModal(${acc.id})" class="text-xs text-slate-500 hover:text-teal-700 font-medium underline py-2">
            View Details
          </button>

          <button type="button"
            ${isSoldOut ? 'disabled' : ''}
            onclick="selectAccommodation(${acc.id})"
            class="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              isSelected
                ? 'bg-teal-600 text-white shadow-sm'
                : isSoldOut
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200'
            }">
            ${isSelected ? '✓ Selected Stay' : isSoldOut ? 'Sold Out' : 'Select Stay'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.selectAccommodation = function(accId) {
  const avail = appState.availability[accId];
  if (avail && !avail.is_available) {
    showToast('This accommodation is sold out for the selected dates.', 'warning');
    return;
  }
  appState.selectedAccommodationId = accId;
  renderAccommodationsList();
  fetchPricingPreview();
};

// Render Packages List
function renderPackagesList() {
  const container = document.getElementById('packagesContainer');
  if (!container) return;

  container.innerHTML = appState.packages.map(pkg => {
    const isSelected = appState.selectedPackageId === pkg.id;
    let rateStr = 'Included Free';
    if (pkg.flat_rate > 0) {
      rateStr = `${formatCurrency(pkg.flat_rate)} Flat`;
    } else if (pkg.per_person_rate > 0) {
      rateStr = `${formatCurrency(pkg.per_person_rate)} / person`;
    }

    return `
      <div onclick="selectPackage(${pkg.id})" class="cursor-pointer rounded-2xl p-5 border transition card-hover-effect relative flex flex-col justify-between ${
        isSelected
          ? 'bg-teal-50/60 border-teal-500 ring-2 ring-teal-500/20 shadow-sm'
          : 'bg-white border-slate-200 hover:border-slate-300'
      }">
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
              pkg.popular ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
            }">
              ${pkg.badge || 'Package'}
            </span>
            <span class="text-sm font-bold text-teal-700">${rateStr}</span>
          </div>

          <h4 class="text-lg font-bold text-slate-800">${pkg.name}</h4>
          <p class="text-xs text-slate-500 mt-1">${pkg.description}</p>

          <ul class="mt-3 space-y-1.5 text-xs text-slate-600 border-t border-slate-100 pt-3">
            ${(pkg.inclusions || []).map(inc => `
              <li class="flex items-start gap-2">
                <span class="text-teal-600 font-bold">✓</span>
                <span>${inc}</span>
              </li>
            `).join('')}
          </ul>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
          <span class="text-xs text-slate-400">Click to choose package</span>
          <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            isSelected ? 'border-teal-600 bg-teal-600 text-white text-[10px]' : 'border-slate-300'
          }">
            ${isSelected ? '✓' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.selectPackage = function(pkgId) {
  appState.selectedPackageId = pkgId;
  renderPackagesList();
  fetchPricingPreview();
};

// Render Add-ons List
function renderAddOnsList() {
  const container = document.getElementById('addOnsContainer');
  if (!container) return;

  container.innerHTML = appState.addOns.map(addon => {
    const qty = appState.selectedAddOns[addon.id] || 0;
    const isChecked = qty > 0;

    let chargeLabel = '/ stay';
    if (addon.charge_type === 'per_person') chargeLabel = '/ person';
    if (addon.charge_type === 'per_night') chargeLabel = '/ night';

    return `
      <div class="p-4 rounded-xl border transition flex items-center justify-between gap-4 ${
        isChecked ? 'bg-teal-50/50 border-teal-300' : 'bg-white border-slate-200'
      }">
        <div class="flex items-start gap-3">
          <input type="checkbox" id="addon_${addon.id}" ${isChecked ? 'checked' : ''} onchange="toggleAddOn(${addon.id}, this.checked)" class="mt-1 w-4 h-4 text-teal-600 rounded focus:ring-teal-500 cursor-pointer" />
          <div>
            <label for="addon_${addon.id}" class="text-sm font-bold text-slate-800 cursor-pointer block">${addon.name}</label>
            <p class="text-xs text-slate-500">${addon.description}</p>
          </div>
        </div>

        <div class="text-right whitespace-nowrap">
          <span class="text-sm font-bold text-slate-900">${formatCurrency(addon.price)}</span>
          <span class="text-[11px] text-slate-500 block">${chargeLabel}</span>
        </div>
      </div>
    `;
  }).join('');
}

window.toggleAddOn = function(addOnId, checked) {
  if (checked) {
    appState.selectedAddOns[addOnId] = 1;
  } else {
    delete appState.selectedAddOns[addOnId];
  }
  renderAddOnsList();
  fetchPricingPreview();
};

// Check Availability and update UI
async function checkAvailabilityAndPricing() {
  if (!appState.checkInDate || !appState.checkOutDate) return;

  try {
    const res = await fetch(`/api/availability?check_in=${appState.checkInDate}&check_out=${appState.checkOutDate}`);
    const data = await res.json();
    if (data.success) {
      appState.availability = {};
      data.data.forEach(item => {
        appState.availability[item.id] = item;
      });

      // If selected accommodation is now sold out, select first available
      const currentSelected = appState.availability[appState.selectedAccommodationId];
      if (currentSelected && !currentSelected.is_available) {
        const firstAvail = data.data.find(d => d.is_available);
        if (firstAvail) {
          appState.selectedAccommodationId = firstAvail.id;
        }
      }

      renderAccommodationsList();
      await fetchPricingPreview();
    } else {
      showToast(data.error || 'Failed to check availability', 'error');
    }
  } catch (err) {
    console.error('Availability check error:', err);
  }
}

// Fetch Pricing Preview from Server
let pricingDebounceTimer = null;
function fetchPricingPreview() {
  clearTimeout(pricingDebounceTimer);
  pricingDebounceTimer = setTimeout(async () => {
    if (!appState.selectedAccommodationId || !appState.selectedPackageId || !appState.checkInDate || !appState.checkOutDate) {
      return;
    }

    const payload = {
      accommodationId: appState.selectedAccommodationId,
      packageId: appState.selectedPackageId,
      checkInDate: appState.checkInDate,
      checkOutDate: appState.checkOutDate,
      numAdults: appState.numAdults,
      numChildren: appState.numChildren,
      selectedAddOns: Object.keys(appState.selectedAddOns).map(id => ({
        addOnId: Number(id),
        quantity: appState.selectedAddOns[id]
      }))
    };

    try {
      const res = await fetch('/api/pricing-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        appState.pricing = data.data;
        renderPricingBreakdown();
        renderStayTypeHeader();
      } else {
        showToast(data.error, 'error');
      }
    } catch (err) {
      console.error('Pricing preview error:', err);
    }
  }, 150);
}

// Render dynamic Stay Type banner
function renderStayTypeHeader() {
  const banner = document.getElementById('stayTypeBanner');
  if (!banner || !appState.pricing) return;

  const { stayTypeSummary, nightBreakdown, totalNights } = appState.pricing;

  let badgeColor = 'bg-teal-50 text-teal-800 border-teal-200';
  let icon = '🌴';
  if (stayTypeSummary.includes('Special Event')) {
    badgeColor = 'bg-amber-100 text-amber-900 border-amber-300';
    icon = '✨';
  } else if (stayTypeSummary.includes('Weekend')) {
    badgeColor = 'bg-blue-50 text-blue-900 border-blue-200';
    icon = '🔥';
  }

  banner.className = `p-4 rounded-xl border flex items-center justify-between gap-3 ${badgeColor}`;
  banner.innerHTML = `
    <div class="flex items-center gap-3">
      <span class="text-2xl">${icon}</span>
      <div>
        <span class="text-xs uppercase font-bold tracking-wider opacity-75">Calculated Stay Category</span>
        <h4 class="text-base font-bold">${stayTypeSummary} (${totalNights} Night${totalNights > 1 ? 's' : ''})</h4>
      </div>
    </div>
    <div class="text-xs font-semibold px-3 py-1 bg-white/70 backdrop-blur rounded-lg">
      ${formatDisplayDate(appState.checkInDate)} → ${formatDisplayDate(appState.checkOutDate)}
    </div>
  `;
}

// Render Order Summary Sidebar
function renderPricingBreakdown() {
  const container = document.getElementById('orderSummaryContainer');
  if (!container || !appState.pricing) return;

  const p = appState.pricing;
  const b = p.pricingBreakdown;

  container.innerHTML = `
    <div class="space-y-4 text-sm">
      <!-- Stay & Accommodation Summary -->
      <div class="flex items-start justify-between pb-3 border-b border-slate-100">
        <div>
          <span class="text-xs text-teal-700 font-semibold uppercase tracking-wider">${p.stayTypeSummary}</span>
          <h4 class="font-bold text-slate-800 text-base">${p.accommodation.name}</h4>
          <span class="text-xs text-slate-500">${p.numAdults} Adults${p.numChildren > 0 ? `, ${p.numChildren} Children` : ''} • ${p.totalNights} Night${p.totalNights > 1 ? 's' : ''}</span>
        </div>
        <span class="font-bold text-slate-800">${formatCurrency(b.baseAccommodationAmount)}</span>
      </div>

      <!-- Night by Night Itemization -->
      <div class="bg-slate-50 rounded-xl p-3 space-y-1.5 text-xs text-slate-600">
        <span class="block font-semibold text-slate-700 mb-1">Nightly Tariffs:</span>
        ${p.nightBreakdown.map(n => {
          let badgeClass = 'text-emerald-700 bg-emerald-50';
          if (n.type === 'weekend') badgeClass = 'text-blue-700 bg-blue-50';
          if (n.type === 'special_event') badgeClass = 'text-amber-800 bg-amber-100 font-semibold';

          return `
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span>${n.dayName.slice(0, 3)}, ${n.date.slice(5)}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] ${badgeClass}">${n.badgeText}</span>
              </div>
              <span class="font-medium text-slate-700">${formatCurrency(n.rate)}</span>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Extra Guests if any -->
      ${b.extraGuestsAmount > 0 ? `
        <div class="flex items-center justify-between text-xs pb-2 border-b border-slate-100">
          <span class="text-slate-600">${p.extraGuestsCount} Extra Guest${p.extraGuestsCount > 1 ? 's' : ''} (${p.totalNights} nights)</span>
          <span class="font-medium text-slate-800">${formatCurrency(b.extraGuestsAmount)}</span>
        </div>
      ` : ''}

      <!-- Package -->
      <div class="flex items-center justify-between text-xs pb-2 border-b border-slate-100">
        <div>
          <span class="text-slate-700 font-medium block">Package: ${p.package.name}</span>
          <span class="text-slate-400">${p.package.badge}</span>
        </div>
        <span class="font-medium text-slate-800">${b.packageAmount === 0 ? 'Included' : formatCurrency(b.packageAmount)}</span>
      </div>

      <!-- Add-ons if any -->
      ${p.selectedAddOns.length > 0 ? `
        <div class="space-y-1 text-xs pb-2 border-b border-slate-100">
          <span class="text-slate-500 font-medium block">Selected Add-ons:</span>
          ${p.selectedAddOns.map(ao => `
            <div class="flex items-center justify-between text-slate-600">
              <span>• ${ao.name} (x${ao.quantity})</span>
              <span>${formatCurrency(ao.total_price)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Subtotal & Taxes -->
      <div class="space-y-2 pt-2 text-xs">
        <div class="flex items-center justify-between text-slate-600">
          <span>Subtotal</span>
          <span class="font-medium text-slate-800">${formatCurrency(b.subtotal)}</span>
        </div>
        <div class="flex items-center justify-between text-slate-600">
          <span>Taxes & GST (12%)</span>
          <span class="font-medium text-slate-800">${formatCurrency(b.taxAmount)}</span>
        </div>
      </div>

      <!-- Grand Total -->
      <div class="pt-3 border-t-2 border-slate-200 flex items-center justify-between">
        <div>
          <span class="text-xs uppercase font-bold tracking-wider text-slate-500">Total Payable</span>
          <h3 class="text-2xl font-black text-teal-800">${formatCurrency(b.totalAmount)}</h3>
        </div>
        <div class="text-right">
          <span class="inline-block text-[11px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
            All-Inclusive Rate
          </span>
        </div>
      </div>
    </div>
  `;
}

// Setup Event Listeners
function setupEventListeners() {
  // Stay Presets (Weekend, Weekday, Special)
  const btnWeekend = document.getElementById('presetWeekend');
  const btnWeekday = document.getElementById('presetWeekday');

  if (btnWeekend) {
    btnWeekend.addEventListener('click', () => {
      const today = new Date();
      const day = today.getDay();
      let daysUntilFri = (5 - day + 7) % 7;
      if (daysUntilFri === 0) daysUntilFri = 7;
      
      const fri = new Date(today);
      fri.setDate(today.getDate() + daysUntilFri);
      const sun = new Date(fri);
      sun.setDate(fri.getDate() + 2);

      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      updateStayDates(fmt(fri), fmt(sun));
      showToast('Set dates to upcoming Weekend (Fri-Sun)', 'info');
    });
  }

  if (btnWeekday) {
    btnWeekday.addEventListener('click', () => {
      const today = new Date();
      const day = today.getDay();
      let daysUntilMon = (1 - day + 7) % 7;
      if (daysUntilMon === 0) daysUntilMon = 7;
      
      const mon = new Date(today);
      mon.setDate(today.getDate() + daysUntilMon);
      const wed = new Date(mon);
      wed.setDate(mon.getDate() + 2); // 2 nights

      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      updateStayDates(fmt(mon), fmt(wed));
      showToast('Set dates to upcoming Weekday Calm (Mon-Wed)', 'info');
    });
  }

  // Date input changes
  const checkInEl = document.getElementById('checkInInput');
  const checkOutEl = document.getElementById('checkOutInput');

  if (checkInEl) {
    checkInEl.addEventListener('change', (e) => {
      const newIn = e.target.value;
      if (newIn >= appState.checkOutDate) {
        appState.checkOutDate = addDaysToDate(newIn, 1);
        if (checkOutEl) checkOutEl.value = appState.checkOutDate;
      }
      appState.checkInDate = newIn;
      checkAvailabilityAndPricing();
    });
  }

  if (checkOutEl) {
    checkOutEl.addEventListener('change', (e) => {
      const newOut = e.target.value;
      if (newOut <= appState.checkInDate) {
        showToast('Check-out date must be after check-in date', 'warning');
        e.target.value = appState.checkOutDate;
        return;
      }
      appState.checkOutDate = newOut;
      checkAvailabilityAndPricing();
    });
  }

  // Hero Date Inputs
  const heroIn = document.getElementById('heroCheckIn');
  const heroOut = document.getElementById('heroCheckOut');
  const heroSearchBtn = document.getElementById('heroSearchBtn');

  if (heroSearchBtn) {
    heroSearchBtn.addEventListener('click', () => {
      if (heroIn && heroOut) {
        updateStayDates(heroIn.value, heroOut.value);
      }
      const bSec = document.getElementById('bookingSection');
      if (bSec) bSec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Guest count counters
  const adultsSelect = document.getElementById('adultsCount');
  const childrenSelect = document.getElementById('childrenCount');

  if (adultsSelect) {
    adultsSelect.addEventListener('change', (e) => {
      appState.numAdults = Number(e.target.value);
      fetchPricingPreview();
    });
  }

  if (childrenSelect) {
    childrenSelect.addEventListener('change', (e) => {
      appState.numChildren = Number(e.target.value);
      fetchPricingPreview();
    });
  }

  // Form submission
  const bookingForm = document.getElementById('bookingCreationForm');
  if (bookingForm) {
    bookingForm.addEventListener('submit', handleBookingSubmit);
  }
}

function updateStayDates(checkIn, checkOut) {
  appState.checkInDate = checkIn;
  appState.checkOutDate = checkOut;

  const inEl = document.getElementById('checkInInput');
  const outEl = document.getElementById('checkOutInput');
  const heroIn = document.getElementById('heroCheckIn');
  const heroOut = document.getElementById('heroCheckOut');

  if (inEl) inEl.value = checkIn;
  if (outEl) outEl.value = checkOut;
  if (heroIn) heroIn.value = checkIn;
  if (heroOut) heroOut.value = checkOut;

  checkAvailabilityAndPricing();
}

// Mobile Nav Toggle
window.toggleMobileNav = function() {
  const drawer = document.getElementById('mobileNavDrawer');
  if (drawer) {
    drawer.classList.toggle('hidden');
  }
};

// Handle Booking Form Submission -> Opens Demo Payment Checkout Modal
async function handleBookingSubmit(e) {
  e.preventDefault();

  if (!appState.selectedAccommodationId) {
    showToast('Please select an accommodation.', 'error');
    return;
  }
  if (!appState.selectedPackageId) {
    showToast('Please select an experience package.', 'error');
    return;
  }

  const name = document.getElementById('guestName')?.value.trim();
  const email = document.getElementById('guestEmail')?.value.trim();
  const phone = document.getElementById('guestPhone')?.value.trim();

  if (!name || !email || !phone) {
    showToast('Please fill in your name, email, and phone number.', 'warning');
    return;
  }

  if (!appState.pricing) {
    showToast('Calculating rates, please wait...', 'info');
    await fetchPricingPreview();
  }

  // Open Payment Modal
  openDemoPaymentModal();
}

window.openDemoPaymentModal = function() {
  const modal = document.getElementById('demoPaymentModal');
  if (!modal || !appState.pricing) return;

  const p = appState.pricing;
  document.getElementById('modalPayAmount').textContent = formatCurrency(p.pricingBreakdown.totalAmount);
  document.getElementById('modalPayStayInfo').textContent = `${p.accommodation.name} • ${p.stayTypeSummary} (${p.totalNights} Nights) • ${p.numAdults} Guests`;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeDemoPaymentModal = function() {
  const modal = document.getElementById('demoPaymentModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
};

window.executeSimulatedPayment = async function() {
  const btn = document.getElementById('confirmPaymentBtn');
  const originalHtml = btn ? btn.innerHTML : 'Approve Payment';

  const methodRadio = document.querySelector('input[name="demoPaymentMethod"]:checked');
  const paymentMethod = methodRadio ? methodRadio.value : 'DEMO_UPI';

  const name = document.getElementById('guestName')?.value.trim();
  const email = document.getElementById('guestEmail')?.value.trim();
  const phone = document.getElementById('guestPhone')?.value.trim();
  const city = document.getElementById('guestCity')?.value.trim() || '';
  const specialRequests = document.getElementById('specialRequests')?.value.trim() || '';

  const payload = {
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    customerCity: city,
    accommodationId: appState.selectedAccommodationId,
    packageId: appState.selectedPackageId,
    checkInDate: appState.checkInDate,
    checkOutDate: appState.checkOutDate,
    numAdults: appState.numAdults,
    numChildren: appState.numChildren,
    selectedAddOns: Object.keys(appState.selectedAddOns).map(id => ({
      addOnId: Number(id),
      quantity: appState.selectedAddOns[id]
    })),
    specialRequests,
    paymentMethod
  };

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg> Simulating 256-bit Payment Authorization...
      `;
    }

    // Realistic demo network delay simulation
    await new Promise(resolve => setTimeout(resolve, 800));

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.success && data.data) {
      if (btn) btn.innerHTML = '✓ Payment Successful! Generating Voucher...';
      showToast('Payment verified! Booking confirmed successfully.', 'success');
      setTimeout(() => {
        window.location.href = `/confirmation.html?ref=${data.data.booking_reference}`;
      }, 700);
    } else {
      showToast(data.error || 'Payment failed. Please try again.', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }
  } catch (err) {
    console.error('Booking submission error:', err);
    showToast('A network error occurred. Please try again.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
};

// Modal for Accommodation details
window.openAccommodationModal = function(accId) {
  const acc = appState.accommodations.find(a => a.id === accId);
  if (!acc) return;

  const modal = document.getElementById('accModal');
  const modalContent = document.getElementById('accModalContent');
  if (!modal || !modalContent) return;

  modalContent.innerHTML = `
    <div class="relative h-64 overflow-hidden rounded-t-2xl">
      <img src="${acc.image_url}" alt="${acc.name}" class="w-full h-full object-cover" />
      <div class="absolute top-4 right-4">
        <button onclick="closeAccommodationModal()" class="w-9 h-9 rounded-full bg-night-900/70 hover:bg-night-900 text-white flex items-center justify-center font-bold text-lg shadow-lg">✕</button>
      </div>
      <div class="absolute bottom-4 left-4 bg-night-900/80 backdrop-blur text-white text-xs px-3 py-1 rounded-lg">
        Sleeps up to ${acc.max_capacity} Guests • Total Units: ${acc.total_units}
      </div>
    </div>
    <div class="p-6">
      <h3 class="text-2xl font-bold text-slate-800">${acc.name}</h3>
      <p class="text-sm text-teal-700 font-medium mt-1">${acc.tagline || ''}</p>
      <p class="text-sm text-slate-600 mt-3 leading-relaxed">${acc.description}</p>

      <div class="mt-6">
        <h4 class="text-xs uppercase font-bold text-slate-400 tracking-wider">Tariff Structure</h4>
        <div class="grid grid-cols-3 gap-3 mt-2 text-center">
          <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
            <span class="block text-xs font-semibold text-emerald-800">Weekday</span>
            <span class="text-base font-bold text-emerald-950">${formatCurrency(acc.weekday_rate)}</span>
            <span class="text-[10px] text-emerald-600 block">Mon - Thu</span>
          </div>
          <div class="p-3 bg-blue-50 rounded-xl border border-blue-100">
            <span class="block text-xs font-semibold text-blue-800">Weekend</span>
            <span class="text-base font-bold text-blue-950">${formatCurrency(acc.weekend_rate)}</span>
            <span class="text-[10px] text-blue-600 block">Fri - Sun</span>
          </div>
          <div class="p-3 bg-amber-50 rounded-xl border border-amber-100">
            <span class="block text-xs font-semibold text-amber-800">Special Event</span>
            <span class="text-base font-bold text-amber-950">${formatCurrency(acc.special_event_rate)}</span>
            <span class="text-[10px] text-amber-600 block">Festivals</span>
          </div>
        </div>
      </div>

      <div class="mt-6">
        <h4 class="text-xs uppercase font-bold text-slate-400 tracking-wider">Amenities & Luxuries</h4>
        <div class="grid grid-cols-2 gap-2 mt-2">
          ${(acc.amenities || []).map(a => `
            <div class="flex items-center gap-2 text-xs text-slate-700">
              <span class="text-teal-600 font-bold">✓</span>
              <span>${a}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
        <button onclick="closeAccommodationModal()" class="text-sm font-medium text-slate-500 hover:text-slate-800">Close</button>
        <button onclick="selectAccommodation(${acc.id}); closeAccommodationModal();" class="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-xl shadow-md transition">
          Choose This Stay
        </button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeAccommodationModal = function() {
  const modal = document.getElementById('accModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
};

// Toast notifications
function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  let bg = 'bg-slate-900 text-white';
  if (type === 'success') bg = 'bg-emerald-700 text-white';
  if (type === 'error') bg = 'bg-rose-700 text-white';
  if (type === 'warning') bg = 'bg-amber-600 text-white';

  toast.className = `${bg} px-4 py-3 rounded-xl shadow-xl text-sm font-medium transition-all transform duration-300 flex items-center gap-3`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" class="text-white/70 hover:text-white ml-auto">✕</button>
  `;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
