// ============================================================
// HEADER SCROLL BEHAVIOR & BACK TO TOP BUTTON
// ============================================================
const header = document.getElementById('header');
const hero = document.querySelector('.hero-banner');
const backToTop = document.getElementById('back-to-top');
let lastScrollY = 0;

window.addEventListener('scroll', () => {
  const scrollY = window.scrollY;
  const pastHero = hero ? scrollY > hero.offsetHeight - 64 : scrollY > 100;

  // Header behavior
  if (!pastHero) {
    header.classList.remove('scrolled', 'hidden');
  } else if (scrollY > lastScrollY) {
    header.classList.add('scrolled', 'hidden');
  } else {
    header.classList.add('scrolled');
    header.classList.remove('hidden');
  }

  // Back to top button visibility
  if (pastHero) {
    backToTop.classList.add('visible');
  } else {
    backToTop.classList.remove('visible');
  }

  lastScrollY = scrollY;
});

// Back to top button click handler
backToTop.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
});

// ============================================================
// BURGER MENU TOGGLE
// ============================================================
const burgerMenu = document.getElementById('burger-menu');
const navMenu = document.getElementById('nav-menu');

if (burgerMenu && navMenu) {
  burgerMenu.addEventListener('click', () => {
    burgerMenu.classList.toggle('active');
    navMenu.classList.toggle('active');
  });

  // Close menu when clicking on a nav link
  const navLinks = navMenu.querySelectorAll('a');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      burgerMenu.classList.remove('active');
      navMenu.classList.remove('active');
    });
  });
}

// ============================================================
// GRADIENT BACKGROUND (LAVA LAMP)
// ============================================================
(function () {
  const canvas = document.getElementById('gradient-bg');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  let W, H;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  let scrollOffset = 0, scrollTarget = 0;

  window.addEventListener('mousemove', e => {
    mouse.tx = e.clientX / window.innerWidth;
    mouse.ty = e.clientY / window.innerHeight;
  });

  window.addEventListener('wheel', e => {
    scrollTarget += e.deltaY * 0.003;
  }, { passive: true });

  const PALETTES = [
    ['#ff0080', '#7928ca', '#0070f3', '#00dfd8'],
    ['#f97316', '#ec4899', '#8b5cf6', '#06b6d4'],
    ['#22c55e', '#3b82f6', '#a855f7', '#f43f5e'],
    ['#fbbf24', '#f97316', '#ef4444', '#ec4899'],
    ['#0ea5e9', '#6366f1', '#8b5cf6', '#d946ef'],
    ['#34d399', '#059669', '#0891b2', '#7c3aed'],
  ];

  function hexToRgb(h) {
    return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpRgb(a, b, t) { return a.map((v, i) => Math.round(lerp(v, b[i], t))); }

  class Orb {
    constructor(idx) {
      this.idx      = idx;
      this.colorIdx = idx % 4;
      this.x        = 0.15 + Math.random() * 0.7;
      this.y        = 0.15 + Math.random() * 0.7;
      this.speed    = 0.0018 + Math.random() * 0.0012;
      this.phase    = Math.random() * Math.PI * 6;
      this.size     = 0.18 + Math.random() * 0.18;
      this.scrollF  = (Math.random() - 0.5) * 0.3;
      this.mouseF   = 0.12 + Math.random() * 0.18;
    }

    update(t, scroll) {
      const nx = 0.5 + Math.sin(t * this.speed * 60 + this.phase) * 0.38;
      const ny = 0.5 + Math.cos(t * this.speed * 47 + this.phase * 1.3) * 0.38;
      const mx = nx + (mouse.x - 0.5) * this.mouseF * (this.idx % 2 === 0 ?  1 : -1);
      const my = ny + (mouse.y - 0.5) * this.mouseF * (this.idx % 3 === 0 ?  1 : -1);
      this.x = lerp(this.x, mx, 0.025);
      this.y = lerp(this.y, my + scroll * this.scrollF, 0.025);
    }
  }

  const orbs = Array.from({ length: 6 }, (_, i) => new Orb(i));
  let palA = 0, palB = 1, palT = 0, palTimer = 0, time = 0;

  function getColor(idx) {
    const a = hexToRgb(PALETTES[palA][idx % 4]);
    const b = hexToRgb(PALETTES[palB][idx % 4]);
    return lerpRgb(a, b, palT);
  }

  function frame() {
    time     += 0.008;
    palTimer += 0.008;
    scrollOffset = lerp(scrollOffset, scrollTarget, 0.06);
    mouse.x      = lerp(mouse.x, mouse.tx, 0.06);
    mouse.y      = lerp(mouse.y, mouse.ty, 0.06);

    if (palTimer > 4) {
      palTimer = 0;
      palA = palB;
      palB = (palB + 1) % PALETTES.length;
      palT = 0;
    }
    palT = Math.min(1, palT + 0.004);

    ctx.clearRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'blur(5px)';

    for (let i = 0; i < orbs.length; i++) {
      const o   = orbs[i];
      o.update(time, scrollOffset);

      const px  = o.x * W;
      const py  = o.y * H;
      const r   = o.size * Math.max(W, H) * 0.75;
      const rgb = getColor(i);

      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0,   `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`);
      g.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.4)`);
      g.addColorStop(1,   `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);

      ctx.beginPath();
      ctx.ellipse(
        px, py,
        r * (1 + Math.sin(time * 0.7 + o.phase) * 0.15),
        r * (1 + Math.cos(time * 0.5 + o.phase) * 0.15),
        time * 0.1 + o.phase, 0, Math.PI * 2
      );
      ctx.fillStyle = g;
      ctx.fill();
    }

    ctx.filter = 'none';

    requestAnimationFrame(frame);
  }

  frame();
})();

// ============================================================
// UNIVERSAL SCROLL ANIMATIONS
// ============================================================
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
    }
  });
}, {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
});

// Auto-observe all elements that should animate on scroll
document.addEventListener('DOMContentLoaded', () => {
  const animateElements = document.querySelectorAll(`
    .welcome-section,
    .demo-reel,
    .card,
    .project-content,
    .project-section > .menu,
    .contact-section,
    #demo-section,
    #about-section
  `);
  
  animateElements.forEach(el => {
    el.classList.add('animate');
    observer.observe(el);
  });
});
