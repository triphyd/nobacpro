/* ============================================================
   NOBACPRO site.js – vanilla JS, no dependencies
   ============================================================ */

/* ============================================================
   STATE
   ============================================================ */
const state = {
  cart: [],
  drawerOpen: false,
  modalOpen: false,
  deliveryType: 'home',    // 'home' | 'easybox'
  selectedCourier: null,   // { serviceId, courierName, price }
  shippingPoint: null,     // { id, name, address, city, county, postalCode, operator }
};

/* ============================================================
   CONSTANTS
   ============================================================ */
const CART_KEY = 'nobacpro_cart';
const WORKER_DELIVERY_URL = 'https://nobacpro-delivery.horves-srl.workers.dev';

/* ============================================================
   CART PERSISTENCE
   ============================================================ */
function loadCart() {
  try {
    const saved = localStorage.getItem(CART_KEY);
    if (saved) state.cart = JSON.parse(saved);
  } catch (_) {
    state.cart = [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  } catch (_) {}
}

/* ============================================================
   CART LOGIC
   ============================================================ */
function addToCart(btn) {
  const id = btn.dataset.id;
  const name = btn.dataset.name;
  const price = parseInt(btn.dataset.price, 10);

  const existing = state.cart.find(i => i.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({ id, name, price, qty: 1 });
  }

  saveCart();
  updateCartUI();
  showToast('Adăugat în coș ✓');

  const origText = btn.textContent;
  btn.textContent = '✓ Adăugat';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = origText;
    btn.disabled = false;
  }, 1200);
}

function removeFromCart(id) {
  state.cart = state.cart.filter(i => i.id !== id);
  saveCart();
  updateCartUI();
}

function updateQty(id, delta) {
  const item = state.cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(id);
    return;
  }
  saveCart();
  updateCartUI();
}

