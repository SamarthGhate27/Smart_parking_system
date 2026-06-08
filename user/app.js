/* ==========================================================================
   PARKPRO.IN FRONTEND ENGINE
   State Management, Live Timers, Simulated Gateways & Interactive Maps
   ========================================================================== */

// 1. GLOBAL STATE DEFINITION
let state = {
  slots: {},       // Keyed by Floor (1-4). Value: Array of slot objects
  rates: {         // Hourly rates in INR
    Car: 50,
    Bike: 20
  },
  capacities: {    // Slots of each type per floor
    Car: 40,
    Bike: 40
  },
  transactions: [], // History of checkouts
  activeRole: 'Operator', // Active console view role
  myPlateNumber: ''       // Guest plate number currently tracked
};

// ==========================================================================
// SUPABASE CLOUD CONFIGURATION
// Toggle USE_SUPABASE to true once you set your project URL and Key below!
// ==========================================================================
const USE_SUPABASE = true;
const SUPABASE_URL = "https://cjjmyumkkpbtzsgmdgov.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqam15dW1ra3BidHpzZ21kZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMzAyMTQsImV4cCI6MjA5NTgwNjIxNH0.t4aRaGIpE5t_srEMT6DNy5HGJ5NaVNAE9tD0oYTQfq8";

let supabaseClient = null;
if (USE_SUPABASE && typeof supabase !== 'undefined') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// State tracker for active operations
let activeFloor = "1";
let activeFilter = "all";
let currentCheckoutSlot = null; // Stores slot object being checked out
let timeTravelOffset = 0;       // Simulated hours added to parking time

// SVGs definition for offline rendering
const SVGS = {
  Car: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`,
  Bike: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 12V8h2"/></svg>`,
  Clock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  User: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
};

// ==========================================================================
// 2. CORE DATABASE ENGINE & STORAGE
// ==========================================================================

// Initialize a blank database of slots matching capacities
function createBlankDatabase() {
  state.slots = {};
  for (let f = 1; f <= 4; f++) {
    state.slots[f] = [];
    
    // Add Car slots
    for (let c = 1; c <= state.capacities.Car; c++) {
      const paddedNum = String(c).padStart(2, '0');
      state.slots[f].push({
        id: `${f}-C${paddedNum}`,
        floor: String(f),
        number: `C${paddedNum}`,
        type: 'Car',
        status: 'Available',
        vehicle: null,
        reservation: null
      });
    }
    
    // Add Bike slots
    for (let b = 1; b <= state.capacities.Bike; b++) {
      const paddedNum = String(b).padStart(2, '0');
      state.slots[f].push({
        id: `${f}-B${paddedNum}`,
        floor: String(f),
        number: `B${paddedNum}`,
        type: 'Bike',
        status: 'Available',
        vehicle: null,
        reservation: null
      });
    }
  }
}

// Load database from LocalStorage or Supabase
async function loadDatabase() {
  const isUserFolder = window.location.pathname.toLowerCase().includes('/user/');
  const defaultRole = isUserFolder ? 'Customer' : 'Operator';

  if (USE_SUPABASE && supabaseClient) {
    try {
      // 1. Fetch Pricing Rates
      const { data: ratesData, error: ratesErr } = await supabaseClient
        .from('parking_rates')
        .select('*');
      if (!ratesErr && ratesData) {
        ratesData.forEach(r => {
          state.rates[r.type] = Number(r.hourly_rate);
        });
      }

      // 2. Fetch Completed Transactions
      const { data: transData, error: transErr } = await supabaseClient
        .from('parking_transactions')
        .select('*')
        .order('created_at', { ascending: true });
      if (!transErr && transData) {
        state.transactions = transData.map(t => ({
          receiptId: t.receipt_id,
          plate: t.plate,
          type: t.type,
          floor: t.floor,
          slotNumber: t.slot_number,
          duration: t.duration,
          amountPaid: Number(t.amount_paid),
          paymentMethod: t.payment_method,
          checkOutTime: t.check_out_time
        }));
      }

      // 3. Fetch Parking Slots
      const { data: slotsData, error: slotsErr } = await supabaseClient
        .from('parking_slots')
        .select('*')
        .order('id', { ascending: true });
        
      if (!slotsErr && slotsData && slotsData.length > 0) {
        state.slots = {};
        for (let f = 1; f <= 4; f++) {
          state.slots[f] = [];
        }
        slotsData.forEach(s => {
          state.slots[s.floor].push({
            id: s.id,
            floor: s.floor,
            number: s.number,
            type: s.type,
            status: s.status,
            vehicle: s.vehicle,
            reservation: s.reservation
          });
        });
      } else {
        // Table is empty, try to migrate from LocalStorage!
        const localData = localStorage.getItem('parkpro_db');
        if (localData) {
          try {
            const parsed = JSON.parse(localData);
            if (parsed.slots && parsed.capacities) {
              state = parsed;
              console.log("Migrating data from LocalStorage to Supabase!");
            } else {
              createBlankDatabase();
            }
          } catch (e) {
            createBlankDatabase();
          }
        } else {
          createBlankDatabase();
        }
        
        const allSlots = [];
        for (let f = 1; f <= 4; f++) {
          allSlots.push(...state.slots[f]);
        }
        
        const { error: insErr } = await supabaseClient.from('parking_slots').insert(allSlots.map(s => ({
          id: s.id,
          floor: String(s.floor),
          number: String(s.number),
          type: s.type,
          status: s.status,
          vehicle: s.vehicle || null,
          reservation: s.reservation || null
        })));
        if (insErr) {
          console.error("Supabase Slots Migration Error:", insErr);
          alert("Failed to migrate slots to Supabase: " + insErr.message);
        }

        if (state.transactions && state.transactions.length > 0) {
          const { error: trErr } = await supabaseClient.from('parking_transactions').insert(state.transactions.map(t => ({
            receipt_id: String(t.receiptId),
            plate: String(t.plate),
            type: String(t.type),
            floor: String(t.floor),
            slot_number: String(t.slotNumber),
            duration: String(t.duration),
            amount_paid: Number(t.amountPaid),
            payment_method: String(t.paymentMethod),
            check_out_time: new Date(t.checkOutTime).toISOString()
          })));
          if (trErr) {
            console.error("Supabase Transactions Migration Error:", trErr);
            alert("Failed to migrate transactions: " + trErr.message);
          }
        }
      }
      
      state.activeRole = defaultRole;
      state.myPlateNumber = '';
      renderAll();
      return;
    } catch (e) {
      console.error("Supabase load database error, falling back to localstorage", e);
    }
  }

  // LocalStorage Fallback Flow
  const localData = localStorage.getItem('parkpro_db');
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      if (parsed.slots && parsed.rates && parsed.capacities && parsed.transactions) {
        state = parsed;
        state.activeRole = defaultRole;
        state.myPlateNumber = '';
        renderAll();
        return;
      }
    } catch (e) {
      console.error("Localstorage parse error, resetting", e);
    }
  }
  createBlankDatabase();
  state.activeRole = defaultRole;
  state.myPlateNumber = '';
  saveDatabase();
  renderAll();
}

