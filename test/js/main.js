/* ============================================================
   FLOURETTE CORNER — main.js
   Simple, beginner-friendly JavaScript for the whole site.
   ============================================================ */

/* ──────────────────────────────────────────
   1. SCROLL: Shrink nav on scroll
────────────────────────────────────────── */
window.addEventListener('scroll', function () {
  var header = document.getElementById('main-header');
  if (!header) return;
  if (window.scrollY > 50) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
});

/* ──────────────────────────────────────────
   2. MOBILE MENU: Toggle active class via JS
   (CSS checkbox still works as fallback)
────────────────────────────────────────── */
var navToggle = document.getElementById('nav-toggle');
var mobileMenu = document.getElementById('mobile-menu-overlay');

if (navToggle && mobileMenu) {
  navToggle.addEventListener('change', function () {
    if (navToggle.checked) {
      mobileMenu.classList.add('active');
      document.body.style.overflow = 'hidden';
    } else {
      mobileMenu.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // Close mobile menu when a link is clicked
  var mobileLinks = mobileMenu.querySelectorAll('.mobile-nav-link');
  mobileLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      navToggle.checked = false;
      mobileMenu.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

/* ──────────────────────────────────────────
   3. CART: localStorage-based cart system
────────────────────────────────────────── */

// Get cart from storage, or start with empty array
function getCart() {
  var stored = localStorage.getItem('flourette_cart');
  return stored ? JSON.parse(stored) : [];
}

// Save cart to storage
function saveCart(cart) {
  localStorage.setItem('flourette_cart', JSON.stringify(cart));
}

// Count total items in cart
function getCartCount() {
  var cart = getCart();
  return cart.reduce(function (total, item) { return total + item.qty; }, 0);
}

// Update all cart badges on the page
function updateCartBadges() {
  var count = getCartCount();
  var badges = document.querySelectorAll('#cart-count');
  badges.forEach(function (badge) {
    badge.textContent = count;
    // Bounce animation
    badge.classList.remove('cart-bounce');
    void badge.offsetWidth; // force reflow
    badge.classList.add('cart-bounce');
  });
}

// Add item to cart
function addToCart(name, price, image) {
  var cart = getCart();
  var existing = cart.find(function (item) { return item.name === name; });
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ name: name, price: price, image: image, qty: 1 });
  }
  saveCart(cart);
  updateCartBadges();
  showToast(name + ' added to your bag! 🍪');
}

// Show a small toast notification
function showToast(message) {
  // Remove any existing toast
  var old = document.getElementById('flourette-toast');
  if (old) old.remove();

  var toast = document.createElement('div');
  toast.id = 'flourette-toast';
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed', 'bottom:2rem', 'left:50%', 'z-index:9999',
    'background:var(--brand-blue)', 'color:#fff', 'font-family:Poppins,sans-serif',
    'font-weight:700', 'font-size:0.875rem', 'padding:1rem 2rem', 'border-radius:100px',
    'box-shadow:0 20px 40px rgba(0,0,0,0.1)',
    'transform:translateX(-50%) translateY(100px)', 'opacity:0',
    'transition:all 0.6s cubic-bezier(0.19, 1, 0.22, 1)'
  ].join(';');
  document.body.appendChild(toast);

  // Animate in
  setTimeout(function () {
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
  }, 10);

  // Animate out after 2.5s
  setTimeout(function () {
    toast.style.transform = 'translateX(-50%) translateY(100px)';
    toast.style.opacity = '0';
    setTimeout(function () { toast.remove(); }, 600);
  }, 2500);
}

// Simple export of addToCart to global window for easier onclick access
window.addToBag = function(name, price, image) {
    addToCart(name, price, image);
};

// Initialize cart badges and user state on page load
updateCartBadges();
updateUserState();

/* ──────────────────────────────────────────
   4. USER: Mock login state
   ────────────────────────────────────────── */
function getUser() {
  var stored = localStorage.getItem('flourette_user');
  return stored ? JSON.parse(stored) : null;
}

function saveUser(user) {
  localStorage.setItem('flourette_user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('flourette_user');
  updateUserState();
  window.location.href = 'index.html';
}
window.userLogout = logout;

function updateUserState() {
  var user = getUser();
  var authLinks = document.querySelectorAll('.auth-link');
  var userProfiles = document.querySelectorAll('.user-profile-nav');

  if (user) {
    authLinks.forEach(function (link) { link.style.display = 'none'; });
    userProfiles.forEach(function (profile) {
      profile.style.display = 'flex';
      var initials = profile.querySelector('.user-initials');
      if (initials) {
        var names = user.email.split(/[.@]/);
        initials.textContent = names.filter(function(n) { return n; }).map(function(n) { return n[0].toUpperCase(); }).join('').substring(0, 2);
      }
    });
  } else {
    authLinks.forEach(function (link) { link.style.display = 'flex'; });
    userProfiles.forEach(function (profile) { profile.style.display = 'none'; });
  }
}

// Handle login form if on login page
var loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = loginForm.querySelector('input[type="email"]').value;
    saveUser({ email: email });
    showToast('Welcome back, cookie lover! 🍪');
    setTimeout(function () {
      window.location.href = 'index.html';
    }, 1000);
  });
}

