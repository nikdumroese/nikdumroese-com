// Niklaas Dumroese — personal site interactions (minimal, a11y-aware)
(() => {
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

})();