function getSubtotal() {
  return state.cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function getCartItemCount() {
  return state.cart.reduce((s, i) => s + i.qty, 0);
}

function getCartDiscountPercent() {
  const count = getCartItemCount();
  if (count >= 4) return 15;
  if (count === 3) return 10;
  if (count === 2) return 5;
  return 0;
}

function getCartDiscount() {
  const pct = getCartDiscountPercent();
  if (pct === 0) return 0;
  return Math.round(getSubtotal() * pct / 100);
}

function getTotal() {
  return getSubtotal() - getCartDiscount();
}

function getTotalFormatted() {
  return formatPrice(getTotal());
}

function formatPrice(bani) {
  return (bani / 100).toFixed(2).replace('.', ',') + ' Lei';
}

function getDeliveryPrice() {
  if (getSubtotal() >= 15000) return 0;
  return state.selectedCourier?.price || 0;
}

function getGrandTotal() {
  return getTotal() + getDeliveryPrice();
}

/* ============================================================
   CART UI
   ============================================================ */
function updateCartUI() {
  const count = getCartItemCount();
  const badge = document.getElementById('cart-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
  renderDrawerItems();
}

function renderDrawerItems() {
  const container = document.getElementById('drawer-items');
  const empty = document.getElementById('drawer-empty');
  const footer = document.getElementById('drawer-footer');
  const totalEl = document.getElementById('drawer-total');
  const shippingEl = document.getElementById('drawer-shipping');

  container.innerHTML = '';

  if (state.cart.length === 0) {
    empty.hidden = false;
    footer.hidden = true;
    container.hidden = true;
    return;
  }

  empty.hidden = true;
  footer.hidden = false;
  container.hidden = false;

  state.cart.forEach(item => {
    const row = document.createElement('div');
    row.className = 'drawer-item';
    row.innerHTML = `
      <div class="drawer-item-img">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect width="40" height="40" rx="6" fill="#EBF3FF"/>
          <rect x="10" y="12" width="20" height="16" rx="3" fill="#1A56DB" opacity="0.5"/>
        </svg>
      </div>
      <div class="drawer-item-info">
        <div class="drawer-item-name" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
        <div class="drawer-item-price">${formatPrice(item.price)}</div>
      </div>
      <div class="drawer-item-controls">
        <button class="qty-btn" onclick="updateQty('${item.id}', -1)" aria-label="Scade cantitate">−</button>
        <span class="qty-value" aria-live="polite">${item.qty}</span>
        <button class="qty-btn" onclick="updateQty('${item.id}', 1)" aria-label="Crește cantitate">+</button>
        <button class="remove-btn" onclick="removeFromCart('${item.id}')" aria-label="Șterge ${escHtml(item.name)}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/>
          </svg>
        </button>
      </div>
    `;
    container.appendChild(row);
  });

  totalEl.textContent = formatPrice(getSubtotal());

  const discountPct = getCartDiscountPercent();
  const discountEl = document.getElementById('drawer-discount');
  const discountAmountEl = document.getElementById('drawer-discount-amount');
  const totalFinalWrap = document.getElementById('drawer-total-final-wrap');
  const totalFinalEl = document.getElementById('drawer-total-final');

  if (discountPct > 0) {
    discountAmountEl.textContent = `−${formatPrice(getCartDiscount())} (${discountPct}% reducere)`;
    discountEl.hidden = false;
    totalFinalEl.textContent = getTotalFormatted();
    totalFinalWrap.hidden = false;
  } else {
    discountEl.hidden = true;
    totalFinalWrap.hidden = true;
  }

  const total = getTotal();
  if (total >= 15000) {
    shippingEl.textContent = '✓ Livrare gratuită inclusă';
    shippingEl.className = 'drawer-shipping free';
  } else {
    const needed = formatPrice(15000 - total);
    shippingEl.textContent = `Livrare GRATUITĂ la comenzi peste 150 Lei (mai ai ${needed})`;
    shippingEl.className = 'drawer-shipping';
  }
}

/* ============================================================
   DRAWER
   ============================================================ */
function openDrawer() {
  state.drawerOpen = true;
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('cart-drawer').setAttribute('aria-hidden', 'false');
  document.getElementById('drawer-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  renderDrawerItems();
}

function closeDrawer() {
  state.drawerOpen = false;
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('cart-drawer').setAttribute('aria-hidden', 'true');
  document.getElementById('drawer-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

/* ============================================================
   MODAL
   ============================================================ */
function openModal() {
  if (state.cart.length === 0) {
    showToast('Coșul tău este gol');
    return;
  }
  closeDrawer();
  state.modalOpen = true;
  renderModalSummary();
  document.getElementById('checkout-modal').classList.add('open');
  document.getElementById('checkout-modal').setAttribute('aria-hidden', 'false');
  document.getElementById('modal-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const first = document.getElementById('f-name');
    if (first) first.focus();
  }, 100);
}

function closeModal() {
  state.modalOpen = false;
  document.getElementById('checkout-modal').classList.remove('open');
  document.getElementById('checkout-modal').setAttribute('aria-hidden', 'true');
  document.getElementById('modal-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

function renderModalSummary() {
  const el = document.getElementById('modal-summary');
  let html = '';
  state.cart.forEach(item => {
    html += `<div class="summary-item"><span>${escHtml(item.name)} × ${item.qty}</span><span>${formatPrice(item.price * item.qty)}</span></div>`;
  });
  html += `<hr class="summary-divider">`;
  const discountPct = getCartDiscountPercent();
  if (discountPct > 0) {
    html += `<div class="summary-item"><span>Subtotal</span><span>${formatPrice(getSubtotal())}</span></div>`;
    html += `<div class="summary-discount"><span>Reducere coș (${discountPct}%)</span><span>−${formatPrice(getCartDiscount())}</span></div>`;
  }
  if (getDeliveryPrice() > 0) {
    html += `<div class="summary-item">
      <span>Livrare (${escHtml(state.selectedCourier?.courierName || '')})</span>
      <span>${formatPrice(getDeliveryPrice())}</span>
    </div>`;
  } else if (state.deliveryType !== 'home' || state.selectedCourier) {
    html += `<div class="summary-item"><span>Livrare</span><span>Gratuit</span></div>`;
  }
  html += `<div class="summary-total"><span>Total de plată</span><span>${formatPrice(getGrandTotal())}</span></div>`;
  el.innerHTML = html;
}

/* ============================================================
   DELIVERY TYPE TOGGLE
   ============================================================ */
function setDeliveryType(type) {
  state.deliveryType = type;

  const homeFields = document.getElementById('home-address-fields');
  const easyboxFields = document.getElementById('easybox-fields');
  const btnHome = document.getElementById('delivery-home-btn');
  const btnEasybox = document.getElementById('delivery-easybox-btn');

  if (type === 'home') {
    homeFields.hidden = false;
    easyboxFields.hidden = true;
    btnHome.classList.add('active');
    btnEasybox.classList.remove('active');
    homeFields.querySelectorAll('[data-required]').forEach(el => el.required = true);
    state.shippingPoint = null;
    state.selectedCourier = null;
    document.getElementById('courier-selector').hidden = false;
    const county = document.getElementById('f-county').value;
    const city = document.getElementById('f-city').value.trim();
    if (county && city) fetchDeliveryPrices();
  } else {
    homeFields.hidden = true;
    easyboxFields.hidden = false;
    btnHome.classList.remove('active');
    btnEasybox.classList.add('active');
    homeFields.querySelectorAll('[data-required]').forEach(el => el.required = false);
    state.selectedCourier = null;
    document.getElementById('courier-selector').hidden = true;
    document.getElementById('f-locker-county').value = '';
    document.getElementById('locker-list').innerHTML = '';
    document.getElementById('locker-display').hidden = true;
    state.shippingPoint = null;
  }
}

/* ============================================================
   LOCKER FETCHING
   ============================================================ */
async function fetchLockers(county) {
  if (!county) return;
  const lockerList = document.getElementById('locker-list');
  const lockerLoading = document.getElementById('locker-loading');
  const lockerDisplay = document.getElementById('locker-display');
  lockerList.innerHTML = '';
  lockerDisplay.hidden = true;
  state.shippingPoint = null;
  state.selectedCourier = null;
  lockerLoading.hidden = false;
  try {
    const resp = await fetch(
      `${WORKER_DELIVERY_URL}/?action=lockers&county=${encodeURIComponent(county)}`
    );
    const data = await resp.json();
    renderLockerList(data);
  } catch (e) {
    lockerList.innerHTML = '<p class="locker-error-msg">Nu am putut încărca lockerele. Încearcă din nou.</p>';
  } finally {
    lockerLoading.hidden = true;
  }
}

function renderLockerList(lockers) {
  const lockerList = document.getElementById('locker-list');
  if (!lockers || !lockers.length) {
    lockerList.innerHTML = '<p class="locker-error-msg">Nu există lockere disponibile în acest județ.</p>';
    return;
  }
  const groups = {};
  lockers.forEach(l => {
    const op = l.operator || 'Locker';
    if (!groups[op]) groups[op] = [];
    groups[op].push(l);
  });
  let html = '';
  for (const [op, items] of Object.entries(groups)) {
    html += `<div class="locker-group-label">${escHtml(op)}</div>`;
    items.forEach(l => {
      const dataAttr = escHtml(JSON.stringify(l));
      html += `<button type="button" class="locker-item"
        data-locker="${dataAttr}"
        onclick="selectLocker(this)">
        <span class="locker-item-name">${escHtml(l.name)}</span>
        <span class="locker-item-addr">${escHtml(l.address)}, ${escHtml(l.city)}</span>
      </button>`;
    });
  }
  lockerList.innerHTML = html;
}

function selectLocker(btn) {
  const l = JSON.parse(btn.dataset.locker);
  state.shippingPoint = l;
  document.querySelectorAll('.locker-item').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const display = document.getElementById('locker-display');
  display.hidden = false;
  display.innerHTML = `
    <div class="locker-selected">
      <span class="locker-icon">📦</span>
      <div>
        <strong>${escHtml(l.name)}</strong><br>
        <small>${escHtml(l.address)}, ${escHtml(l.city)}</small><br>
        <small style="color:#6b7280;">${escHtml(l.operator || '')}</small>
      </div>
      <button type="button" class="locker-change-btn"
        onclick="document.getElementById('locker-display').hidden=true;
                 state.shippingPoint=null;
                 document.querySelectorAll('.locker-item')
                   .forEach(b=>b.classList.remove('selected'))">
        Schimbă
      </button>
    </div>
  `;
  document.getElementById('locker-error').hidden = true;
}

/* ============================================================
   COURIER PRICE FETCHING
   ============================================================ */
async function fetchDeliveryPrices() {
  const county = document.getElementById('f-county').value;
  const city = document.getElementById('f-city').value.trim();
  const postalCode = document.getElementById('f-postal').value.trim();
  const address = document.getElementById('f-address').value.trim();
  if (!county || !city) return;

  const section = document.getElementById('courier-selector');
  const loading = document.getElementById('courier-loading');
  const list = document.getElementById('courier-list');
  section.hidden = false;
  loading.hidden = false;
  list.innerHTML = '';
  state.selectedCourier = null;
  renderModalSummary();

  try {
    const params = new URLSearchParams({ action: 'prices', county, city, postalCode, address });
    const resp = await fetch(`${WORKER_DELIVERY_URL}/?${params}`);
    const data = await resp.json();
    renderCourierList(data);
  } catch (e) {
    list.innerHTML = '<p class="courier-error-msg">Nu am putut calcula prețurile. Livrarea va fi calculată automat.</p>';
    state.selectedCourier = { serviceId: null, courierName: 'Standard', price: 0 };
    renderModalSummary();
  } finally {
    loading.hidden = true;
  }
}

function renderCourierList(couriers) {
  const list = document.getElementById('courier-list');
  if (!couriers || !couriers.length) {
    list.innerHTML = '<p class="courier-error-msg">Nicio opțiune de livrare disponibilă.</p>';
    state.selectedCourier = { serviceId: null, courierName: 'Standard', price: 0 };
    renderModalSummary();
    return;
  }
  list.innerHTML = couriers.map((c, i) => {
    const priceLabel = c.price === 0 ? 'Gratuit' : formatPrice(c.price);
    const dataAttr = escHtml(JSON.stringify(c));
    return `<button type="button" class="courier-option${i === 0 ? ' selected' : ''}"
      data-courier="${dataAttr}"
      onclick="selectCourier(this)">
      <span class="courier-name">${escHtml(c.courierName)}</span>
      <span class="courier-details">${escHtml(c.estimatedDelivery || '1–3 zile')}</span>
      <span class="courier-price">${priceLabel}</span>
    </button>`;
  }).join('');
  state.selectedCourier = couriers[0];
  renderModalSummary();
}

function selectCourier(btn) {
  const c = JSON.parse(btn.dataset.courier);
  state.selectedCourier = c;
  document.querySelectorAll('.courier-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('courier-error').hidden = true;
  renderModalSummary();
}

/* ============================================================
   FORM VALIDATION
   ============================================================ */
function validateForm() {
  const form = document.getElementById('checkout-form');
  const required = form.querySelectorAll('[required]');
  let valid = true;

  required.forEach(field => {
    field.classList.remove('invalid');
    const val = field.type === 'checkbox' ? field.checked : field.value.trim();
    if (!val) {
      field.classList.add('invalid');
      valid = false;
    }
  });

  // Phone basic check
  const phone = form.querySelector('#f-phone');
  if (phone && phone.value && !/^0[67]\d{8}$/.test(phone.value.replace(/\s/g, ''))) {
    phone.classList.add('invalid');
    valid = false;
  }

  // Email basic check
  const email = form.querySelector('#f-email');
  if (email && email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    email.classList.add('invalid');
    valid = false;
  }

  // Home delivery: require courier selection
  if (state.deliveryType === 'home' && !state.selectedCourier) {
    const ce = document.getElementById('courier-error');
    if (ce) { ce.hidden = false; }
    valid = false;
  }

  // Locker: require shipping point selection
  if (state.deliveryType === 'easybox' && !state.shippingPoint) {
    document.getElementById('locker-error').hidden = false;
    valid = false;
  } else {
    const le = document.getElementById('locker-error');
    if (le) le.hidden = true;
  }

  return valid;
}

/* ============================================================
   CHECKOUT FLOW
   ============================================================ */
async function submitOrder(event) {
  event.preventDefault();

  const errorEl = document.getElementById('form-error');
  errorEl.hidden = true;

  if (!validateForm()) {
    errorEl.textContent = 'Te rugăm completează toate câmpurile obligatorii corect.';
    errorEl.hidden = false;
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const form = document.getElementById('checkout-form');
  const btn = document.getElementById('pay-btn');

  let customer;

  if (state.deliveryType === 'easybox') {
    customer = {
      name:         form.querySelector('#f-name').value.trim(),
      phone:        form.querySelector('#f-phone').value.trim().replace(/\s/g, ''),
      email:        form.querySelector('#f-email').value.trim(),
      address:      state.shippingPoint.address,
      addressExtra: '',
      city:         state.shippingPoint.city,
      county:       state.shippingPoint.county,
      postalCode:   state.shippingPoint.postalCode,
      notes:        form.querySelector('#f-notes').value.trim(),
    };
  } else {
    customer = {
      name:         form.querySelector('#f-name').value.trim(),
      phone:        form.querySelector('#f-phone').value.trim().replace(/\s/g, ''),
      email:        form.querySelector('#f-email').value.trim(),
      address:      form.querySelector('#f-address').value.trim(),
      addressExtra: form.querySelector('#f-address2').value.trim(),
      city:         form.querySelector('#f-city').value.trim(),
      county:       form.querySelector('#f-county').value,
      postalCode:   form.querySelector('#f-postal').value.trim(),
      notes:        form.querySelector('#f-notes').value.trim(),
    };
  }

  const orderId = 'NB-' + new Date().getFullYear() + '-' + String(Math.floor(10000 + Math.random() * 90000));

  const body = {
    orderId,
    cart: state.cart.map(i => ({
      id:    i.id,
      name:  i.name,
      qty:   i.qty,
      price: i.price,
    })),
    subtotal:        getSubtotal(),
    discountPercent: getCartDiscountPercent(),
    discountAmount:  getCartDiscount(),
    total:           getTotal(),
    customer,
    deliveryType:    state.deliveryType,
    shippingPoint:   state.shippingPoint,
    serviceId:       state.selectedCourier?.serviceId       || null,
    shippingPointId: state.shippingPoint?.id                || null,
    deliveryPrice:   getDeliveryPrice(),
    grandTotal:      getGrandTotal(),
  };

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Se procesează...';

  try {
    const resp = await fetch('https://nobacpro-create-order.horves-srl.workers.dev/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Eroare server. Te rugăm încearcă din nou.');
    }

    const data = await resp.json();
    localStorage.setItem('nobacpro_last_order', orderId);
    window.location.href = data.checkoutUrl;

  } catch (err) {
    errorEl.textContent = err.message || 'A apărut o eroare. Te rugăm încearcă din nou sau contactează-ne.';
    errorEl.hidden = false;
    btn.disabled = false;
    btn.innerHTML = 'Plătește cu cardul →';
  }
}

/* ============================================================
   WELCOME BANNER
   ============================================================ */
function dismissWelcome() {
  const banner = document.getElementById('welcome-banner');
  if (banner) {
    banner.classList.add('dismissed');
    setTimeout(() => banner.remove(), 350);
    sessionStorage.setItem('welcome_dismissed', '1');
  }
}

function initWelcomeBanner() {
  if (sessionStorage.getItem('welcome_dismissed')) {
    const banner = document.getElementById('welcome-banner');
    if (banner) banner.remove();
  }
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimeout;

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2400);
}

/* ============================================================
   ACCORDION
   ============================================================ */
function initAccordion() {
  document.querySelectorAll('.accordion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      const panel = btn.nextElementSibling;

      document.querySelectorAll('.accordion-btn').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
        b.nextElementSibling.hidden = true;
      });

      if (!expanded) {
        btn.setAttribute('aria-expanded', 'true');
        panel.hidden = false;
      }
    });
  });
}

/* ============================================================
   SMOOTH SCROLL
   ============================================================ */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const navH = document.getElementById('navbar').offsetHeight;
        const y = target.getBoundingClientRect().top + window.scrollY - navH - 16;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  });
}