// Global logout access
window.userLogout = logout;

/* ──────────────────────────────────────────
   5. MENU PAGE: Filter + Search
────────────────────────────────────────── */
var menuPage = document.getElementById('menu-page');
if (menuPage) {
  var filterBtns = menuPage.querySelectorAll('.filter-btn');
  var cookieCards = menuPage.querySelectorAll('.cookie-card');
  var searchInput = menuPage.querySelector('#menu-search');
  var paginationDots = menuPage.querySelectorAll('.pagination-dot');
  var itemsPerPage = 3;

  function applyFilters() {
    var query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    var activeFilter = 'all';
    filterBtns.forEach(function(b) {
        if (b.classList.contains('btn-primary')) activeFilter = b.dataset.filter;
    });

    var visibleCards = [];

    cookieCards.forEach(function (card) {
      var category = (card.dataset.category || '').toLowerCase();
      var text = (card.textContent || '').toLowerCase();

      var matchesFilter = (activeFilter === 'all') || (category === activeFilter);
      var matchesSearch = !query || text.includes(query);

      if (matchesFilter && matchesSearch) {
        visibleCards.push(card);
        card.style.display = '';
        card.style.animation = 'fadeIn 0.4s ease-out forwards';
      } else {
        card.style.display = 'none';
      }
    });

    // Handle Pagination for visible cards
    var totalPages = Math.ceil(visibleCards.length / itemsPerPage);
    var activePage = 1;
    
    paginationDots.forEach(function(d) { 
        if(d.classList.contains('active')) {
            activePage = parseInt(d.textContent) || 1; 
        }
    });

    // Reset to page 1 if current page is out of bounds
    if (activePage > totalPages && totalPages > 0) {
        activePage = 1;
        paginationDots.forEach(function(d) {
            d.classList.toggle('active', d.textContent.trim() === '1');
        });
    }

    // Hide/Show dots based on total pages
    paginationDots.forEach(function(dot) {
        var pageNum = parseInt(dot.textContent);
        if (!isNaN(pageNum)) {
            if (pageNum > totalPages || totalPages <= 1) {
                dot.style.display = 'none';
            } else {
                dot.style.display = 'flex';
            }
        }
        // Handle arrows
        if (dot.textContent.trim() === '‹' || dot.textContent.trim() === '›') {
            dot.style.display = (totalPages > 1) ? 'flex' : 'none';
        }
    });
    
    var start = (activePage - 1) * itemsPerPage;
    var end = start + itemsPerPage;

    visibleCards.forEach(function(card, index) {
        if (index >= start && index < end) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
  }

  function resetPagination() {
      paginationDots.forEach(function(d, i) {
          d.classList.toggle('active', d.textContent.trim() === '1');
      });
      applyFilters();
  }

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setActiveFilter(btn.dataset.filter);
    });
  });

  function setActiveFilter(filter) {
    filterBtns.forEach(function (b) {
        if (b.dataset.filter === filter) {
            b.classList.add('btn-primary');
            b.classList.remove('bg-white', 'text-brand-brown/40');
        } else {
            b.classList.remove('btn-primary');
            b.classList.add('bg-white', 'text-brand-brown/40');
        }
    });
    resetPagination();
  }

  // Handle URL category
  var urlParams = new URLSearchParams(window.location.search);
  var catParam = urlParams.get('cat');
  if (catParam) {
    setActiveFilter(catParam.toLowerCase());
  }

  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }

  // Basic Pagination
  paginationDots.forEach(function(dot) {
    dot.addEventListener('click', function(e) {
        e.preventDefault();
        var pageText = dot.textContent.trim();
        
        if (pageText === '‹') {
            var current = Array.from(paginationDots).find(d => d.classList.contains('active'));
            var prev = current.previousElementSibling;
            if (prev && prev.classList.contains('pagination-dot') && prev.textContent.trim() !== '‹') {
                prev.click();
            }
            return;
        }
        if (pageText === '›') {
            var current = Array.from(paginationDots).find(d => d.classList.contains('active'));
            var next = current.nextElementSibling;
            if (next && next.classList.contains('pagination-dot') && next.textContent.trim() !== '›') {
                next.click();
            }
            return;
        }

        paginationDots.forEach(function(d) { d.classList.remove('active'); });
        dot.classList.add('active');
        
        var grid = document.getElementById('menu-grid');
        if (grid) {
            window.scrollTo({
                top: grid.offsetTop - 100,
                behavior: 'smooth'
            });
        }
        applyFilters();
    });
  });

  // Initial Run
  applyFilters();
}

// Home page specific interactions
var categoryItems = document.querySelectorAll('.category-item');
categoryItems.forEach(function(item) {
    var label = item.querySelector('.category-label');
    if (label) {
        var text = label.textContent.trim();
        if (text === 'Location' || text === 'Favorites' || text === 'Packaging') {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                showToast(text + ' feature coming soon! 🍪');
            });
        }
    }
});