// Save database to LocalStorage
function saveDatabase() {
  if (!USE_SUPABASE) {
    localStorage.setItem('parkpro_db', JSON.stringify(state));
  }
}

// Reset Database completely
async function resetDatabase() {
  if (USE_SUPABASE && supabaseClient) {
    try {
      await supabaseClient.from('parking_transactions').delete().neq('receipt_id', 'FORCE_DELETE_ALL');
      await supabaseClient.from('parking_slots').update({
        status: 'Available',
        vehicle: null,
        reservation: null
      }).neq('id', 'FORCE_RESET_ALL');
    } catch (e) {
      console.error("Supabase resetDatabase error", e);
    }
  }

  createBlankDatabase();
  state.transactions = [];
  saveDatabase();
  renderAll();
  showNotification("Database successfully wiped and reset to clean defaults.");
}

// ==========================================================================
// 3. UI RENDERING & METRICS
// ==========================================================================

// Main Orchestrated Render
function renderAll() {
  renderMetrics();
  renderFloorMap(activeFloor);
  
  // Update badges on floor selectors
  for (let f = 1; f <= 4; f++) {
    const availCount = state.slots[f].filter(s => s.status === 'Available').length;
    const badgeEl = document.getElementById(`floor-badge-${f}`);
    if (badgeEl) {
      badgeEl.textContent = `${availCount} Available`;
    }
  }
}

// Calculate and render all metrics
function renderMetrics() {
  let totalAvailable = 0;
  let totalOccupied = 0;
  let totalReserved = 0;
  
  for (let f = 1; f <= 4; f++) {
    state.slots[f].forEach(slot => {
      if (slot.status === 'Available') totalAvailable++;
      else if (slot.status === 'Occupied') totalOccupied++;
      else if (slot.status === 'Reserved') totalReserved++;
    });
  }
  
  const totalSlots = totalAvailable + totalOccupied + totalReserved;
  const occupancyPct = totalSlots > 0 ? Math.round((totalOccupied / totalSlots) * 100) : 0;
  
  // Set UI elements
  const availEl = document.getElementById('metric-available');
  if (availEl) availEl.textContent = totalAvailable;
  
  const resEl = document.getElementById('metric-reserved');
  if (resEl) resEl.textContent = totalReserved;
  
  // Update Master SVG Circular Gauge
  const pctEl = document.getElementById('occupancy-pct');
  if (pctEl) pctEl.textContent = `${occupancyPct}%`;
  
  const gaugeCircle = document.getElementById('occupancy-gauge');
  if (gaugeCircle) {
    // 264 is the max stroke-dasharray circumfrence for radius 42
    const maxDash = 264;
    const offset = maxDash - (maxDash * occupancyPct) / 100;
    gaugeCircle.style.strokeDashoffset = offset;
  }
}

