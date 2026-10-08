// 01 — Media mix model & budget optimizer. Runs entirely in the browser on window.Lab.
(() => {
  const L = window.Lab;
  const HOLD = 13, PERIOD = 52.18, HARMONICS = 3, LAMBDA = 0.05;
  const DECAYS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const KMULT = [0.4, 0.6, 0.8, 1, 1.3, 1.7, 2.2, 3];
  const SHAPES = [1, 1.5, 2.2];
  const CFG = { DECAYS, KMULT, SHAPES, LAMBDA, PRIOR: 1, NOISE: 0.02 };
  const near = (arr, v) => arr.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(arr[b] - v) ? i : b), 0);
  const NAMES = ['Paid Search', 'Paid Social', 'YouTube', 'LinkedIn', 'Affiliates'];

  // Ground truth per scenario. kmult = half-saturation as a multiple of the channel's mean weekly spend.
  const SCENARIOS = {
    balanced: {
      seed: 11, label: 'Balanced', flights: 8, collinear: false, follow: [0.35, 0.1],
      truth: [
        { decay: 0.15, kmult: 0.6, shape: 1.2, roi: 2.0 },
        { decay: 0.35, kmult: 1.6, shape: 1.5, roi: 1.9 },
        { decay: 0.6, kmult: 1.0, shape: 2.0, roi: 1.3 },
        { decay: 0.3, kmult: 1.4, shape: 1.3, roi: 0.9 },
        { decay: 0.1, kmult: 1.0, shape: 1.1, roi: 1.9 },
      ],
    },
    collinear: {
      seed: 23, label: 'Collinear', flights: 8, collinear: true, follow: [0.9, 0],
      truth: [
        { decay: 0.2, kmult: 1.0, shape: 1.3, roi: 2.0 },
        { decay: 0.4, kmult: 1.2, shape: 1.6, roi: 1.8 },
        { decay: 0.55, kmult: 0.9, shape: 1.8, roi: 1.1 },
        { decay: 0.25, kmult: 1.3, shape: 1.2, roi: 1.0 },
        { decay: 0.1, kmult: 0.8, shape: 1.0, roi: 2.4 },
      ],
    },
    saturated: {
      seed: 37, label: 'Saturated', flights: 3, collinear: false, follow: [0.6, 0.2],
      truth: [
        { decay: 0.1, kmult: 0.5, shape: 1.4, roi: 1.4 },
        { decay: 0.3, kmult: 1.5, shape: 1.4, roi: 2.1 },
        { decay: 0.7, kmult: 1.2, shape: 2.0, roi: 1.5 },
        { decay: 0.35, kmult: 1.8, shape: 1.2, roi: 1.2 },
        { decay: 0.15, kmult: 1.2, shape: 1.1, roi: 2.0 },
      ],
    },
  };

  // ---------- transforms ----------
  // Normalised geometric adstock: weights sum to 1, so steady-state adstock equals weekly spend.
  const adstock = (x, decay) => {
    const out = new Float64Array(x.length);
    let a = 0;
    for (let i = 0; i < x.length; i++) { a = x[i] + decay * a; out[i] = a * (1 - decay); }
    return out;
  };
  const hill = (v, K, s) => (v <= 0 ? 0 : 1 / (1 + Math.pow(K / v, s)));

  // Smooth yearly demand with a Q4 peak (late November). Real data also has spikes the Fourier terms miss.
  const seasonIdx = (woy) => {
    const a = (2 * Math.PI * (woy - 47)) / 52.18;
    return 1 + 0.1 * Math.cos(a) + 0.05 * Math.cos(2 * a) + 0.025 * Math.cos(3 * a);
  };

  // ---------- synthetic data ----------
  const generate = (key) => {
    const sc = SCENARIOS[key], r = L.rng(sc.seed), n = 104;
    const t0 = Date.UTC(2024, 9, 7);
    const dates = Array.from({ length: n }, (_, i) => new Date(t0 + i * 7 * 864e5));
    const woy = dates.map((d) => (d - Date.UTC(d.getUTCFullYear(), 0, 1)) / (7 * 864e5));
    const s = woy.map(seasonIdx);

    // Always-on search follows demand, with occasional 3-week budget tests up or down.
    const test = new Array(n).fill(1);
    for (let w = 4; w < n - 3; w += 9) if (r() < 0.6) { const f = r() < 0.5 ? 0.6 : 1.4; for (let k = 0; k < 3; k++) test[w + k] = f; }
    const search = s.map((si, i) => Math.max(5000, 50000 * (0.85 + sc.follow[0] * (si - 1) * 2.5) * test[i] * (1 + 0.1 * r.normal())));
    let lvl = 0;
    const social = s.map(() => {
      lvl = 0.8 * lvl + 0.2 * r.normal();
      return Math.max(5000, 30000 * (1 + 0.9 * lvl + 0.15 * r.normal()));
    });
    for (let b = 0; b < 4; b++) { const w = r.int(0, n - 4); for (let k = 0; k < 3; k++) social[w + k] *= 1.6; }
    const youtube = new Array(n).fill(0);
    const span = n / sc.flights;
    for (let f = 0; f < sc.flights; f++) {
      const start = Math.floor(f * span + r() * span * 0.35), len = r.int(4, Math.min(7, Math.floor(span * 0.7)));
      for (let k = 0; k < len && start + k < n; k++) youtube[start + k] = 45000 + 35000 * r();
    }
    let q = -1, qlvl = 0;
    const linkedin = dates.map((d, i) => {
      if (Math.floor(i / 13) !== q) { q = Math.floor(i / 13); qlvl = 4000 + 22000 * r(); }
      return Math.max(5000, qlvl * (1 + 0.1 * r.normal()));
    });
    const affiliates = s.map((si, i) => (sc.collinear
      ? Math.max(5000, 0.3 * search[i] * (1 + 0.05 * r.normal()))
      : Math.max(5000, 15000 * (1 + sc.follow[1] * (si - 1) * 2.5) * (r() < 0.12 ? 1.7 : 1) * (1 + 0.2 * r.normal()))));

    const spends = [search, social, youtube, linkedin, affiliates].map((a) => a.map(Math.round));
    const truth = sc.truth.map((tr, c) => {
      const x = spends[c], K = tr.kmult * L.mean(x);
      const resp = Array.from(adstock(x, tr.decay), (v) => hill(v, K, tr.shape));
      const beta = (tr.roi * L.sum(x)) / L.sum(resp);
      return { ...tr, K, beta, contrib: resp.map((v) => v * beta) };
    });
    const baseline = s.map((si, i) => 500000 * (1 + (0.15 * i) / (n - 1)) * si);
    const revenue = baseline.map((b, i) => {
      const m = L.sum(truth.map((tr) => tr.contrib[i]));
      return Math.round((b + m) * (1 + CFG.NOISE * r.normal()));
    });
    return {
      source: 'synthetic', scenario: key,
      weeks: dates.map((d) => d.toISOString().slice(0, 10)),
      ticks: dates.map((d) => d.toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })),
      revenue,
      channels: NAMES.map((name, c) => ({ name, spend: spends[c] })),
      truth,
    };
  };

  // ---------- CSV ingest ----------
  const toNum = (v) => (v === '' || v == null ? NaN : Number(String(v).replace(/[€\s_]/g, '')));
  const fromCSV = (text) => {
    const rows = L.parseCSV(text), errs = [];
    if (!rows.length) return { errs: ['The file has a header but no rows.'] };
    const head = Object.keys(rows[0]);
    const wk = head.find((h) => h.toLowerCase() === 'week');
    const rv = head.find((h) => h.toLowerCase() === 'revenue');
    if (!wk) errs.push('Missing a "week" column.');
    if (!rv) errs.push('Missing a "revenue" column.');
    const chans = head.filter((h) => h && h !== wk && h !== rv);
    if (!chans.length) errs.push('Add at least one spend column (one per channel).');
    if (chans.length > 8) errs.push(`Found ${chans.length} spend columns; the demo handles up to 8.`);
    if (rows.length < 52) errs.push(`Found ${rows.length} weeks; need at least 52 (13 are held out for testing).`);
    if (errs.length) return { errs };
    const revenue = [], spends = chans.map(() => []);
    rows.forEach((row, i) => {
      const line = i + 2, y = toNum(row[rv]);
      if (!(y > 0)) errs.push(`Row ${line}: revenue "${row[rv]}" is not a positive number.`);
      revenue.push(y);
      chans.forEach((c, j) => {
        const v = toNum(row[c]);
        if (!(v >= 0)) errs.push(`Row ${line}: ${c} spend "${row[c]}" is not a number ≥ 0.`);
        spends[j].push(v);
      });
    });
    chans.forEach((c, j) => {
      if (spends[j].filter((v) => v > 0).length < 4) errs.push(`${c}: needs spend in at least 4 weeks.`);
    });
    if (errs.length) return { errs: errs.length > 8 ? [...errs.slice(0, 8), `…and ${errs.length - 8} more.`] : errs };
    const weeks = rows.map((row) => row[wk]);
    return { data: { source: 'csv', weeks, ticks: weeks, revenue, channels: chans.map((name, j) => ({ name, spend: spends[j] })), truth: null } };
  };

  const toSample = (data) => L.toCSV(data.weeks.map((w, i) => {
    const o = { week: w, revenue: data.revenue[i] };
    data.channels.forEach((c) => { o[c.name] = c.spend[i]; });
    return o;
  }), ['week', 'revenue', ...data.channels.map((c) => c.name)]);

  // ---------- model ----------
  const controls = (n) => Array.from({ length: n }, (_, i) => {
    const row = [1, i / (n - 1)];
    for (let k = 1; k <= HARMONICS; k++) {
      const a = (2 * Math.PI * k * i) / PERIOD;
      row.push(Math.sin(a), Math.cos(a));
    }
    return row;
  });

  // Ridge with non-negative media coefficients: drop the most negative media column and refit until none are negative.
  const nnFit = (ctrl, cols, y, rows) => {
    const nc = ctrl[0].length, active = cols.map((_, j) => j);
    for (;;) {
      const X = rows.map((i) => ctrl[i].concat(active.map((j) => cols[j][i])));
      const b = L.ridge(X, rows.map((i) => y[i]), CFG.LAMBDA, [0]);
      let worst = -1, wv = 0;
      active.forEach((j, k) => { if (b[nc + k] < wv) { wv = b[nc + k]; worst = k; } });
      if (worst < 0) {
        const media = cols.map(() => 0);
        active.forEach((j, k) => { media[j] = b[nc + k]; });
        let sse = 0;
        X.forEach((x, r) => { let p = 0; for (let k = 0; k < x.length; k++) p += x[k] * b[k]; sse += (y[rows[r]] - p) ** 2; });
        return { base: b.slice(0, nc), media, sse };
      }
      active.splice(worst, 1);
    }
  };

  const predict = (ctrl, cols, fit, i) =>
    ctrl[i].reduce((s, v, k) => s + v * fit.base[k], 0) + cols.reduce((s, c, j) => s + c[i] * fit.media[j], 0);

  const fitModel = (data) => {
    const T0 = Date.now();
    const n = data.revenue.length, nTr = n - HOLD;
    const ctrl = controls(n);
    const ym = L.mean(data.revenue.slice(0, nTr));
    const y = data.revenue.map((v) => v / ym);
    const train = Array.from({ length: nTr }, (_, i) => i);
    const all = Array.from({ length: n }, (_, i) => i);

    const means = data.channels.map((ch) => L.mean(ch.spend));
    const cands = data.channels.map((ch) => {
      const m = L.mean(ch.spend), list = [];
      CFG.DECAYS.forEach((d, di) => {
        const ad = adstock(ch.spend, d);
        CFG.KMULT.forEach((km, ki) => CFG.SHAPES.forEach((sh, si) => {
          list.push({ di, ki, si, decay: d, K: km * m, shape: sh, col: Array.from(ad, (v) => hill(v, km * m, sh)) });
        }));
      });
      return list;
    });
    const pick = cands.map((list) => list.findIndex((c) => c.di === near(CFG.DECAYS, 0.3) && c.ki === near(CFG.KMULT, 1) && c.si === near(CFG.SHAPES, 1.5)));
    const colsOf = () => pick.map((p, c) => cands[c][p].col);

    // Weak priors on curve shape (as a Bayesian MMM would use) stop the grid search chasing noise.
    const prior = (cd, c) => CFG.PRIOR * (((cd.decay - 0.3) / 0.3) ** 2 + (Math.log(cd.K / means[c]) / 0.8) ** 2 + ((cd.shape - 1.5) / 0.7) ** 2);
    const score = (cols) => nnFit(ctrl, cols, y, train).sse / sigma2 + L.sum(pick.map((p, c) => prior(cands[c][p], c)));
    const sigma2 = nnFit(ctrl, colsOf(), y, train).sse / (nTr - ctrl[0].length - cands.length);
    let evals = 0, best = score(colsOf());
    for (let sweep = 0; sweep < 4; sweep++) {
      let moved = false;
      cands.forEach((list, c) => {
        const cols = colsOf();
        list.forEach((cand, p) => {
          if (p === pick[c]) return;
          cols[c] = cand.col;
          const keep = pick[c];
          pick[c] = p;
          const sc = score(cols);
          pick[c] = keep;
          evals++;
          if (sc < best - 1e-9) { best = sc; pick[c] = p; moved = true; }
        });
      });
      if (!moved) break;
    }

    const cols = colsOf();
    const trFit = nnFit(ctrl, cols, y, train);
    const fitted = all.map((i) => predict(ctrl, cols, trFit, i) * ym);
    const act = data.revenue;
    const ybar = L.mean(act.slice(0, nTr));
    let ssr = 0, sst = 0;
    for (let i = 0; i < nTr; i++) { ssr += (act[i] - fitted[i]) ** 2; sst += (act[i] - ybar) ** 2; }
    const ape = all.map((i) => Math.abs(act[i] - fitted[i]) / act[i]);

    // Curve shapes chosen on training weeks; coefficients refit on all weeks for decomposition and planning.
    const fullFit = nnFit(ctrl, cols, y, all);
    const channels = data.channels.map((ch, c) => {
      const cd = cands[c][pick[c]], beta = fullFit.media[c] * ym;
      const contrib = cd.col.map((v) => v * beta);
      const avg = L.mean(ch.spend);
      const f = (x) => beta * hill(x, cd.K, cd.shape);
      return {
        name: ch.name, decay: cd.decay, K: cd.K, shape: cd.shape, beta, f, avg,
        spendTotal: L.sum(ch.spend), contribTotal: L.sum(contrib),
        roi: L.sum(contrib) / L.sum(ch.spend), mroi: marginal(f, avg),
      };
    });
    const mediaTotal = L.sum(channels.map((c) => c.contribTotal));
    return {
      n, nTr, fitted, channels, evals, ms: Date.now() - T0,
      r2: 1 - ssr / sst,
      mape: L.mean(ape.slice(0, nTr)),
      holdMape: L.mean(ape.slice(nTr)),
      revenueTotal: L.sum(act), mediaTotal,
      avgRevenue: L.mean(act),
    };
  };

  const marginal = (f, x) => { const h = Math.max(50, x * 0.01); return (f(x + h) - f(Math.max(0, x - h))) / (x + h - Math.max(0, x - h)); };

  // ---------- optimizer: greedy water-filling on steady-state response curves ----------
  const optimize = (chs, budget, maxChg, locked) => {
    const cur = chs.map((c) => c.avg), idx = cur.map((_, i) => i);
    let lo = cur.map((v, i) => (locked[i] ? v : v * (1 - maxChg)));
    const hi = cur.map((v, i) => (locked[i] ? v : v * (1 + maxChg)));
    let floorRelaxed = false;
    if (L.sum(lo) > budget) {
      floorRelaxed = true;
      const lockedSum = L.sum(cur.filter((_, i) => locked[i]));
      const free = L.sum(lo.filter((_, i) => !locked[i]));
      const k = free > 0 ? Math.max(0, budget - lockedSum) / free : 0;
      lo = lo.map((v, i) => (locked[i] ? v : v * k));
    }
    const best = (cands, score, dir) => cands.reduce((b, i) => (b < 0 || dir * score(i) > dir * score(b) ? i : b), -1);
    const total = (a) => L.sum(chs.map((c, i) => c.f(a[i])));

    const solveFrom = (start) => {
      const alloc = [...start];
      const gain = (i, d) => (chs[i].f(alloc[i] + d) - chs[i].f(alloc[i])) / d;
      const loss = (i, d) => (chs[i].f(alloc[i]) - chs[i].f(alloc[i] - d)) / d;
      // Water-fill: add (or remove) budget in small steps where the marginal euro earns most (or least).
      const step = Math.max(1, budget / 1000);
      let rem = budget - L.sum(alloc);
      while (Math.abs(rem) > 1e-6) {
        const up = rem > 0, d = Math.min(step, Math.abs(rem));
        const room = idx.filter((i) => (up ? hi[i] - alloc[i] : alloc[i] - lo[i]) > 1e-9);
        if (!room.length) break;
        const i = up ? best(room, (k) => gain(k, d), 1) : best(room, (k) => loss(k, d), -1);
        const dd = Math.min(d, up ? hi[i] - alloc[i] : alloc[i] - lo[i]);
        alloc[i] += up ? dd : -dd; rem += up ? -dd : dd;
      }
      // Then swap between channels while the best gain beats the smallest loss (S-shaped curves need this).
      for (const d of [budget / 20, budget / 100, budget / 500]) {
        for (let it = 0; it < 400; it++) {
          const i = best(idx.filter((k) => hi[k] - alloc[k] >= d), (k) => gain(k, d), 1);
          const j = best(idx.filter((k) => k !== i && alloc[k] - lo[k] >= d), (k) => loss(k, d), -1);
          if (i < 0 || j < 0 || gain(i, d) <= loss(j, d) * (1 + 1e-9)) break;
          alloc[i] += d; alloc[j] -= d;
        }
      }
      return { alloc, rem };
    };
    // Exact check on a coarse grid: dynamic programming over channels, 200 budget units above the floors.
    const dpStart = () => {
      const G = 200, u = Math.max(0, budget - L.sum(lo)) / G;
      if (!(u > 0)) return lo;
      let bestV = new Float64Array(G + 1).fill(-Infinity);
      bestV[0] = 0;
      const choice = [];
      chs.forEach((c, i) => {
        const kmax = Math.min(G, Math.floor((hi[i] - lo[i]) / u + 1e-9));
        const next = new Float64Array(G + 1).fill(-Infinity), ch = new Int16Array(G + 1);
        for (let g = 0; g <= G; g++) {
          if (bestV[g] === -Infinity) continue;
          for (let k = 0; k <= kmax && g + k <= G; k++) {
            const v = bestV[g] + c.f(lo[i] + k * u);
            if (v > next[g + k]) { next[g + k] = v; ch[g + k] = k; }
          }
        }
        choice.push(ch);
        bestV = next;
      });
      let g = G;
      while (g > 0 && bestV[g] === -Infinity) g--;
      const a = [...lo];
      for (let i = chs.length - 1; i >= 0; i--) { const k = choice[i][g]; a[i] += k * u; g -= k; }
      return a;
    };
    // Three starts (today's split, every channel at its floor, the DP grid optimum); keep the best plan.
    const plans = [solveFrom(cur.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)))), solveFrom(lo), solveFrom(dpStart())];
    const { alloc, rem } = plans.reduce((a, b) => (total(b.alloc) > total(a.alloc) + 1e-6 ? b : a));
    return {
      cur, alloc, floorRelaxed, unspent: Math.max(0, rem),
      revCur: total(cur), revRec: total(alloc), spendCur: L.sum(cur), spendRec: L.sum(alloc),
    };
  };

  const corr = (a, b) => {
    const ma = L.mean(a), mb = L.mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb || 1);
  };

  // Deterministic diagnosis for a channel whose ROI is not recovered.
  const diagnose = (data, c, model) => {
    const x = data.channels[c].spend, out = [];
    let other = null, rmax = 0;
    data.channels.forEach((o, j) => { if (j !== c) { const rr = corr(x, o.spend); if (Math.abs(rr) > Math.abs(rmax)) { rmax = rr; other = o.name; } } });
    if (Math.abs(rmax) > 0.6) out.push(`spend moves with ${other} (r = ${rmax.toFixed(2)}), so the model can't cleanly split credit between them`);
    const cv = L.sd(x) / L.mean(x);
    if (cv < 0.3) out.push(`spend barely varies (CV ${cv.toFixed(2)}), so its effect blurs into baseline and seasonality`);
    const peak = Math.max(...x);
    let flights = 0;
    x.forEach((v, i) => { if (v > peak * 0.4 && (i === 0 || x[i - 1] <= peak * 0.4)) flights++; });
    if (flights <= 4 && L.quantile(x, 0.25) < peak * 0.1) out.push(`only ${flights} flights in the data, so there are few on/off contrasts to learn from`);
    const share = model.channels[c].contribTotal / model.revenueTotal;
    if (!out.length && share < 0.04) out.push(`its effect is small next to weekly noise (about ${L.fmt.pct(share)} of revenue)`);
    if (!out.length) out.push('with 104 noisy weeks, decay and saturation trade off against each other; more spend variation would pin them down');
    return out;
  };

  const core = { CFG, nnFit, controls, generate, fromCSV, toSample, fitModel, optimize, diagnose, adstock, hill, SCENARIOS, HOLD };
  if (typeof document === 'undefined') { window.MMM = core; return; }

  // ================= UI =================
  const { $, el, fmt } = L;
  const S = { data: null, model: null, chan: 0, locked: [], fileName: '' };
  const eurk = fmt.eurCompact;
  const roiFmt = (v) => (Number.isFinite(v) ? '€' + v.toFixed(2) : '–');

  const renderFit = () => {
    const m = S.model, d = S.data;
    $('#k-r2').textContent = m.r2.toFixed(2);
    $('#k-mape').textContent = fmt.pct(m.mape);
    $('#k-hold').textContent = fmt.pct(m.holdMape);
    $('#k-media').textContent = fmt.pct(m.mediaTotal / m.revenueTotal, 0);
    const vals = [...d.revenue, ...m.fitted];
    const lo = Math.min(...vals), hi = Math.max(...vals), t = L.niceTicks(lo, hi);
    const step = t[1] - t[0], yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step;
    L.line($('#c-fit'), {
      x: d.ticks, xEvery: Math.max(13, Math.ceil(d.ticks.length / 4 / 13) * 13), yMin, yMax, height: 300,
      ariaLabel: `Weekly revenue, actual versus model, ${m.n} weeks; last ${HOLD} weeks held out`,
      bands: [{ lo: d.revenue.map((_, i) => (i >= m.nTr - 1 ? yMin : NaN)), hi: d.revenue.map((_, i) => (i >= m.nTr - 1 ? yMax : NaN)) }],
      series: [{ values: d.revenue, cls: 's-ink' }, { values: m.fitted, cls: 's-accent' }],
      markers: [m.nTr - 1],
      tipFmt: (i) => `${L.esc(d.weeks[i])}${i >= m.nTr ? ' · holdout' : ''}<br>Actual ${fmt.eur(d.revenue[i])}<br>Model ${fmt.eur(m.fitted[i])}<br>Error ${fmt.signedPct((m.fitted[i] - d.revenue[i]) / d.revenue[i])}`,
    });
    $('#fit-note').textContent = `Searched ${fmt.num(m.evals)} curve combinations in ${m.ms} ms. Shaded weeks were not used to choose the curves.`;
  };

  const renderDecomp = () => {
    const m = S.model, chs = m.channels;
    const order = chs.map((_, i) => i).sort((a, b) => chs[b].contribTotal - chs[a].contribTotal);
    L.bars($('#c-decomp'), {
      horizontal: true, labelWidth: 120,
      labels: order.map((i) => chs[i].name),
      groups: [{ values: order.map((i) => chs[i].contribTotal), cls: 'b-ink' }],
      valueFmt: (v) => eurk(v), yfmt: eurk,
      ariaLabel: 'Incremental revenue by channel over the full period',
      tipFmt: (k) => { const c = chs[order[k]]; return `${L.esc(c.name)}<br>Revenue ${eurk(c.contribTotal)} on ${eurk(c.spendTotal)} spend<br>ROI ${roiFmt(c.roi)}`; },
    });
    $('#k-base').textContent = eurk(m.revenueTotal - m.mediaTotal);
    $('#k-mtot').textContent = eurk(m.mediaTotal);
    $('#k-roi').textContent = roiFmt(m.mediaTotal / L.sum(chs.map((c) => c.spendTotal)));
    const tb = $('#t-decomp tbody');
    tb.innerHTML = '';
    order.forEach((i) => {
      const c = chs[i];
      tb.append(el('tr', {}, [
        el('td', { text: c.name }),
        el('td', { class: 'num', text: eurk(c.avg) }),
        el('td', { class: 'num', text: eurk(c.contribTotal) }),
        el('td', { class: 'num', text: roiFmt(c.roi) }),
        el('td', { class: 'num' + (c.mroi < 1 ? ' neg' : ''), text: roiFmt(c.mroi) }),
        el('td', { class: 'num hide-sm', text: c.decay.toFixed(1) }),
        el('td', { class: 'num hide-sm', text: eurk(c.K) }),
      ]));
    });
  };

  const renderCurve = () => {
    const m = S.model, c = m.channels[S.chan], N = 61;
    const plan = S.plan;
    const xmax = Math.max(c.avg * 2.2, plan.alloc[S.chan] * 1.15, 1000);
    const xs = Array.from({ length: N }, (_, i) => (i / (N - 1)) * xmax);
    const series = [{ values: xs.map(c.f), cls: 's-accent' }];
    const tr = S.data.truth && S.data.truth[S.chan];
    const trueF = tr && ((x) => tr.beta * hill(x, tr.K, tr.shape));
    if (trueF) series.unshift({ values: xs.map(trueF), cls: 's-muted' });
    const at = (x) => ({ i: (x / xmax) * (N - 1), v: c.f(x) });
    L.line($('#c-curve'), {
      x: xs.map(eurk), xEvery: 10, height: 280, yMin: 0, series,
      points: [{ ...at(c.avg), cls: 'dot-ink', r: 5 }, { ...at(plan.alloc[S.chan]), cls: 'dot-accent', r: 5 }],
      ariaLabel: `${c.name}: weekly spend against incremental weekly revenue`,
      tipFmt: (i) => `${eurk(xs[i])}/week<br>Fitted revenue ${eurk(c.f(xs[i]))}${trueF ? `<br>True ${eurk(trueF(xs[i]))}` : ''}<br>Next € returns ${roiFmt(marginal(c.f, xs[i]))}`,
    });
    $('#curve-note').textContent = `${c.name}: now ${eurk(c.avg)}/week, where the next euro returns ${roiFmt(c.mroi)}. Half-saturation at ${eurk(c.K)}/week of adstocked spend; carry-over decay ${c.decay.toFixed(1)}.`;
    // .legend span sets display, which beats [hidden], so rebuild the legend instead of hiding an item.
    const key = (cls, text) => el('span', {}, [el('i', { class: cls || null }), text]);
    $('#lg-curve').replaceChildren(...[key('k-accent', 'Fitted curve'), trueF && key('k-muted', 'True curve'), key('k-bar', 'Now'), key('k-bar-accent', 'Plan')].filter(Boolean));
  };

  const renderChanSeg = () => {
    const seg = $('#chan-seg');
    seg.innerHTML = '';
    S.model.channels.forEach((c, i) => seg.append(el('button', {
      type: 'button', 'aria-pressed': String(i === S.chan), text: c.name,
      onclick: () => { S.chan = i; [...seg.children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); renderCurve(); },
    })));
  };

  const renderLocks = () => {
    const box = $('#locks');
    box.innerHTML = '';
    S.locked = S.model.channels.map(() => false);
    S.model.channels.forEach((c, i) => {
      const id = 'lock-' + i;
      box.append(el('label', { class: 'check', for: id }, [
        el('input', { type: 'checkbox', id, onchange: (e) => { S.locked[i] = e.target.checked; renderPlan(); } }),
        el('span', { text: c.name }),
      ]));
    });
  };

  const sentence = (chs, p) => {
    const d = p.alloc.map((a, i) => a - p.cur[i]);
    const tol = p.spendCur * 0.005;
    const up = d.map((v, i) => i).filter((i) => d[i] > tol).sort((a, b) => d[b] - d[a]);
    const down = d.map((v, i) => i).filter((i) => d[i] < -tol).sort((a, b) => d[a] - d[b]);
    const names = (ix) => ix.map((i) => chs[i].name).join(ix.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1');
    const dRev = p.revRec - p.revCur, bud = p.spendRec - p.spendCur;
    const tail = `Predicted media-driven revenue ${dRev >= 0 ? '+' : '−'}${eurk(Math.abs(dRev))}/week ${bud === 0 || Math.abs(bud) < tol ? 'on the same budget' : `on ${bud > 0 ? '+' : '−'}${eurk(Math.abs(bud))}/week of spend`}.`;
    if (!up.length && !down.length) return `The current split is already close to what the fitted curves recommend within these limits. ${tail}`;
    const mr = (i, x) => roiFmt(marginal(chs[i].f, x));
    if (up.length && down.length) {
      const moved = -L.sum(down.map((i) => d[i]));
      return `Move ${eurk(moved)}/week out of ${names(down)} and into ${names(up)}. Today the next euro in ${chs[up[0]].name} returns ${mr(up[0], p.cur[up[0]])}, against ${mr(down[0], p.cur[down[0]])} in ${chs[down[0]].name}. ${tail}`;
    }
    if (up.length) return `Most of the extra budget goes to ${chs[up[0]].name}, where the next euro returns ${mr(up[0], p.cur[up[0]])} today. ${names(up)} grow. ${tail}`;
    return `Cuts land first on ${chs[down[0]].name}, where the next euro returns only ${mr(down[0], p.cur[down[0]])} today. ${tail}`;
  };

  const renderPlan = () => {
    const m = S.model, chs = m.channels;
    const cur = L.sum(chs.map((c) => c.avg));
    const budget = cur * (1 + S.getBudget() / 100);
    const p = optimize(chs, budget, S.getMax() / 100, S.locked);
    S.plan = p;
    $('#budget-out').textContent = `${eurk(budget)}/wk (${S.getBudget() >= 0 ? '+' : '−'}${Math.abs(S.getBudget())}%)`;
    L.bars($('#c-plan'), {
      horizontal: true, labelWidth: 120,
      labels: chs.map((c) => c.name),
      groups: [{ values: p.cur, cls: 'b-muted', name: 'Now' }, { values: p.alloc, cls: 'b-accent', name: 'Plan' }],
      valueFmt: (v) => eurk(v), yfmt: eurk,
      ariaLabel: 'Average weekly spend by channel, current versus recommended',
      tipFmt: (i) => `${L.esc(chs[i].name)}<br>Now ${eurk(p.cur[i])}/wk<br>Plan ${eurk(p.alloc[i])}/wk (${fmt.signedPct(p.alloc[i] / p.cur[i] - 1, 0)})`,
    });
    const dRev = p.revRec - p.revCur;
    $('#k-drev').textContent = (dRev >= 0 ? '+' : '−') + eurk(Math.abs(dRev));
    $('#k-drevp').textContent = fmt.signedPct(dRev / m.avgRevenue);
    $('#k-roas').textContent = `${roiFmt(p.revCur / p.spendCur)} → ${roiFmt(p.revRec / p.spendRec)}`;
    $('#plan-text').textContent = sentence(chs, p);
    const warn = [];
    if (p.floorRelaxed) warn.push(`The budget is below what the ±${S.getMax()}% limit allows, so unlocked channels were cut further, pro rata.`);
    if (p.unspent > 1) warn.push(`${eurk(p.unspent)}/week can't be placed within the ±${S.getMax()}% limit. Widen the limit or unlock channels.`);
    $('#plan-warn').textContent = warn.join(' ');
    $('#plan-warn').hidden = !warn.length;
    const tb = $('#t-plan tbody');
    tb.innerHTML = '';
    chs.forEach((c, i) => {
      const ch = p.alloc[i] / p.cur[i] - 1;
      tb.append(el('tr', {}, [
        el('td', { text: c.name + (S.locked[i] ? ' (locked)' : '') }),
        el('td', { class: 'num', text: eurk(p.cur[i]) }),
        el('td', { class: 'num', text: eurk(p.alloc[i]) }),
        el('td', { class: 'num' + (ch < -0.005 ? ' neg' : ch > 0.005 ? ' pos' : ''), text: fmt.signedPct(ch, 0) }),
        el('td', { class: 'num', text: roiFmt(marginal(c.f, p.alloc[i])) }),
      ]));
    });
    renderCurve();
  };

  const renderRecovery = () => {
    const blk = $('#b-rec');
    const d = S.data, m = S.model;
    blk.hidden = !d.truth;
    if (!d.truth) return;
    const tb = $('#t-rec tbody');
    tb.innerHTML = '';
    const off = [];
    m.channels.forEach((c, i) => {
      const tr = d.truth[i], err = c.roi / tr.roi - 1, bad = Math.abs(err) > 0.2;
      if (bad) off.push(i);
      tb.append(el('tr', {}, [
        el('td', { text: c.name }),
        el('td', { class: 'num', text: roiFmt(tr.roi) }),
        el('td', { class: 'num', text: roiFmt(c.roi) }),
        el('td', { class: 'num' + (bad ? ' neg' : ''), text: fmt.signedPct(err, 0) }),
        el('td', { class: 'num hide-sm', text: `${tr.decay.toFixed(2)} / ${c.decay.toFixed(1)}` }),
        el('td', {}, el('span', { class: 'tag ' + (bad ? 'tag--warn' : 'tag--ok'), text: bad ? 'Off' : 'OK' })),
      ]));
    });
    const k = m.channels.length - off.length;
    $('#rec-sum').textContent = `${k} of ${m.channels.length} channels land within 20% of the true ROI in this scenario.` +
      (off.length ? ' Where it misses, the data explains why:' : ' Try the Collinear or Saturated scenario to see where it breaks.');
    const ul = $('#rec-why');
    ul.innerHTML = '';
    off.forEach((i) => ul.append(el('li', {}, [
      el('span', { class: 'f-rule', text: m.channels[i].name }),
      el('span', { class: 'f-msg', text: diagnose(d, i, m).join('; ') + '.' }),
    ])));
    ul.hidden = !off.length;
  };

  const run = (data) => {
    S.data = data;
    S.model = fitModel(data);
    if (S.chan >= S.model.channels.length) S.chan = 0;
    $('#data-note').textContent = data.source === 'csv'
      ? `Your file: ${S.fileName} · ${data.revenue.length} weeks · ${data.channels.length} channels.`
      : `Synthetic: ${SCENARIOS[data.scenario].label} scenario · 104 weeks · 5 channels.`;
    renderFit();
    renderDecomp();
    renderLocks();
    renderChanSeg();
    renderPlan();
    renderRecovery();
  };

  // ---------- wiring ----------
  S.getBudget = L.bindRange('budget', null, () => renderPlan());
  S.getMax = L.bindRange('maxchg', (v) => `±${v}%`, () => renderPlan());
  const scenSeg = $('#scen-seg');
  L.bindSeg(scenSeg, (key) => { $('#csv-msg').textContent = ''; run(generate(key)); });
  $('#dl-sample').addEventListener('click', () => {
    const d = S.data.source === 'csv' ? generate('balanced') : S.data;
    L.download(`mmm-sample-${d.scenario}.csv`, toSample(d));
  });
  $('#csv').addEventListener('change', async (e) => {
    const file = e.target.files[0], msg = $('#csv-msg');
    if (!file) return;
    msg.textContent = '';
    if (file.size > 2e6) { msg.textContent = 'File is over 2 MB. Weekly data for a few years should be far smaller.'; return; }
    const res = fromCSV(await L.readFile(file));
    if (res.errs) {
      msg.append(el('b', { text: 'Not loaded. ' }), ...res.errs.flatMap((t) => [document.createTextNode(t), el('br')]));
      e.target.value = '';
      return;
    }
    S.fileName = file.name;
    [...scenSeg.children].forEach((b) => b.setAttribute('aria-pressed', 'false'));
    msg.append(el('b', { text: 'Loaded. ' }), document.createTextNode('Model refit on your data. Pick a scenario to go back.'));
    run(res.data);
  });

  run(generate('balanced'));
})();