/* ──────────────────────────────────────────
   6. BASKET PAGE: Show cart items
────────────────────────────────────────── */
var basketPage = document.getElementById('basket-page');
if (basketPage) {
  renderBasket();
}

function renderBasket() {
  var container = document.getElementById('basket-content');
  if (!container) return;
  var cart = getCart();

  if (cart.length === 0) {
    container.innerHTML = [
      '<div class="text-center py-24">',
      '  <h2 class="text-4xl md:text-5xl font-display font-black text-brand-brown mb-4 uppercase">Your bag is empty</h2>',
      '  <p class="text-brand-brown/40 font-medium mb-12 text-lg italic">Looks like you haven\'t added any munchies yet.</p>',
      '  <a href="menu.html" class="btn btn-primary px-12 py-5">Browse the Collection</a>',
      '</div>'
    ].join('');
    return;
  }

  var total = cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);

  var itemsHtml = cart.map(function (item, index) {
    return [
      '<div class="basket-item reveal">',
      '  <div class="basket-item-img">',
      '    <img src="' + item.image + '" alt="' + item.name + '">',
      '  </div>',
      '  <div class="flex-1">',
      '    <h3 class="text-xl font-display font-black text-brand-brown uppercase mb-1">' + item.name + '</h3>',
      '    <span class="text-brand-blue font-black">₱' + item.price + '</span>',
      '  </div>',
      '  <div class="qty-control">',
      '    <button onclick="changeQty(' + index + ', -1)" class="qty-btn">−</button>',
      '    <span class="font-black text-sm w-4 text-center">' + item.qty + '</span>',
      '    <button onclick="changeQty(' + index + ', 1)" class="qty-btn">+</button>',
      '  </div>',
      '  <div class="text-right ml-4 hidden sm:block">',
      '    <div class="font-black text-lg">₱' + (item.price * item.qty) + '</div>',
      '  </div>',
      '</div>'
    ].join('');
  }).join('');

  container.innerHTML = [
    '<div class="basket-grid">',
    '  <div class="basket-items-col">',
    itemsHtml,
    '  </div>',
    '  <div class="basket-summary-col">',
    '    <div class="basket-summary">',
    '      <h2 class="text-2xl font-display font-black text-brand-brown uppercase mb-8 pb-4 border-b border-brand-brown/5">Bag Summary</h2>',
    '      <div class="flex justify-between items-center mb-4">',
    '        <span class="font-bold text-xs uppercase tracking-widest text-brand-brown/40">Subtotal</span>',
    '        <span class="font-black">₱' + total + '</span>',
    '      </div>',
    '      <div class="flex justify-between items-center mb-8">',
    '        <span class="font-bold text-xs uppercase tracking-widest text-brand-brown/40">Delivery</span>',
    '        <span class="font-black text-brand-blue">FREE</span>',
    '      </div>',
    '      <div class="flex justify-between items-center mb-10 pt-6 border-t border-brand-brown/5">',
    '        <span class="font-black uppercase tracking-widest text-sm">Total Amount</span>',
    '        <span class="text-4xl font-black text-brand-blue">₱' + total + '</span>',
    '      </div>',
    '      <button onclick="checkout()" class="btn btn-primary w-full py-5 text-sm">Place Your Order</button>',
    '      <p class="text-[10px] text-center mt-6 text-brand-brown/30 font-bold uppercase tracking-widest leading-relaxed">By placing your order, you agree to our <br> Terms of Service and Delivery Policy.</p>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');
}

window.changeQty = function (index, delta) {
  var cart = getCart();
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCart(cart);
  updateCartBadges();
  renderBasket();
};

window.checkout = function () {
  var orderId = 'FC-' + Math.floor(10000 + Math.random() * 90000);
  localStorage.setItem('flourette_last_order', orderId);
  saveCart([]);
  updateCartBadges();
  window.location.href = 'track.html?order=' + orderId;
};

/* ──────────────────────────────────────────
   7. TRACK PAGE: Simulation
────────────────────────────────────────── */
var trackBtn = document.getElementById('track-btn');
if (trackBtn) {
    trackBtn.addEventListener('click', function() {
        var id = document.getElementById('track-input').value.trim();
        if(!id) return;
        
        var resultDiv = document.getElementById('tracking-result');
        resultDiv.innerHTML = '<p class="text-center font-black animate-pulse py-8">Searching for order ' + id + '...</p>';
        
        setTimeout(function() {
            resultDiv.innerHTML = [
                '<div class="card mx-auto max-w-sm text-center p-12">',
                '  <p class="text-brand-blue font-black uppercase text-xs mb-2">Status for ' + id + '</p>',
                '  <h2 class="text-3xl font-display font-black text-brand-brown uppercase mb-6">Baking in Progress!</h2>',
                '  <p class="text-brand-brown/40 font-medium">Your cookies are being crafted with love in the oven.</p>',
                '</div>'
            ].join('');
        }, 1200);
    });

    // Auto-fill from URL
    var urlParams = new URLSearchParams(window.location.search);
    var orderParam = urlParams.get('order');
    if (orderParam) {
        document.getElementById('track-input').value = orderParam;
        trackBtn.click();
    }
}