// Render dynamic slot map
function renderFloorMap(floor) {
  const container = document.getElementById('slots-grid-container');
  container.innerHTML = '';
  
  document.getElementById('current-floor-title').textContent = `Floor ${floor} Layout`;
  
  const floorSlots = state.slots[floor] || [];
  
  // Filter slots
  let filteredSlots = floorSlots;
  if (activeFilter === 'Car' || activeFilter === 'Bike') {
    filteredSlots = floorSlots.filter(s => s.type === activeFilter);
  } else if (activeFilter !== 'all') {
    // Available, Occupied, Reserved
    filteredSlots = floorSlots.filter(s => s.status === activeFilter);
  }
  
  // Update header count badges
  const carCount = floorSlots.filter(s => s.type === 'Car').length;
  const bikeCount = floorSlots.filter(s => s.type === 'Bike').length;
  document.getElementById('floor-car-stats').textContent = `${carCount} Cars`;
  document.getElementById('floor-bike-stats').textContent = `${bikeCount} Bikes`;

  if (filteredSlots.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1/-1; padding: 4rem;">No slots matches the current filter.</div>`;
    return;
  }

  // Draw slots
  filteredSlots.forEach(slot => {
    const block = document.createElement('div');
    block.className = `slot-block ${slot.status.toLowerCase()}`;
    
    // Check if it's the customer's own tracked spot
    const isMine = (state.activeRole === 'Customer') && (
      (slot.vehicle && slot.vehicle.plate === state.myPlateNumber) ||
      (slot.reservation && slot.reservation.plate === state.myPlateNumber)
    );

    if (isMine) {
      block.classList.add('is-mine');
    }
    
    // Timer checks
    let timerHTML = '';
    let isBuffer = false;
    
    if (slot.status === 'Occupied' && slot.vehicle) {
      const checkinTime = new Date(slot.vehicle.checkInTime);
      const now = new Date();
      const elapsedSec = Math.floor((now - checkinTime) / 1000);
      
      if (elapsedSec <= 30) {
        isBuffer = true;
        block.classList.add('buffer-active');
      }
      
      // Calculate display duration
      const hours = Math.floor(elapsedSec / 3600);
      const minutes = Math.floor((elapsedSec % 3600) / 60);
      const seconds = elapsedSec % 60;
      
      const durationStr = `${hours}h ${minutes}m ${seconds}s`;
      
      // Mask timer for others in Customer mode
      if (state.activeRole === 'Operator' || isMine) {
        timerHTML = `
          <div class="slot-timer">
            <span class="slot-timer-dot"></span>
            <span>${durationStr}</span>
          </div>`;
      }
    }

    const typeIcon = slot.type === 'Car' ? SVGS.Car : SVGS.Bike;
    
    // Mask badge state in Customer mode for other drivers
    let badgeText = isBuffer ? 'Buffer' : slot.status;
    if (state.activeRole === 'Customer' && !isMine && slot.status === 'Occupied') {
      badgeText = 'Occupied';
    }
    
    let mainLabelHTML = '';
    if (slot.status === 'Occupied' && slot.vehicle) {
      if (state.activeRole === 'Operator' || isMine) {
        mainLabelHTML = `<div class="slot-vehicle-tag">${slot.vehicle.plate}</div>`;
      } else {
        mainLabelHTML = `<div class="slot-vehicle-tag" style="opacity: 0.5;">🚫 OCCUPIED</div>`;
      }
    } else if (slot.status === 'Reserved' && slot.reservation) {
      if (state.activeRole === 'Operator' || isMine) {
        mainLabelHTML = `<div class="slot-vehicle-tag" title="Res: ${slot.reservation.name}">${slot.reservation.plate}</div>`;
      } else {
        mainLabelHTML = `<div class="slot-vehicle-tag" style="opacity: 0.5;">📅 RESERVED</div>`;
      }
    } else {
      mainLabelHTML = `<div class="slot-vehicle-tag" style="opacity: 0.35;">${slot.type} Spot</div>`;
    }

    block.innerHTML = `
      <div class="slot-block-top">
        <span class="slot-id">${slot.number}</span>
        <span class="slot-icon">${typeIcon}</span>
      </div>
      ${mainLabelHTML}
      <div class="slot-block-top" style="align-items: flex-end;">
        <span class="slot-badge-status">${badgeText}</span>
        ${timerHTML}
      </div>
    `;

    // Click handler to open slot interaction
    block.addEventListener('click', () => handleSlotClick(slot));
    
    container.appendChild(block);
  });
}

// Render dynamic transaction logs table
function renderTransactionsTable() {
  const tbody = document.getElementById('transactions-tbody');
  tbody.innerHTML = '';
  
  if (state.transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No transactions recorded today yet. Check-out a vehicle to record a payment.</td></tr>`;
    return;
  }

  // Render transactions in reverse chronological order
  [...state.transactions].reverse().forEach(t => {
    const row = document.createElement('tr');
    const formattedDate = new Date(t.checkOutTime).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    
    row.innerHTML = `
      <td><strong>${t.receiptId}</strong></td>
      <td><span class="highlighted" style="font-family: monospace; font-weight: 700; text-transform: uppercase;">${t.plate}</span></td>
      <td>${t.type === 'Car' ? '🚗 Car' : '🏍️ Bike'}</td>
      <td><span class="text-primary" style="font-weight: 700;">F${t.floor}-${t.slotNumber}</span></td>
      <td>${t.duration}</td>
      <td><strong class="text-gold">₹${t.amountPaid}</strong></td>
      <td><span class="floor-badge" style="background: rgba(255,255,255,0.05); color: white; border-color: var(--border-color);">${t.paymentMethod}</span></td>
      <td style="color: var(--text-secondary); font-size: 0.75rem;">${formattedDate}</td>
    `;
    tbody.appendChild(row);
  });
}

// Search utility
function handleGlobalSearch(query) {
  query = query.toUpperCase().trim();
  
  if (!query) {
    renderAll();
    return;
  }

  // Find matches and render them highlighting
  // Search covers plate numbers, customer names
  let matchedSlots = [];
  for (let f = 1; f <= 4; f++) {
    state.slots[f].forEach(slot => {
      let isMatch = false;
      if (slot.id.includes(query) || slot.number.includes(query)) {
        isMatch = true;
      }
      if (slot.vehicle && slot.vehicle.plate.toUpperCase().includes(query)) {
        isMatch = true;
      }
      if (slot.reservation) {
        if (slot.reservation.plate.toUpperCase().includes(query) || 
            slot.reservation.name.toUpperCase().includes(query)) {
          isMatch = true;
        }
      }
      if (isMatch) {
        matchedSlots.push(slot);
      }
    });
  }

  // Render matches in map container instantly by clearing it and inserting
  const container = document.getElementById('slots-grid-container');
  container.innerHTML = '';
  document.getElementById('current-floor-title').textContent = `Search Matches (${matchedSlots.length})`;
  
  if (matchedSlots.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1/-1; padding: 4rem;">No matching parking records or slots found.</div>`;
    return;
  }

  matchedSlots.forEach(slot => {
    const block = document.createElement('div');
    block.className = `slot-block ${slot.status.toLowerCase()}`;
    if (slot.status === 'Occupied' && slot.vehicle) {
      const checkinTime = new Date(slot.vehicle.checkInTime);
      const now = new Date();
      const elapsedSec = Math.floor((now - checkinTime) / 1000);
      if (elapsedSec <= 30) block.className += ' buffer-active';
    }
    
    const typeIcon = slot.type === 'Car' ? SVGS.Car : SVGS.Bike;
    let mainLabelHTML = '';
    if (slot.status === 'Occupied' && slot.vehicle) {
      mainLabelHTML = `<div class="slot-vehicle-tag">${slot.vehicle.plate}</div>`;
    } else if (slot.status === 'Reserved' && slot.reservation) {
      mainLabelHTML = `<div class="slot-vehicle-tag">Res: ${slot.reservation.name}</div>`;
    } else {
      mainLabelHTML = `<div class="slot-vehicle-tag" style="opacity: 0.35;">${slot.type} Spot</div>`;
    }

    block.innerHTML = `
      <div class="slot-block-top">
        <span class="slot-id">F${slot.floor}-${slot.number}</span>
        <span class="slot-icon">${typeIcon}</span>
      </div>
      ${mainLabelHTML}
      <div class="slot-block-top" style="align-items: flex-end;">
        <span class="slot-badge-status">${slot.status}</span>
      </div>
    `;
    block.addEventListener('click', () => {
      // Switch active floor to the matched slot floor, then click it
      activeFloor = slot.floor;
      // update tab class active
      document.querySelectorAll('.floor-tab').forEach(tab => {
        if (tab.dataset.floor === activeFloor) tab.classList.add('active');
        else tab.classList.remove('active');
      });
      handleSlotClick(slot);
    });
    container.appendChild(block);
  });
}

