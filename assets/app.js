// Niklaas Dumroese — personal site interactions (minimal, a11y-aware)
(() => {
  // Mobile nav
  const toggle = document.querySelector('.nav__toggle');
  const links = document.querySelector('.nav__links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    links.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => {
        links.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      })
    );
  }

  // Auto-open a <details> accordion when its id is the URL hash (deep links)
  const openFromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (el && el.tagName.toLowerCase() === 'details') {
      el.open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  // same-page clicks to an accordion id
  document.querySelectorAll('a[href*="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href') || '';
      const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
      if (!hash) return;
      const el = document.getElementById(hash);
      if (el && el.tagName.toLowerCase() === 'details') el.open = true;
    });
  });
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  // Scroll reveal
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.style.transitionDelay = (e.target.dataset.delay || '0') + 'ms';
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );
  els.forEach((el) => io.observe(el));
})();