/* ============================================================
   NAVBAR SCROLL SHRINK
   ============================================================ */
function initNavScroll() {
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }, { passive: true });
}

/* ============================================================
   MOBILE MENU
   ============================================================ */
function toggleMobileMenu() {
  const nav = document.getElementById('mobile-nav');
  const btn = document.getElementById('hamburger');
  const open = nav.classList.toggle('open');
  btn.classList.toggle('active', open);
  btn.setAttribute('aria-expanded', String(open));
  nav.setAttribute('aria-hidden', String(!open));
  document.body.style.overflow = open ? 'hidden' : '';
}

/* ============================================================
   KEYBOARD TRAP
   ============================================================ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (state.modalOpen) closeModal();
    else if (state.drawerOpen) closeDrawer();
  }
});

/* ============================================================
   HTML ESCAPE utility
   ============================================================ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initWelcomeBanner();
  loadCart();
  updateCartUI();
  initAccordion();
  initSmoothScroll();
  initNavScroll();

  const countySelect = document.getElementById('f-county');
  const cityInput = document.getElementById('f-city');

  countySelect.addEventListener('change', () => {
    if (cityInput.value.trim()) fetchDeliveryPrices();
  });
  cityInput.addEventListener('blur', () => {
    if (countySelect.value) fetchDeliveryPrices();
  });
});