// Populate the Slot assignment select list in sidebar
function populateFormSlotDropdown() {
  const type = document.getElementById('vehicle-type').value;
  const floor = document.getElementById('select-floor').value;
  const slotSelect = document.getElementById('select-slot');
  
  slotSelect.innerHTML = '<option value="auto">🔥 Auto-Optimal</option>';
  
  const floorSlots = state.slots[floor] || [];
  const matches = floorSlots.filter(s => s.type === type && s.status === 'Available');
  
  matches.forEach(slot => {
    const opt = document.createElement('option');
    opt.value = slot.id;
    opt.textContent = `${slot.number} (Available)`;
    slotSelect.appendChild(opt);
  });
}

// ==========================================================================
// 4. TRANSACTION ENGINE & WORKFLOWS
// ==========================================================================

// Handle Slot Clicking Map Events
function handleSlotClick(slot) {
  const isMine = (slot.vehicle && slot.vehicle.plate === state.myPlateNumber) ||
                 (slot.reservation && slot.reservation.plate === state.myPlateNumber);

  // Secure Role Gate: Customers can only interact with Available slots or their OWN tracked slots
  if (state.activeRole === 'Customer' && slot.status !== 'Available' && !isMine) {
    return;
  }

  if (slot.status === 'Available') {
    // Open check-in modal
    document.getElementById('modal-slot-id').value = slot.id;
    document.getElementById('modal-slot-display').textContent = `Floor ${slot.floor} - ${slot.number}`;
    document.getElementById('modal-slot-type-display').textContent = `${slot.type === 'Car' ? '🚗 Car' : '🏍️ Bike'} Exclusive`;
    document.getElementById('modal-vehicle-plate').value = '';
    document.getElementById('modal-customer-name').value = '';
    document.getElementById('modal-action-type').value = 'checkin';
    document.getElementById('modal-reservation-name-group').style.display = 'none';
    
    // Automatically match vehicle type input
    openModal('checkin-modal');
  } else if (slot.status === 'Reserved') {
    // The slot is reserved. Let's ask if they want to check-in the vehicle now or cancel the reservation!
    if (confirm(`This slot is reserved for ${slot.reservation.name} (${slot.reservation.plate}). \n\nClick "OK" to check-in this vehicle now. \nClick "Cancel" to clear this reservation.`)) {
      // Check in the reserved vehicle
      checkInVehicle(slot.reservation.plate, slot.type, slot.id);
      // Clear reservation details
      slot.reservation = null;
      saveDatabase();
      renderAll();
      showNotification("Reserved vehicle checked-in successfully.");
    } else {
      // Clear reservation
      slot.status = 'Available';
      slot.reservation = null;
      saveDatabase();
      renderAll();
      showNotification("Reservation cancelled.");
    }
  } else if (slot.status === 'Occupied') {
    // Initiate Checkout Billing Process
    initiateCheckout(slot);
  }
}

// Internal Check-In Action
async function checkInVehicle(plate, type, slotId) {
  // Find slot
  let slotObj = null;
  for (let f = 1; f <= 4; f++) {
    const found = state.slots[f].find(s => s.id === slotId);
    if (found) {
      slotObj = found;
      break;
    }
  }
  
  if (!slotObj) return false;
  
  const upperPlate = plate.toUpperCase().trim();
  slotObj.status = 'Occupied';
  slotObj.vehicle = {
    plate: upperPlate,
    type: type,
    checkInTime: new Date().toISOString()
  };
  
  // If checked in under Customer Role, automatically start self-tracking
  if (state.activeRole === 'Customer') {
    state.myPlateNumber = upperPlate;
    const trackInput = document.getElementById('cust-track-plate');
    if (trackInput) trackInput.value = upperPlate;
    const clearBtn = document.getElementById('btn-cust-clear-track');
    if (clearBtn) clearBtn.style.display = 'block';
  }
  
  if (USE_SUPABASE && supabaseClient) {
    try {
      await supabaseClient
        .from('parking_slots')
        .update({
          status: 'Occupied',
          vehicle: slotObj.vehicle
        })
        .eq('id', slotId);
    } catch (e) {
      console.error("Supabase checkInVehicle error", e);
    }
  }
  
  saveDatabase();
  renderAll();
  return true;
}

