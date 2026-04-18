/* ============================================================
   NOBACPRO site.js – vanilla JS, no dependencies
   ============================================================ */

/* ============================================================
   STATE
   ============================================================ */
const state = {
  cart: [],
  drawerOpen: false,
  modalOpen: false
};

/* ============================================================
   CART PERSISTENCE
   ============================================================ */
const CART_KEY = 'nobacpro_cart';

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
  const price = parseInt(btn.dataset.price, 10); // price in bani (cents)
  const stripeId = btn.dataset.stripe;

  const existing = state.cart.find(i => i.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({ id, name, price, qty: 1, stripeId });
  }

  saveCart();
  updateCartUI();
  showToast('Adăugat în coș ✓');

  // Brief button checkmark
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

function getTotal() {
  return state.cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function getTotalFormatted() {
  return formatPrice(getTotal());
}

function formatPrice(bani) {
  return (bani / 100).toFixed(2).replace('.', ',') + ' Lei';
}

/* ============================================================
   CART UI
   ============================================================ */
function updateCartUI() {
  const count = state.cart.reduce((s, i) => s + i.qty, 0);

  // Badge
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

  totalEl.textContent = getTotalFormatted();

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
  // Focus first input
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
  html += `<hr class="summary-divider"><div class="summary-total"><span>Total</span><span>${getTotalFormatted()}</span></div>`;
  el.innerHTML = html;
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

  // Phone basic check (Romanian mobile)
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

  // Build customer data
  const customer = {
    name: form.querySelector('#f-name').value.trim(),
    phone: form.querySelector('#f-phone').value.trim().replace(/\s/g, ''),
    email: form.querySelector('#f-email').value.trim(),
    address: form.querySelector('#f-address').value.trim(),
    addressExtra: form.querySelector('#f-address2').value.trim(),
    city: form.querySelector('#f-city').value.trim(),
    county: form.querySelector('#f-county').value,
    postalCode: form.querySelector('#f-postal').value.trim(),
    notes: form.querySelector('#f-notes').value.trim()
  };

  // Generate order ID
  const orderId = 'NB-' + new Date().getFullYear() + '-' + String(Math.floor(10000 + Math.random() * 90000));

  const body = {
    orderId,
    cart: state.cart.map(i => ({
      id: i.id,
      name: i.name,
      qty: i.qty,
      price: i.price,
      stripeId: i.stripeId
    })),
    total: getTotal(),
    customer
  };

  // Loading state
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Se procesează...';

  try {
    const resp = await fetch('https://detergenti-eco-create-order.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Eroare server. Te rugăm încearcă din nou.');
    }

    const data = await resp.json();

    // Persist orderId for success page
    localStorage.setItem('nobacpro_last_order', orderId);

    // Redirect to Stripe
    window.location.href = data.checkoutUrl;

  } catch (err) {
    errorEl.textContent = err.message || 'A apărut o eroare. Te rugăm încearcă din nou sau contactează-ne.';
    errorEl.hidden = false;
    btn.disabled = false;
    btn.innerHTML = 'Plătește cu cardul →';
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

      // Close all
      document.querySelectorAll('.accordion-btn').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
        b.nextElementSibling.hidden = true;
      });

      // Open this one if was closed
      if (!expanded) {
        btn.setAttribute('aria-expanded', 'true');
        panel.hidden = false;
      }
    });
  });
}

/* ============================================================
   SMOOTH SCROLL for anchor links
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
   KEYBOARD TRAP for modal / drawer
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
  loadCart();
  updateCartUI();
  initAccordion();
  initSmoothScroll();
  initNavScroll();
});
