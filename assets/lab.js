// Lab — shared helpers for the in-browser demos. No dependencies.
// Charts set geometry through SVG attributes and classes from lab.css, never inline styles.
(() => {
  const NS = 'http://www.w3.org/2000/svg';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids)) if (c != null) n.append(c);
    return n;
  };

  const svgEl = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- formatting ----------
  const fmt = {
    num: (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–'),
    pct: (n, d = 1) => (Number.isFinite(n) ? (n * 100).toFixed(d) + '%' : '–'),
    signedPct: (n, d = 1) => (Number.isFinite(n) ? (n >= 0 ? '+' : '−') + Math.abs(n * 100).toFixed(d) + '%' : '–'),
    eur: (n, d = 0) => (Number.isFinite(n) ? '€' + n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–'),
    compact: (n) => {
      if (!Number.isFinite(n)) return '–';
      const a = Math.abs(n);
      if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
      if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
      return n.toFixed(a < 10 && a % 1 ? 1 : 0);
    },
    eurCompact: (n) => (Number.isFinite(n) ? (n < 0 ? '−€' : '€') + fmt.compact(Math.abs(n)) : '–'),
  };

  // ---------- seeded randomness (deterministic demo data) ----------
  const rng = (seed = 1) => {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.normal = (mu = 0, sd = 1) => {
      const u = 1 - next(), v = next();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    return next;
  };

  // ---------- stats ----------
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : NaN);
  const sd = (a) => {
    const m = mean(a);
    return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / Math.max(1, a.length - 1));
  };
  const quantile = (a, q) => {
    const s = [...a].sort((x, y) => x - y);
    const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return s[lo] + (s[hi] - s[lo]) * (p - lo);
  };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // Solve A x = b (Gaussian elimination, partial pivoting). Small dense systems only.
  const solve = (A, b) => {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c] || 1e-12;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / d;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / (r[i] || 1e-12));
  };

  // Ridge regression: X rows are observations (include a 1s column yourself for an intercept).
  const ridge = (X, y, lambda = 0, noPenalty = [0]) => {
    const p = X[0].length;
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    X.forEach((row, i) => {
      for (let a = 0; a < p; a++) {
        Xty[a] += row[a] * y[i];
        for (let b = 0; b < p; b++) XtX[a][b] += row[a] * row[b];
      }
    });
    for (let a = 0; a < p; a++) if (!noPenalty.includes(a)) XtX[a][a] += lambda;
    return solve(XtX, Xty);
  };

  // ---------- CSV ----------
  const parseCSV = (text) => {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
        else if (c === '"') q = false;
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim());
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  };
  const toCSV = (objs, cols = Object.keys(objs[0] || {})) => {
    const q = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(','), ...objs.map((o) => cols.map((c) => q(o[c])).join(','))].join('\n');
  };
  const download = (name, text, type = 'text/csv') => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const readFile = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsText(file);
  });

  const debounce = (fn, ms = 120) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  // ---------- tooltip ----------
  let tipEl;
  const tip = {
    show(html, x, y) {
      if (!tipEl) { tipEl = el('div', { class: 'tip', 'aria-hidden': 'true' }); document.body.append(tipEl); }
      tipEl.innerHTML = html;
      tipEl.classList.add('on');
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      // cursor-following position is runtime state; the no-inline-styles rule covers authored markup
      tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + 'px';
      tipEl.style.top = Math.max(8, y - h - 12) + 'px';
    },
    hide() { tipEl && tipEl.classList.remove('on'); },
  };

  // ---------- charts ----------
  const niceTicks = (lo, hi, n = 5) => {
    if (lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const t = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) t.push(+v.toFixed(10));
    return t;
  };

  // Charts draw at the host's real pixel width so text stays legible on phones; redrawn on resize.
  const drawn = new Set();
  const redrawAll = debounce(() => drawn.forEach((h) => {
    if (h.isConnected && h.clientWidth && Math.abs((h._labW || 0) - h.clientWidth) > 4) h._labDraw();
  }), 150);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(redrawAll) : null;
  const remember = (host, fn, o) => {
    host._labDraw = () => fn(host, o);
    if (!drawn.has(host)) { drawn.add(host); ro && ro.observe(host); }
  };
  const hostWidth = (host) => Math.max(300, Math.round(host.clientWidth || 720));

  // frame(host, { width, height, m, ariaLabel, sample, interactive })
  //   sample: 'Synthetic · 104 wks' → small corner tag in a reserved top strip (height grows to keep the plot size).
  //   interactive: true → svg is role="group" (role="img" would hide the keyboard slider inside it) and a
  //   visually-hidden polite live region is appended to the host; returned as f.live.
  const frame = (host, { width = hostWidth(host), height = 300, m = { t: 14, r: 16, b: 30, l: 52 }, ariaLabel = 'Chart', sample, interactive } = {}) => {
    m = { ...m };
    if (sample) { m.t += 18; height += 18; }
    host._labW = width;
    host.innerHTML = '';
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: interactive ? 'group' : 'img', 'aria-label': ariaLabel });
    host.appendChild(svg);
    if (sample) svgEl('text', { x: width - 2, y: 13, 'text-anchor': 'end', class: 'lbl lbl--sample' }, svg).textContent = sample;
    const live = interactive ? el('div', { class: 'sr-only', 'aria-live': 'polite' }) : null;
    if (live) host.appendChild(live);
    return { svg, W: width - m.l - m.r, H: height - m.t - m.b, m, width, height, live };
  };

  const yAxis = (f, y, ticks, yfmt) => {
    ticks.forEach((t) => {
      const yy = f.m.t + y(t);
      svgEl('line', { x1: f.m.l, x2: f.m.l + f.W, y1: yy, y2: yy, class: 'grid' }, f.svg);
      svgEl('text', { x: f.m.l - 8, y: yy + 3.5, 'text-anchor': 'end', class: 'tick' }, f.svg).textContent = yfmt(t);
    });
  };

  /*
    line(host, {
      x: [labels…],                       // category labels, one per point
      xValues: [numbers…], xfmt           // optional numeric x: points placed by value, x ticks from niceTicks
      series: [{ values, cls: 's-ink'|'s-accent'|'s-muted', name, area?: true, label?: 'Fitted' }],
                                          // label → direct label right of the last point (lets pages drop the legend)
      sample: 'Synthetic · 104 wks',      // corner data tag
      bands: [{ lo: [...], hi: [...] }],  // shaded intervals
      markers: [index…],                  // vertical dashed lines (e.g. test start)
      yfmt, xEvery, height, yMin, yMax, ariaLabel, tipFmt(i) → html
    })
  */
  const line = (host, o) => {
    remember(host, line, o);
    const labelled = o.series.filter((s) => s.label);
    const m = { t: 14, r: 16, b: 30, l: 52 };
    if (labelled.length) m.r = Math.round(Math.min(hostWidth(host) * 0.3, 14 + Math.max(...labelled.map((s) => String(s.label).length)) * 7.6));
    const f = frame(host, { height: o.height || 300, m, ariaLabel: o.ariaLabel, sample: o.sample, interactive: !!o.tipFmt });
    const xv = o.xValues;
    const n = xv ? xv.length : o.x.length;
    const all = [
      ...o.series.flatMap((s) => s.values),
      ...(o.bands || []).flatMap((b) => [...b.lo, ...b.hi]),
    ].filter(Number.isFinite);
    let lo = o.yMin ?? Math.min(...all), hi = o.yMax ?? Math.max(...all);
    if (o.yMin == null && lo > 0 && lo < hi * 0.35) lo = 0;
    const ticks = niceTicks(lo, hi);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const x0 = xv ? Math.min(...xv) : 0, x1 = xv ? Math.max(...xv) : 0;
    const xs = (v) => ((v - x0) / (x1 - x0 || 1)) * f.W;
    const x = xv
      ? (i) => { const a = Math.floor(i), b = Math.ceil(i); return xs(a === b ? xv[a] : xv[a] + (xv[b] - xv[a]) * (i - a)); }
      : (i) => (n <= 1 ? f.W / 2 : (i / (n - 1)) * f.W);
    const y = (v) => f.H - ((v - lo) / (hi - lo || 1)) * f.H;
    const yfmt = o.yfmt || fmt.compact;
    yAxis(f, y, ticks, yfmt);

    const g = svgEl('g', { transform: `translate(${f.m.l},${f.m.t})` }, f.svg);
    if (xv) {
      const xfmt = o.xfmt || fmt.compact;
      niceTicks(x0, x1, Math.max(2, Math.floor(f.W / 80))).forEach((t) => {
        if (t < x0 || t > x1) return;
        svgEl('text', { x: xs(t), y: f.H + 20, 'text-anchor': 'middle', class: 'tick' }, g).textContent = xfmt(t);
      });
    } else {
      const every = o.xEvery || Math.max(1, Math.ceil(n / Math.max(2, Math.floor(f.W / 64))));
      o.x.forEach((lab, i) => {
        if (i % every) return;
        svgEl('text', { x: x(i), y: f.H + 20, 'text-anchor': 'middle', class: 'tick' }, g).textContent = lab;
      });
    }
    svgEl('line', { x1: 0, x2: f.W, y1: f.H, y2: f.H, class: 'axis' }, g);

    const path = (vals) => vals.map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(vals[i - 1]) ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}` : '')).join('');
    (o.bands || []).forEach((b) => {
      const idx = b.lo.map((v, i) => i).filter((i) => Number.isFinite(b.lo[i]) && Number.isFinite(b.hi[i]));
      if (!idx.length) return;
      const d = idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.hi[i]).toFixed(1)}`).join('') +
        [...idx].reverse().map((i) => `L${x(i).toFixed(1)},${y(b.lo[i]).toFixed(1)}`).join('') + 'Z';
      svgEl('path', { d, class: b.cls || 'band' }, g);
    });
    o.series.forEach((s) => {
      if (s.area) {
        const idx = s.values.map((v, i) => i).filter((i) => Number.isFinite(s.values[i]));
        const d = idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.values[i]).toFixed(1)}`).join('') +
          `L${x(idx[idx.length - 1]).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}L${x(idx[0]).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}Z`;
        svgEl('path', { d, class: 'area' }, g);
      }
      svgEl('path', { d: path(s.values), class: s.cls || 's-ink' }, g);
    });
    if (lo < 0 && hi > 0) svgEl('line', { x1: 0, x2: f.W, y1: y(0), y2: y(0), class: 'axis' }, g);
    (o.markers || []).forEach((i) => svgEl('line', { x1: x(i), x2: x(i), y1: 0, y2: f.H, class: 'marker' }, g));
    (o.points || []).forEach((p) => svgEl('circle', { cx: x(p.i), cy: y(p.v), r: p.r || 4, class: p.cls || 'dot-accent' }, g));

    // direct labels: sorted by y, pushed apart to ≥14px, then pulled back inside the plot from the bottom
    const dl = labelled.map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && !Number.isFinite(s.values[i])) i--;
      return i < 0 ? null : { s, i, yy: y(s.values[i]) };
    }).filter(Boolean).sort((a, b) => a.yy - b.yy);
    dl.forEach((d, k) => { if (k && d.yy - dl[k - 1].yy < 14) d.yy = dl[k - 1].yy + 14; });
    for (let k = dl.length - 1, lim = f.H; k >= 0; k--) { dl[k].yy = Math.min(dl[k].yy, lim); lim = dl[k].yy - 14; }
    const lblCls = { 's-accent': 'lbl lbl--accent', 's-muted': 'lbl lbl--muted', 's-faint': 'lbl lbl--muted' };
    dl.forEach((d) => {
      svgEl('text', { x: x(d.i) + 8, y: d.yy + 4, class: lblCls[d.s.cls] || 'lbl' }, g).textContent = d.s.label;
    });

    if (o.tipFmt) {
      // keyboard path: focus the plot, arrows step through points; the tooltip mirrors into a live region
      const hit = svgEl('rect', { x: 0, y: 0, width: f.W, height: f.H, class: 'hit', tabindex: 0, role: 'slider', 'aria-label': (o.ariaLabel || 'Chart') + '. Use arrow keys to read values.', 'aria-valuemin': 0, 'aria-valuemax': n - 1, 'aria-valuenow': 0 }, g);
      const guide = svgEl('line', { x1: 0, x2: 0, y1: 0, y2: f.H, class: 'axis', visibility: 'hidden' }, g);
      let cur = 0;
      const at = (i, cx, cy) => {
        cur = i;
        guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('visibility', 'visible');
        const html = o.tipFmt(i);
        hit.setAttribute('aria-valuenow', i);
        const text = html.replace(/<br\s*\/?>/g, ', ').replace(/<[^>]+>/g, '');
        hit.setAttribute('aria-valuetext', text);
        tip.show(html, cx, cy);
        return text;
      };
      const move = (ev) => {
        const r = hit.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * f.W;
        let best = 0;
        for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
        at(best, ev.clientX, ev.clientY);
      };
      const off = () => { tip.hide(); guide.setAttribute('visibility', 'hidden'); };
      hit.addEventListener('pointermove', move);
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('blur', off);
      hit.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
        let i = step ? clamp(cur + step, 0, n - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
        if (i == null) return;
        e.preventDefault();
        const r = hit.getBoundingClientRect();
        f.live.textContent = at(i, r.left + (x(i) / f.W) * r.width, r.top + 24);
      });
    }
    return { x, y, f, g };
  };

  /*
    bars(host, {
      labels: [...],
      groups: [{ values, cls: 'b-ink'|'b-accent'|'b-muted'|'b-mid', name }],  // grouped side by side
      stacked: false,                     // true → groups stack
      horizontal: false,                  // true → label column on the left (good for mobile)
      yfmt, valueFmt(v, i, gi), height, ariaLabel, tipFmt(i, gi) → html
      valueEach: false,                   // false → one direct label per category (stacked: total; grouped: last
                                          //   group's value, placed past the longest bar); true → a label on every bar
      refLine: number,                    // dashed reference line (vertical bars only)
      sample: 'Synthetic · 104 wks'       // corner data tag
    })
  */
  const bars = (host, o) => {
    remember(host, bars, o);
    const n = o.labels.length, G = o.groups.length;
    const yfmt = o.yfmt || fmt.compact;
    if (o.horizontal) {
      const rowH = o.rowH || (o.stacked || G === 1 ? 26 : 14 * G + 10);
      const labW = Math.min(o.labelWidth || 150, Math.round(hostWidth(host) * 0.4));
      const maxChars = Math.floor((labW - 12) / 7.6);
      const f = frame(host, { height: n * rowH + 34, m: { t: 6, r: 64, b: 26, l: labW }, ariaLabel: o.ariaLabel, sample: o.sample });
      const totals = o.labels.map((_, i) => (o.stacked ? sum(o.groups.map((g) => Math.max(0, g.values[i]))) : Math.max(...o.groups.map((g) => g.values[i]))));
      const mins = o.labels.map((_, i) => Math.min(0, ...o.groups.map((g) => g.values[i])));
      let lo = Math.min(0, ...mins), hi = Math.max(...totals, 0);
      const ticks = niceTicks(lo, hi, 4);
      lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
      const x = (v) => ((v - lo) / (hi - lo || 1)) * f.W;
      const g = svgEl('g', { transform: `translate(${f.m.l},${f.m.t})` }, f.svg);
      ticks.forEach((t) => {
        svgEl('line', { x1: x(t), x2: x(t), y1: 0, y2: n * rowH, class: 'grid' }, g);
        svgEl('text', { x: x(t), y: n * rowH + 16, 'text-anchor': 'middle', class: 'tick' }, g).textContent = yfmt(t);
      });
      o.labels.forEach((lab, i) => {
        const y0 = i * rowH;
        const t = svgEl('text', { x: -10, y: y0 + rowH / 2 + 4, 'text-anchor': 'end', class: 'lbl' }, g);
        t.textContent = lab.length > maxChars ? lab.slice(0, maxChars - 1) + '…' : lab;
        if (lab.length > maxChars) svgEl('title', {}, t).textContent = lab;
        let acc = 0;
        o.groups.forEach((gr, gi) => {
          const v = gr.values[i];
          const bh = o.stacked || G === 1 ? rowH - 8 : (rowH - 10) / G;
          const by = o.stacked || G === 1 ? y0 + 4 : y0 + 5 + gi * bh;
          const a = o.stacked ? acc : 0;
          const r = svgEl('rect', { x: x(Math.min(a, a + v)), y: by, width: Math.max(0.5, Math.abs(x(a + v) - x(a))), height: Math.max(1, bh - 1), class: gr.cls || 'b-ink' }, g);
          if (o.tipFmt) {
            r.addEventListener('pointermove', (ev) => tip.show(o.tipFmt(i, gi), ev.clientX, ev.clientY));
            r.addEventListener('pointerleave', tip.hide);
          }
          if (o.valueFmt && o.valueEach && !o.stacked) svgEl('text', { x: x(Math.max(0, v)) + 6, y: by + bh / 2 + 4, class: 'tick' }, g).textContent = o.valueFmt(v, i, gi);
          if (o.stacked) acc += v;
        });
        if (o.valueFmt && !(o.valueEach && !o.stacked)) {
          const v = o.stacked ? acc : o.groups[G - 1].values[i];
          const end = o.stacked ? acc : Math.max(...o.groups.map((gr) => gr.values[i]));
          svgEl('text', { x: x(Math.max(0, end)) + 6, y: y0 + rowH / 2 + 4, class: 'tick' }, g).textContent = o.valueFmt(v, i, G - 1);
        }
      });
      svgEl('line', { x1: x(0), x2: x(0), y1: 0, y2: n * rowH, class: 'axis' }, g);
      return;
    }
    const f = frame(host, { height: o.height || 280, m: { t: o.valueFmt ? 30 : 14, r: 16, b: 30, l: 52 }, ariaLabel: o.ariaLabel, sample: o.sample });
    const totals = o.labels.map((_, i) => (o.stacked ? sum(o.groups.map((g) => Math.max(0, g.values[i]))) : Math.max(...o.groups.map((g) => g.values[i]))));
    let lo = Math.min(0, ...o.groups.flatMap((g) => g.values)), hi = Math.max(...totals, 0);
    const ticks = niceTicks(lo, hi);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const y = (v) => f.H - ((v - lo) / (hi - lo || 1)) * f.H;
    yAxis(f, y, ticks, yfmt);
    const g = svgEl('g', { transform: `translate(${f.m.l},${f.m.t})` }, f.svg);
    const slot = f.W / n, pad = Math.min(14, slot * 0.18);
    const every = o.xEvery || Math.max(1, Math.ceil(n / Math.max(2, Math.floor(f.W / 40))));
    o.labels.forEach((lab, i) => {
      const x0 = i * slot + pad, w = slot - 2 * pad;
      let acc = 0;
      o.groups.forEach((gr, gi) => {
        const v = gr.values[i];
        const bw = o.stacked ? w : w / G;
        const bx = o.stacked ? x0 : x0 + gi * bw;
        const a = o.stacked ? acc : 0;
        const r = svgEl('rect', { x: bx, y: y(Math.max(a, a + v)), width: Math.max(1, bw - (o.stacked ? 0 : 2)), height: Math.max(0.5, Math.abs(y(a) - y(a + v))), class: gr.cls || 'b-ink' }, g);
        if (o.tipFmt) {
          r.addEventListener('pointermove', (ev) => tip.show(o.tipFmt(i, gi), ev.clientX, ev.clientY));
          r.addEventListener('pointerleave', tip.hide);
        }
        if (o.valueFmt && o.valueEach && !o.stacked) svgEl('text', { x: bx + bw / 2, y: y(Math.max(0, v)) - 6, 'text-anchor': 'middle', class: 'tick' }, g).textContent = o.valueFmt(v, i, gi);
        if (o.stacked) acc += v;
      });
      if (o.valueFmt && !(o.valueEach && !o.stacked)) {
        const v = o.stacked ? acc : o.groups[G - 1].values[i];
        const top = o.stacked ? acc : Math.max(...o.groups.map((gr) => gr.values[i]));
        svgEl('text', { x: x0 + w / 2, y: y(Math.max(0, top)) - 6, 'text-anchor': 'middle', class: 'tick' }, g).textContent = o.valueFmt(v, i, G - 1);
      }
      if (!(i % every)) svgEl('text', { x: x0 + w / 2, y: f.H + 20, 'text-anchor': 'middle', class: 'tick' }, g).textContent = lab;
    });
    svgEl('line', { x1: 0, x2: f.W, y1: y(0), y2: y(0), class: 'axis' }, g);
    if (Number.isFinite(o.refLine)) svgEl('line', { x1: 0, x2: f.W, y1: y(o.refLine), y2: y(o.refLine), class: 's-muted' }, g);
  };

  /* histogram(host, { values, mark: number, markLabel, bins, xfmt, ariaLabel, sample, valueFmt(count, i) })
     mark drawn as accent line; valueFmt → count label above each non-empty bin wide enough (≥22px) to hold it */
  const histogram = (host, o) => {
    remember(host, histogram, o);
    const v = o.values.filter(Number.isFinite);
    const lo = Math.min(...v, o.mark ?? Infinity), hi = Math.max(...v, o.mark ?? -Infinity);
    const B = o.bins || 20, w = (hi - lo) / B || 1;
    const counts = new Array(B).fill(0);
    v.forEach((x) => counts[Math.min(B - 1, Math.floor((x - lo) / w))]++);
    const f = frame(host, { height: o.height || 220, m: { t: o.valueFmt ? 28 : 14, r: 16, b: 30, l: 52 }, ariaLabel: o.ariaLabel, sample: o.sample });
    const ticks = niceTicks(0, Math.max(...counts), 4);
    const top = ticks[ticks.length - 1] || 1;
    const y = (c) => f.H - (c / top) * f.H;
    yAxis(f, y, ticks, (t) => String(t));
    const g = svgEl('g', { transform: `translate(${f.m.l},${f.m.t})` }, f.svg);
    const x = (val) => ((val - lo) / (hi - lo || 1)) * f.W;
    counts.forEach((c, i) => svgEl('rect', { x: (i / B) * f.W + 1, y: y(c), width: Math.max(1, f.W / B - 2), height: f.H - y(c), class: 'b-muted' }, g));
    if (o.valueFmt && f.W / B >= 22) counts.forEach((c, i) => {
      if (c) svgEl('text', { x: ((i + 0.5) / B) * f.W, y: y(c) - 5, 'text-anchor': 'middle', class: 'tick' }, g).textContent = o.valueFmt(c, i);
    });
    const xfmt = o.xfmt || fmt.compact;
    niceTicks(lo, hi, 5).forEach((t) => {
      if (t < lo || t > hi) return;
      svgEl('text', { x: x(t), y: f.H + 20, 'text-anchor': 'middle', class: 'tick' }, g).textContent = xfmt(t);
    });
    svgEl('line', { x1: 0, x2: f.W, y1: f.H, y2: f.H, class: 'axis' }, g);
    if (Number.isFinite(o.mark)) {
      svgEl('line', { x1: x(o.mark), x2: x(o.mark), y1: 0, y2: f.H, class: 's-accent' }, g);
      if (o.markLabel) svgEl('text', { x: Math.min(f.W - 4, x(o.mark) + 6), y: 12, 'text-anchor': x(o.mark) > f.W * 0.8 ? 'end' : 'start', class: 'lbl' }, g).textContent = o.markLabel;
    }
  };

  // ---------- tabs ----------
  // Markup: <div class="tabs" role="tablist"><button class="tab" role="tab" aria-controls="p1">…</button></div> + <div role="tabpanel" id="p1">
  const tabs = (root = document, onChange) => {
    $$('[role="tablist"]', root).forEach((list) => {
      const btns = $$('[role="tab"]', list);
      const select = (b) => {
        btns.forEach((x) => {
          const on = x === b;
          x.setAttribute('aria-selected', String(on));
          x.tabIndex = on ? 0 : -1;
          const p = document.getElementById(x.getAttribute('aria-controls'));
          if (p) p.hidden = !on;
        });
        onChange && onChange(b.getAttribute('aria-controls'));
      };
      btns.forEach((b, i) => {
        b.addEventListener('click', () => select(b));
        b.addEventListener('keydown', (e) => {
          const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          const j = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : d ? (i + d + btns.length) % btns.length : -1;
          if (j < 0) return;
          e.preventDefault();
          const nb = btns[j];
          nb.focus(); select(nb);
        });
      });
      select(btns.find((b) => b.getAttribute('aria-selected') === 'true') || btns[0]);
    });
  };

  // Range input bound to an <output for="id">; returns a getter.
  const bindRange = (id, fmtFn, onInput) => {
    const input = document.getElementById(id);
    const out = document.querySelector(`output[for="${id}"]`);
    const sync = () => {
      const text = fmtFn ? fmtFn(+input.value) : input.value;
      if (out) out.textContent = text;
      input.setAttribute('aria-valuetext', text);
    };
    input.addEventListener('input', () => { sync(); onInput && onInput(+input.value); });
    sync();
    return () => +input.value;
  };

  // Segmented control: buttons with aria-pressed; returns getter of data-value.
  const bindSeg = (root, onChange) => {
    const btns = $$('button', root);
    btns.forEach((b) => b.addEventListener('click', () => {
      btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange && onChange(b.dataset.value);
    }));
    return () => (btns.find((b) => b.getAttribute('aria-pressed') === 'true') || btns[0]).dataset.value;
  };

  /*
    figure(host, { caption, legend, position: 'top'|'bottom' }) → <figure>
      Wraps a chart host (once) in <figure class="lab-figure"> with a <figcaption> takeaway sentence; call again to
      update the caption. legend: an element (e.g. the .legend under the chart) moved inside the figure.
  */
  const figure = (host, { caption, legend, position = 'top' } = {}) => {
    let fig = host.parentElement;
    if (!fig || !fig.matches('figure.lab-figure')) {
      fig = el('figure', { class: 'lab-figure' });
      host.before(fig);
      fig.append(host);
    }
    if (legend && legend.parentElement !== fig) host.after(legend);
    if (caption != null) {
      let cap = $(':scope > figcaption', fig);
      if (!cap) {
        cap = el('figcaption');
        if (position === 'bottom') fig.append(cap); else fig.prepend(cap);
      }
      cap.textContent = caption;
    }
    return fig;
  };

  /*
    dataTable(host, columns, rows, { summary = 'Data table', open }) → <details>
      columns: ['Week', …] or [{ label, key?, num?: true, hideSm?: true, fmt?: (v, row) → string }]
      rows: arrays (by column index) or objects (by column key).
      Renders <details class="lab-data"><summary>…</summary><div class="tbl-wrap"><table class="tbl">…</table></div></details>
      into host (replacing its content); keeps the open state across re-renders.
  */
  const dataTable = (host, columns, rows, { summary = 'Data table', open } = {}) => {
    const cols = columns.map((c) => (typeof c === 'string' ? { label: c } : c));
    const prev = $(':scope > details.lab-data', host);
    const cls = (c) => [c.num && 'num', c.hideSm && 'hide-sm'].filter(Boolean).join(' ') || null;
    const cell = (r, c, ci) => {
      const v = Array.isArray(r) ? r[ci] : r[c.key];
      return c.fmt ? c.fmt(v, r) : v == null ? '' : String(v);
    };
    const det = el('details', { class: 'lab-data', open: open ?? (prev ? prev.open : false) }, [
      el('summary', { text: summary }),
      el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, [
        el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col', class: cls(c), text: c.label })))),
        el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c, ci) => el('td', { class: cls(c), text: cell(r, c, ci) }))))),
      ])),
    ]);
    host.replaceChildren(det);
    return det;
  };

  // Horizontal-scroll cue: any .tbl-wrap wider than its content gets .is-scrollable (and .is-end once scrolled to
  // the right edge). Found automatically as pages render; scrollCue() forces a re-check.
  const wraps = new WeakSet();
  const cueOne = (w) => {
    const over = w.scrollWidth - w.clientWidth > 2;
    w.classList.toggle('is-scrollable', over);
    w.classList.toggle('is-end', over && w.scrollLeft + w.clientWidth >= w.scrollWidth - 2);
  };
  const cueRO = 'ResizeObserver' in window ? new ResizeObserver((es) => es.forEach((e) => cueOne(e.target))) : null;
  const scrollCue = () => $$('.tbl-wrap').forEach((w) => {
    if (!wraps.has(w)) {
      wraps.add(w);
      w.addEventListener('scroll', () => cueOne(w), { passive: true });
      cueRO && cueRO.observe(w);
    }
    cueOne(w);
  });
  const cueSoon = debounce(scrollCue, 100);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scrollCue); else scrollCue();
  // tooltip and chart redraws mutate constantly and never contain tables
  new MutationObserver((recs) => {
    if (recs.some((r) => !(r.target.closest && r.target.closest('.tip, .chart')))) cueSoon();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', cueSoon);

  window.Lab = { $, $$, el, svgEl, esc, fmt, rng, sum, mean, sd, quantile, clamp, solve, ridge, parseCSV, toCSV, download, readFile, debounce, tip, niceTicks, line, bars, histogram, tabs, bindRange, bindSeg, figure, dataTable, scrollCue };
})();