// Internal Reserve Action
async function reserveSlot(slotId, plate, name) {
  let slotObj = null;
  for (let f = 1; f <= 4; f++) {
    const found = state.slots[f].find(s => s.id === slotId);
    if (found) {
      slotObj = found;
      break;
    }
  }
  
  if (!slotObj) return false;
  
  const upperPlate = plate.toUpperCase().trim();
  slotObj.status = 'Reserved';
  slotObj.reservation = {
    plate: upperPlate,
    name: name.trim() || 'Valet Guest'
  };
  
  // If reserved under Customer Role, automatically start self-tracking
  if (state.activeRole === 'Customer') {
    state.myPlateNumber = upperPlate;
    const trackInput = document.getElementById('cust-track-plate');
    if (trackInput) trackInput.value = upperPlate;
    const clearBtn = document.getElementById('btn-cust-clear-track');
    if (clearBtn) clearBtn.style.display = 'block';
  }
  
  if (USE_SUPABASE && supabaseClient) {
    try {
      await supabaseClient
        .from('parking_slots')
        .update({
          status: 'Reserved',
          reservation: slotObj.reservation
        })
        .eq('id', slotId);
    } catch (e) {
      console.error("Supabase reserveSlot error", e);
    }
  }
  
  saveDatabase();
  renderAll();
  return true;
}

// Calculate dynamic parking fee
function calculateParkingFee(checkInTimeISO, vehicleType, customOffsetHours = 0) {
  const checkinTime = new Date(checkInTimeISO);
  const now = new Date();
  
  // Calculate elapsed MS, adding our time travel offset if active
  let elapsedMs = (now - checkinTime);
  if (customOffsetHours > 0) {
    elapsedMs += (customOffsetHours * 3600 * 1000);
  }
  
  const elapsedSec = Math.floor(elapsedMs / 1000);
  
  // 30-Second Buffer Period: FREE
  if (elapsedSec <= 30) {
    return {
      fee: 0,
      elapsedSec: elapsedSec,
      isBuffer: true,
      hoursBilled: 0
    };
  }
  
  // Calculate Billed Hours
  const elapsedHours = elapsedMs / (3600 * 1000);
  const hoursBilled = Math.ceil(elapsedHours); // Standard rounding-up rule
  const hourlyRate = state.rates[vehicleType];
  const totalCost = hoursBilled * hourlyRate;
  
  return {
    fee: totalCost,
    elapsedSec: elapsedSec,
    isBuffer: false,
    hoursBilled: hoursBilled
  };
}

// Prepare checkout screen values
function initiateCheckout(slot) {
  currentCheckoutSlot = slot;
  timeTravelOffset = 0; // Reset offset on new checkout
  
  updateCheckoutDetails();
  
  // Setup UPI dynamic value
  updatePaymentGatewayDisplay();
  
  // Reset card inputs
  document.getElementById('card-payment-form').reset();
  document.getElementById('credit-card-3d').classList.remove('flipped');
  document.getElementById('card-num-disp').textContent = '•••• •••• •••• ••••';
  document.getElementById('card-holder-disp').textContent = 'YOUR NAME HERE';
  document.getElementById('card-exp-disp').textContent = 'MM/YY';
  document.getElementById('card-cvv-disp').textContent = '•••';

  // Open the checkout modal
  openModal('checkout-modal');
}

// Update billing elements dynamically in real-time
function updateCheckoutDetails() {
  if (!currentCheckoutSlot || !currentCheckoutSlot.vehicle) return;
  
  const vehicle = currentCheckoutSlot.vehicle;
  const rates = state.rates;
  
  // Compute fees including offset
  const bill = calculateParkingFee(vehicle.checkInTime, vehicle.type, timeTravelOffset);
  
  // Set UI elements in receipt summary
  document.getElementById('inv-plate').textContent = vehicle.plate;
  document.getElementById('inv-type').textContent = vehicle.type === 'Car' ? '🚗 Car' : '🏍️ Bike';
  document.getElementById('inv-slot').textContent = `F${currentCheckoutSlot.floor}-${currentCheckoutSlot.number}`;
  
  const checkinLocale = new Date(vehicle.checkInTime).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  
  // Calculate checkout time including travel
  const outTime = new Date(new Date().getTime() + (timeTravelOffset * 3600 * 1000));
  const checkoutLocale = outTime.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  
  document.getElementById('inv-checkin').textContent = checkinLocale;
  document.getElementById('inv-checkout').textContent = checkoutLocale;
  
  // Format Duration string
  const h = Math.floor(bill.elapsedSec / 3600);
  const m = Math.floor((bill.elapsedSec % 3600) / 60);
  const s = bill.elapsedSec % 60;
  document.getElementById('inv-duration').textContent = `${h}h ${m}m ${s}s`;
  
  // Buffer badge
  const bufferBadge = document.getElementById('inv-buffer');
  if (bill.isBuffer) {
    bufferBadge.innerHTML = '🟢 Active (&lt;30s Free)';
    bufferBadge.className = 'text-green font-bold';
    document.getElementById('inv-buffer-row').style.display = 'flex';
  } else {
    bufferBadge.innerHTML = '🔴 Expired (Hourly Rates apply)';
    bufferBadge.className = 'text-red font-bold';
    document.getElementById('inv-buffer-row').style.display = 'flex';
  }

  // Tariff display
  document.getElementById('inv-rate-calc').textContent = `₹${rates[vehicle.type]}/hour × ${bill.hoursBilled} hr(s)`;
  document.getElementById('inv-amount').textContent = bill.fee;
  
  // Gateway specific prompts
  document.getElementById('upi-pay-val').textContent = bill.fee;
  document.getElementById('card-pay-val').textContent = bill.fee;
}

// Simulator Trigger
function simulateTime(hours) {
  timeTravelOffset += hours;
  updateCheckoutDetails();
}

// Cash screen refund dynamic calculation
function updateCashRefund() {
  const total = parseFloat(document.getElementById('cash-amt-invoice').textContent) || 0;
  const received = parseFloat(document.getElementById('cash-given').value) || 0;
  const change = Math.max(0, received - total);
  document.getElementById('cash-change').textContent = change;
}

// Handle payment tabs selection
function updatePaymentGatewayDisplay() {
  // Update inputs logic
  document.querySelectorAll('.pay-tab').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.pay-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.pay-method-panel').forEach(p => p.classList.remove('active'));
      
      this.classList.add('active');
      const method = this.dataset.paymethod;
      document.getElementById(`pay-panel-${method}`).classList.add('active');
    });
  });
}

// Complete payment and generate printed bill
async function completePayment(paymentMethod) {
  if (!currentCheckoutSlot || !currentCheckoutSlot.vehicle) return;
  
  const vehicle = currentCheckoutSlot.vehicle;
  const bill = calculateParkingFee(vehicle.checkInTime, vehicle.type, timeTravelOffset);
  
  // Generate a random receipt ID
  const randId = `PP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  
  // Format Duration string
  const h = Math.floor(bill.elapsedSec / 3600);
  const m = Math.floor((bill.elapsedSec % 3600) / 60);
  const s = bill.elapsedSec % 60;
  const durationStr = `${h}h ${m}m ${s}s`;

  // Create Transaction Entry
  const transaction = {
    receiptId: randId,
    plate: vehicle.plate,
    type: vehicle.type,
    floor: currentCheckoutSlot.floor,
    slotNumber: currentCheckoutSlot.number,
    duration: durationStr,
    amountPaid: bill.fee,
    paymentMethod: paymentMethod,
    checkOutTime: new Date(new Date().getTime() + (timeTravelOffset * 3600 * 1000)).toISOString()
  };

  if (USE_SUPABASE && supabaseClient) {
    try {
      // 1. Insert Transaction record
      await supabaseClient
        .from('parking_transactions')
        .insert({
          receipt_id: transaction.receiptId,
          plate: transaction.plate,
          type: transaction.type,
          floor: transaction.floor,
          slot_number: transaction.slotNumber,
          duration: transaction.duration,
          amount_paid: transaction.amountPaid,
          payment_method: transaction.paymentMethod,
          check_out_time: transaction.checkOutTime
        });

      // 2. Wipe Slot status to Available
      await supabaseClient
        .from('parking_slots')
        .update({
          status: 'Available',
          vehicle: null,
          reservation: null
        })
        .eq('id', currentCheckoutSlot.id);
    } catch (e) {
      console.error("Supabase completePayment error", e);
    }
  }

  // Record Transaction
  state.transactions.push(transaction);
  
  // Clear Slot State
  currentCheckoutSlot.status = 'Available';
  currentCheckoutSlot.vehicle = null;
  
  // Save State
  saveDatabase();
  
  // Close checkout modal
  closeModal('checkout-modal');
  
  // Prepare Printable Receipt elements
  document.getElementById('rec-id').textContent = transaction.receiptId;
  document.getElementById('rec-date').textContent = new Date(transaction.checkOutTime).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  document.getElementById('rec-plate').textContent = transaction.plate;
  document.getElementById('rec-type').textContent = transaction.type.toUpperCase();
  document.getElementById('rec-slot').textContent = `F${transaction.floor}-${transaction.slotNumber}`;
  
  const checkinLocale = new Date(vehicle.checkInTime).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const checkoutLocale = new Date(transaction.checkOutTime).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  
  document.getElementById('rec-checkin').textContent = checkinLocale;
  document.getElementById('rec-checkout').textContent = checkoutLocale;
  document.getElementById('rec-duration').textContent = `${h} hours ${m} minutes ${s} seconds`;
  document.getElementById('rec-tariff').textContent = `₹${state.rates[transaction.type]}/hour × ${bill.hoursBilled} hr(s)`;
  document.getElementById('rec-amount').textContent = transaction.amountPaid;
  document.getElementById('rec-paymethod').textContent = transaction.paymentMethod;
  document.getElementById('rec-cashier').textContent = state.activeRole === 'Operator' ? 'Administrator (Owner)' : 'Customer Self-Service';
  
  // Show Receipt Modal
  openModal('receipt-modal');
  
  // Refresh views
  renderAll();
  
  showNotification(`Payment of ₹${transaction.amountPaid} processed successfully via ${paymentMethod}.`);
  
  // Reset global pointers
  currentCheckoutSlot = null;
}

// Print trigger
function printReceipt() {
  window.print();
}

// ==========================================================================
// 5. DEMO STATE GENERATOR (High Fidelity Populate)
// ==========================================================================
function generateDemoData() {
  // Clear previous completely
  createBlankDatabase();
  state.transactions = [];

  const plates = [
    "DL 3C AY 4912", "MH 12 QW 8821", "KA 03 MZ 0998", "HR 26 BB 7812", 
    "UP 16 CG 1102", "KA 51 AJ 3345", "DL 1A W 9912", "GJ 01 XX 5567",
    "MH 02 AA 1234", "DL 4C AC 5678", "HR 51 ZZ 9900", "MH 14 BK 4321",
    "UP 32 HY 8765", "KA 05 MN 2468", "GJ 03 RT 1357", "DL 9C AB 4455"
  ];
  
  const resNames = [
    "Aarav Mehta", "Priyanka Sen", "Vikram Rathore", "Neha Gupta", 
    "Amit Sharma", "Deepika Padukone", "Ranveer Singh", "Virat Kohli"
  ];

  const now = new Date();

  // Populate Active vehicles with varying duration offsets to test billing rates
  for (let f = 1; f <= 4; f++) {
    // Generate ~5-8 occupied cars per floor
    const carSlots = state.slots[f].filter(s => s.type === 'Car');
    const numCars = 5 + Math.floor(Math.random() * 5);
    for (let c = 0; c < numCars; c++) {
      const slot = carSlots[c];
      const checkinHrsAgo = Math.random() * 26; // Random check-in up to 26 hours ago
      const checkinTime = new Date(now.getTime() - (checkinHrsAgo * 3600 * 1000));
      
      slot.status = 'Occupied';
      slot.vehicle = {
        plate: plates[Math.floor(Math.random() * plates.length)],
        type: 'Car',
        checkInTime: checkinTime.toISOString()
      };
    }

    // Generate ~5-8 occupied bikes per floor
    const bikeSlots = state.slots[f].filter(s => s.type === 'Bike');
    const numBikes = 5 + Math.floor(Math.random() * 5);
    for (let b = 0; b < numBikes; b++) {
      const slot = bikeSlots[b];
      const checkinHrsAgo = Math.random() * 26;
      const checkinTime = new Date(now.getTime() - (checkinHrsAgo * 3600 * 1000));
      
      slot.status = 'Occupied';
      slot.vehicle = {
        plate: plates[Math.floor(Math.random() * plates.length)].replace("DL", "UP"),
        type: 'Bike',
        checkInTime: checkinTime.toISOString()
      };
    }

    // Generate 2 reservations per floor
    const reservedCarSlot = carSlots[numCars + 1];
    if (reservedCarSlot) {
      reservedCarSlot.status = 'Reserved';
      reservedCarSlot.reservation = {
        plate: plates[Math.floor(Math.random() * plates.length)],
        name: resNames[Math.floor(Math.random() * resNames.length)]
      };
    }

    const reservedBikeSlot = bikeSlots[numBikes + 1];
    if (reservedBikeSlot) {
      reservedBikeSlot.status = 'Reserved';
      reservedBikeSlot.reservation = {
        plate: plates[Math.floor(Math.random() * plates.length)],
        name: resNames[Math.floor(Math.random() * resNames.length)]
      };
    }
  }

  // Generate ~10 historical finished transactions to fill transaction log beautifully
  const paymentMethods = ["UPI / QR Code", "Credit Card", "Cash"];
  for (let i = 1; i <= 10; i++) {
    const isCar = Math.random() > 0.4;
    const type = isCar ? 'Car' : 'Bike';
    const rate = state.rates[type];
    const durationHrs = 1 + Math.floor(Math.random() * 12);
    const cost = durationHrs * rate;
    
    state.transactions.push({
      receiptId: `PP-${2026}-${5000 + i}`,
      plate: plates[Math.floor(Math.random() * plates.length)],
      type: type,
      floor: String(1 + Math.floor(Math.random() * 4)),
      slotNumber: `${isCar ? 'C' : 'B'}${String(1 + Math.floor(Math.random() * 20)).padStart(2, '0')}`,
      duration: `${durationHrs}h 0m 0s`,
      amountPaid: cost,
      paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
      checkOutTime: new Date(now.getTime() - (Math.random() * 86400 * 1000)).toISOString()
    });
  }

  saveDatabase();
  renderAll();
  showNotification("Mock database populated! Enjoy testing Checkout and live timings.");
}

// ==========================================================================
// 6. EVENT INITIALIZATION & MODAL HANDLERS
// ==========================================================================

// Global Modal controllers
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// Toast notification popup
function showNotification(msg) {
  const toast = document.createElement('div');
  toast.className = 'glass-card toast-popup';
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 0.85rem 1.5rem;
    z-index: 5000;
    border-left: 4px solid var(--accent-color);
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    background: var(--bg-tertiary);
    animation: toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    font-size: 0.82rem;
    font-weight: 600;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  
  // Custom slide animations
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes toast-in {
      from { transform: translateY(40px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Bind Page Interactions after DOM load
window.addEventListener('DOMContentLoaded', async () => {
  // Load localstorage data
  await loadDatabase();
  
  // Initialize console role viewport classes and visual bounds immediately on load
  setConsoleRole(state.activeRole, true);

  // Real-time tab-to-tab synchronization (Zero-cost LocalStorage pipeline - fallback)
  window.addEventListener('storage', (e) => {
    if (!USE_SUPABASE && e.key === 'parkpro_db') {
      loadDatabase();
      renderAll();
    }
  });

  // Supabase Real-Time Subscriptions (Pushes postgres changes via WebSockets instantly!)
  if (USE_SUPABASE && supabaseClient) {
    supabaseClient
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_slots' }, payload => {
        const updatedSlot = payload.new;
        if (updatedSlot) {
          const floorArr = state.slots[updatedSlot.floor];
          if (floorArr) {
            const slotIdx = floorArr.findIndex(s => s.id === updatedSlot.id);
            if (slotIdx !== -1) {
              floorArr[slotIdx].status = updatedSlot.status;
              floorArr[slotIdx].vehicle = updatedSlot.vehicle;
              floorArr[slotIdx].reservation = updatedSlot.reservation;
              
              // If tracked guest vehicle checked out, release vehicle number
              if (updatedSlot.status === 'Available' && 
                  ((updatedSlot.vehicle && updatedSlot.vehicle.plate === state.myPlateNumber) || 
                   (updatedSlot.reservation && updatedSlot.reservation.plate === state.myPlateNumber))) {
                state.myPlateNumber = '';
                const trackInput = document.getElementById('cust-track-plate');
                if (trackInput) trackInput.value = '';
                const clearBtn = document.getElementById('btn-cust-clear-track');
                if (clearBtn) clearBtn.style.display = 'none';
              }
              
              renderAll();
            }
          }
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'parking_transactions' }, payload => {
        const t = payload.new;
        if (t) {
          const transExists = state.transactions.some(tr => tr.receiptId === t.receipt_id);
          if (!transExists) {
            state.transactions.push({
              receiptId: t.receipt_id,
              plate: t.plate,
              type: t.type,
              floor: t.floor,
              slotNumber: t.slot_number,
              duration: t.duration,
              amountPaid: Number(t.amount_paid),
              paymentMethod: t.payment_method,
              checkOutTime: t.check_out_time
            });
            renderAll();
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parking_rates' }, payload => {
        const r = payload.new;
        if (r) {
          state.rates[r.type] = Number(r.hourly_rate);
          renderAll();
        }
      })
      .subscribe();
  }

  // 1. Clock timer loop - runs every second to update UI
  setInterval(() => {
    // Top Bar clock update
    const now = new Date();
    document.getElementById('live-clock').textContent = now.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    // Floor grids map reload to advance live clock tickers
    renderFloorMap(activeFloor);
  }, 1000);

  // 2. Tab switcher (Floor map, transactions, settings)
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      
      this.classList.add('active');
      const tabId = this.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });

  // 3. Floor selector buttons
  document.querySelectorAll('.floor-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.floor-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      activeFloor = this.dataset.floor;
      renderFloorMap(activeFloor);
    });
  });

  // 4. Grid Filter Pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', function() {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      activeFilter = this.dataset.filter;
      renderFloorMap(activeFloor);
    });
  });



  // 7. Modal action type change helper
  document.getElementById('modal-action-type').addEventListener('change', function() {
    const isReserve = this.value === 'reserve';
    document.getElementById('modal-reservation-name-group').style.display = isReserve ? 'flex' : 'none';
  });



  // 9. Modal Form Submit Handler
  document.getElementById('modal-checkin-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const slotId = document.getElementById('modal-slot-id').value;
    const plate = document.getElementById('modal-vehicle-plate').value;
    const action = document.getElementById('modal-action-type').value;
    
    // Get corresponding slot type
    let slotObj = null;
    for (let f = 1; f <= 4; f++) {
      const found = state.slots[f].find(s => s.id === slotId);
      if (found) { slotObj = found; break; }
    }
    
    if (action === 'checkin') {
      checkInVehicle(plate, slotObj.type, slotId);
      showNotification(`Vehicle ${plate.toUpperCase()} checked in to slot ${slotObj.number}.`);
    } else {
      const name = document.getElementById('modal-customer-name').value || 'Reserved Guest';
      reserveSlot(slotId, plate, name);
      showNotification(`Slot ${slotObj.number} reserved for ${name}.`);
    }

    closeModal('checkin-modal');
    renderAll();
  });



  // 12. CREDIT CARD INPUT BEAUTIFICATION & 3D FOCUS ROTATIONS
  const cardNumInput = document.getElementById('card-num-input');
  const cardHolderInput = document.getElementById('card-holder-input');
  const cardExpInput = document.getElementById('card-exp-input');
  const cardCvvInput = document.getElementById('card-cvv-input');
  const card3dObj = document.getElementById('credit-card-3d');

  cardNumInput.addEventListener('input', function(e) {
    // Add spaces every 4 characters
    let val = this.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    let matches = val.match(/\d{4,16}/g);
    let match = matches && matches[0] || '';
    let parts = [];

    for (let i=0, len=match.length; i<len; i+=4) {
      parts.push(match.substring(i, i+4));
    }
    if (parts.length > 0) {
      this.value = parts.join(' ');
    } else {
      this.value = val;
    }
    document.getElementById('card-num-disp').textContent = this.value || '•••• •••• •••• ••••';
  });

  cardHolderInput.addEventListener('input', function() {
    document.getElementById('card-holder-disp').textContent = this.value.toUpperCase() || 'YOUR NAME HERE';
  });

  cardExpInput.addEventListener('input', function() {
    let val = this.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (val.length >= 2) {
      this.value = val.substring(0,2) + '/' + val.substring(2,4);
    } else {
      this.value = val;
    }
    document.getElementById('card-exp-disp').textContent = this.value || 'MM/YY';
  });

  // CVV focuses triggers 3D Card flip animation!
  cardCvvInput.addEventListener('focus', () => card3dObj.classList.add('flipped'));
  cardCvvInput.addEventListener('blur', () => card3dObj.classList.remove('flipped'));
  
  cardCvvInput.addEventListener('input', function() {
    document.getElementById('card-cvv-disp').textContent = this.value || '•••';
  });

  // Submit Card payment form
  document.getElementById('card-payment-form').addEventListener('submit', function(e) {
    e.preventDefault();
    completePayment('Credit Card');
  });



  // Customer Tracking form submit
  document.getElementById('customer-track-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const plateInput = document.getElementById('cust-track-plate').value.toUpperCase().trim();
    if (!plateInput) return;
    
    // Find vehicle
    let foundSlot = null;
    for (let f = 1; f <= 4; f++) {
      const found = state.slots[f].find(s => 
        (s.vehicle && s.vehicle.plate === plateInput) || 
        (s.reservation && s.reservation.plate === plateInput)
      );
      if (found) { foundSlot = found; break; }
    }
    
    if (foundSlot) {
      state.myPlateNumber = plateInput;
      document.getElementById('btn-cust-clear-track').style.display = 'block';
      
      // Sync visual floor tab
      activeFloor = foundSlot.floor;
      document.querySelectorAll('.floor-tab').forEach(tab => {
        if (tab.dataset.floor === activeFloor) tab.classList.add('active');
        else tab.classList.remove('active');
      });
      
      renderAll();
      showNotification(`Success! Found at Floor ${foundSlot.floor}, Slot ${foundSlot.number}. Details unlocked.`);
    } else {
      alert(`Vehicle with Plate Number "${plateInput}" was not found in active parking spaces or reservations!`);
    }
  });

  // Stop tracking button click
  document.getElementById('btn-cust-clear-track').addEventListener('click', function() {
    state.myPlateNumber = '';
    document.getElementById('cust-track-plate').value = '';
    this.style.display = 'none';
    renderAll();
    showNotification("Stopped tracking vehicle. Other spots are masked.");
  });
});

// Switch role view utilities
function setConsoleRole(role, suppressNotification = false) {
  state.activeRole = role;
  
  // Set global body class for CSS visibility toggles
  document.body.className = `role-${role.toLowerCase()}`;
  
  // Reset tabs: If switching to customer, default active tab to floor map
  if (role === 'Customer') {
    activeFilter = 'all';
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    
    const mapTabBtn = document.querySelector('.nav-tab[data-tab="floor-map-tab"]');
    const mapTabPanel = document.getElementById('floor-map-tab');
    if (mapTabBtn && mapTabPanel) {
      mapTabBtn.classList.add('active');
      mapTabPanel.classList.add('active');
    }
  }
  
  renderAll();
  
  if (!suppressNotification) {
    showNotification(`Console Switched to ${role === 'Operator' ? '👨‍✈️ Operator Dashboard' : '👤 Guest Portal'}`);
  }
}
