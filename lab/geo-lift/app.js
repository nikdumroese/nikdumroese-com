// Geo-lift incrementality test: synthetic control + placebo inference, all in the browser.
(() => {
  const L = window.Lab;
  const { rng, mean, quantile, fmt } = L;

  // name, population (thousands, approx.), region
  const GEOS = [
    ['Berlin', 3755, 'East'], ['Hamburg', 1892, 'North'], ['München', 1512, 'South'], ['Köln', 1084, 'West'],
    ['Frankfurt', 773, 'South'], ['Stuttgart', 633, 'South'], ['Düsseldorf', 629, 'West'], ['Leipzig', 616, 'East'],
    ['Dortmund', 595, 'West'], ['Essen', 584, 'West'], ['Bremen', 577, 'North'], ['Dresden', 563, 'East'],
    ['Hannover', 545, 'North'], ['Nürnberg', 523, 'South'], ['Duisburg', 502, 'West'], ['Bochum', 365, 'West'],
    ['Wuppertal', 358, 'West'], ['Bonn', 336, 'West'], ['Bielefeld', 334, 'West'], ['Münster', 320, 'West'],
    ['Mannheim', 315, 'South'], ['Karlsruhe', 308, 'South'], ['Augsburg', 300, 'South'], ['Wiesbaden', 283, 'South'],
    ['Gelsenkirchen', 263, 'West'], ['Mönchengladbach', 261, 'West'], ['Braunschweig', 251, 'North'], ['Aachen', 249, 'West'],
    ['Chemnitz', 248, 'East'], ['Kiel', 247, 'North'], ['Halle', 239, 'East'], ['Magdeburg', 239, 'East'],
    ['Freiburg', 236, 'South'], ['Krefeld', 228, 'West'], ['Mainz', 220, 'South'], ['Lübeck', 217, 'North'],
    ['Erfurt', 214, 'East'], ['Oberhausen', 210, 'West'], ['Rostock', 209, 'North'], ['Kassel', 201, 'South'],
  ];
  const REGIONS = ['North', 'West', 'South', 'East'];
  const PRE = 90, MAXPOST = 42, T = PRE + MAXPOST;
  const DEFAULT_TEST = ['Leipzig', 'Hannover', 'Nürnberg', 'Bochum'];
  const WEEK = [1.0, 1.03, 1.04, 1.01, 0.96, 0.8, 0.84].map(Math.log);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- synthetic data ----------
  // Smooth, mean-reverting random walk scaled to a target standard deviation.
  const walk = (r, n, amp) => {
    const out = new Float64Array(n);
    let lvl = 0, vel = 0;
    for (let t = 0; t < n; t++) {
      vel = 0.85 * vel + r.normal(0, 1);
      lvl = 0.97 * lvl + vel;
      out[t] = lvl;
    }
    const m = mean(out), s = L.sd(Array.from(out)) || 1;
    return out.map((v) => ((v - m) / s) * amp);
  };

  const generate = (seed) => {
    const r = rng(seed * 7919 + 13);
    const phase = r() * 6.28;
    const national = walk(r, T, 0.035).map((v, t) => v + 0.0016 * t + 0.04 * Math.sin((2 * Math.PI * t) / 63 + phase));
    const regional = REGIONS.map(() => walk(r, T, 0.035));
    const latent = [walk(r, T, 0.025), walk(r, T, 0.025)];
    const Y = GEOS.map(([, pop, region]) => {
      const base = (pop / 1000) * 120;
      const ri = REGIONS.indexOf(region);
      const regLoad = 1 + r.normal(0, 0.15);
      const latLoad = [r.normal(0, 0.7), r.normal(0, 0.7)];
      const y = new Float64Array(T);
      let idio = 0;
      for (let t = 0; t < T; t++) {
        idio = 0.7 * idio + r.normal(0, 0.02);
        const mu = base * Math.exp(national[t] + WEEK[t % 7] + regLoad * regional[ri][t] + latLoad[0] * latent[0][t] + latLoad[1] * latent[1][t] + idio);
        y[t] = Math.max(0, Math.round(mu + r.normal(0, Math.sqrt(mu))));
      }
      return y;
    });
    const t0 = Date.UTC(2026, 2, 2);
    const dates = Array.from({ length: T }, (_, t) => {
      const d = new Date(t0 + t * 864e5);
      return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
    });
    const iso = Array.from({ length: T }, (_, t) => new Date(t0 + t * 864e5).toISOString().slice(0, 10));
    return { synthetic: true, geos: GEOS.map((g) => g[0]), regions: GEOS.map((g) => g[2]), Y, dates, iso, start: PRE };
  };

  // ---------- synthetic control ----------
  const projSimplex = (v) => {
    const u = Array.from(v).sort((a, b) => b - a);
    let css = 0, theta = 0;
    for (let i = 0; i < u.length; i++) {
      css += u[i];
      const t = (css - 1) / (i + 1);
      if (u[i] - t > 0) theta = t;
    }
    return v.map((x) => Math.max(0, x - theta));
  };

  // min w'Aw − 2b'w  s.t. w ≥ 0, Σw = 1  (accelerated projected gradient)
  const simplexQP = (A, b, iters = 400) => {
    const n = b.length;
    if (n === 1) return new Float64Array([1]);
    let v = new Float64Array(n).fill(1 / Math.sqrt(n)), lip = 1;
    for (let k = 0; k < 25; k++) {
      const nv = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += A[i][j] * v[j]; nv[i] = s; }
      lip = Math.hypot(...nv) || 1;
      v = nv.map((x) => x / lip);
    }
    const step = 1 / (2 * lip);
    let w = new Float64Array(n).fill(1 / n), y = w.slice(), tk = 1;
    const g = new Float64Array(n);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) { let s = -b[i]; const Ai = A[i]; for (let j = 0; j < n; j++) s += Ai[j] * y[j]; g[i] = y[i] - step * 2 * s; }
      const wn = projSimplex(g);
      const tn = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
      let diff = 0;
      for (let i = 0; i < n; i++) { y[i] = wn[i] + ((tk - 1) / tn) * (wn[i] - w[i]); diff = Math.max(diff, Math.abs(wn[i] - w[i])); }
      w = wn; tk = tn;
      if (diff < 1e-7) break;
    }
    return w;
  };

  // Normalise every geo by its pre-period mean and precompute the pre-period Gram matrix.
  const prepWindow = (Y, s, E) => {
    const G = Y.length, m = new Float64Array(G), Z = [];
    for (let g = 0; g < G; g++) {
      let sum = 0;
      for (let t = 0; t < s; t++) sum += Y[g][t];
      m[g] = sum / s || 1e-9;
      const z = new Float64Array(E);
      for (let t = 0; t < E; t++) z[t] = Y[g][t] / m[g];
      Z.push(z);
    }
    const Q = Array.from({ length: G }, () => new Float64Array(G));
    for (let i = 0; i < G; i++) for (let j = i; j < G; j++) {
      let d = 0; const a = Z[i], b = Z[j];
      for (let t = 0; t < s; t++) d += a[t] * b[t];
      Q[i][j] = Q[j][i] = d;
    }
    return { Y, Z, m, Q, s, E };
  };

  const cellFit = (win, cell, donors) => {
    const { Y, Z, Q, s, E } = win;
    const agg = new Float64Array(E);
    cell.forEach((g) => { for (let t = 0; t < E; t++) agg[t] += Y[g][t]; });
    let mc = 0;
    for (let t = 0; t < s; t++) mc += agg[t];
    mc = mc / s || 1e-9;
    const b = donors.map((d) => { let x = 0; for (let t = 0; t < s; t++) x += Z[d][t] * agg[t] / mc; return x; });
    const A = donors.map((i) => donors.map((j) => Q[i][j]));
    const w = simplexQP(A, b);
    const cf = new Float64Array(E);
    donors.forEach((d, k) => { if (w[k] > 0) for (let t = 0; t < E; t++) cf[t] += w[k] * Z[d][t]; });
    for (let t = 0; t < E; t++) cf[t] *= mc;
    let preSS = 0, postSS = 0, ape = 0, sumGap = 0, sumCf = 0;
    for (let t = 0; t < E; t++) {
      const e = agg[t] - cf[t];
      if (t < s) { preSS += e * e; ape += agg[t] > 0 ? Math.abs(e) / agg[t] : 0; }
      else { postSS += e * e; sumGap += e; sumCf += cf[t]; }
    }
    const preRmspe = Math.sqrt(preSS / s), postRmspe = Math.sqrt(postSS / Math.max(1, E - s));
    return { w, donors, agg, cf, preRmspe, postRmspe, ratio: postRmspe / (preRmspe || 1e-9), lift: sumGap / (sumCf || 1e-9), incr: sumGap, sumCf, mape: ape / s };
  };

  // Placebo cells the same size as the test cell, drawn from control geos only, preferring cells
  // within 0.5–2× the test cell's volume so their noise level is comparable. Fixed seed → stable.
  const placeboCells = (controls, k, n, vol, target, seed = 4242) => {
    if (k === 1) return controls.slice(0, n).map((g) => [g]);
    const r = rng(seed + k * 31 + controls.length);
    const seen = new Set(), cells = [], loose = [];
    for (let tries = 0; cells.length < n && tries < n * 40; tries++) {
      const pool = controls.slice();
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const cell = pool.slice(0, k).sort((a, b) => a - b), key = cell.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const v = cell.reduce((a, g) => a + vol[g], 0) / (target || 1);
      (v >= 0.5 && v <= 2 ? cells : loose).push(cell);
    }
    return cells.concat(loose).slice(0, n);
  };

  const without = (arr, drop) => { const d = new Set(drop); return arr.filter((x) => !d.has(x)); };

  const applyLift = (Y, test, s, lift) => Y.map((y, g) => {
    if (!lift || !test.includes(g)) return y;
    return y.map((v, t) => (t >= s ? v * (1 + lift) : v));
  });

  const analyze = (data, test, s, post, lift) => {
    const E = Math.min(data.Y[0].length, s + post);
    const Y = applyLift(data.Y, test, s, lift);
    const win = prepWindow(Y, s, E);
    const controls = without(data.geos.map((_, i) => i), test);
    const real = cellFit(win, test, controls);
    const target = test.reduce((acc, g) => acc + win.m[g], 0);
    const cells = controls.length - test.length >= 2 ? placeboCells(controls, test.length, 60, win.m, target) : [];
    const pl = cells.map((c) => cellFit(win, c, without(controls, c)));
    const P = E - s;
    const ratios = pl.map((p) => p.ratio), lifts = pl.map((p) => p.lift);
    const p = (1 + ratios.filter((r) => r >= real.ratio).length) / (pl.length + 1);
    const qHi = pl.length ? quantile(lifts, 0.95) : NaN, qLo = pl.length ? quantile(lifts, 0.05) : NaN;
    const ci = [real.lift - qHi, real.lift - qLo];
    // Daily and cumulative null bands from the placebo cells' relative gaps.
    const dLo = new Array(E).fill(NaN), dHi = new Array(E).fill(NaN);
    const cumGap = [], cumLo = [], cumHi = [];
    let cg = 0, cc = 0;
    const plCum = pl.map(() => [0, 0]);
    for (let t = s; t < E; t++) {
      const rel = pl.map((q) => (q.agg[t] - q.cf[t]) / (q.cf[t] || 1e-9));
      const crel = pl.map((q, i) => { plCum[i][0] += q.agg[t] - q.cf[t]; plCum[i][1] += q.cf[t]; return plCum[i][0] / (plCum[i][1] || 1e-9); });
      cg += real.agg[t] - real.cf[t]; cc += real.cf[t];
      if (pl.length) {
        dLo[t] = real.cf[t] * quantile(rel, 0.05); dHi[t] = real.cf[t] * quantile(rel, 0.95);
        cumLo.push(cg - cc * quantile(crel, 0.95)); cumHi.push(cg - cc * quantile(crel, 0.05));
      }
      cumGap.push(cg);
    }
    return { real, pl, ratios, lifts, p, ci, P, E, s, dLo, dHi, cumGap, cumLo, cumHi, controls };
  };

  // Power by back-testing: fake test windows inside the pre-period, no lift injected.
  const plan = (data, test, s, post) => {
    const minPre = 28, maxS = s - post;
    if (maxS < minPre) return { error: `Needs at least ${minPre + post} days of history before the test start.` };
    const nStarts = Math.min(24, maxS - minPre + 1);
    const starts = Array.from({ length: nStarts }, (_, i) => Math.round(minPre + (nStarts === 1 ? 0 : (i * (maxS - minPre)) / (nStarts - 1))));
    const controls = without(data.geos.map((_, i) => i), test);
    const vol = prepWindow(data.Y, s, s).m, target = test.reduce((acc, g) => acc + vol[g], 0);
    const cells = controls.length - test.length >= 2 ? placeboCells(controls, test.length, 12, vol, target, 777) : [];
    const errs = [], nulls = [], mapes = [];
    starts.forEach((st) => {
      const win = prepWindow(data.Y, st, st + post);
      const r = cellFit(win, test, controls);
      errs.push(r.lift); mapes.push(r.mape);
      cells.forEach((c) => nulls.push(cellFit(win, c, without(controls, c)).lift));
    });
    if (!nulls.length) return { error: 'Not enough control cities to build placebo groups.' };
    const crit = quantile(nulls, 0.95);
    const grid = Array.from({ length: 41 }, (_, i) => i * 0.005);
    const power = grid.map((lft) => errs.filter((e) => (1 + lft) * (1 + e) - 1 > crit).length / errs.length);
    let mde = NaN;
    for (let i = 0; i < grid.length; i++) {
      if (power[i] >= 0.8) {
        mde = i === 0 ? 0 : grid[i - 1] + ((0.8 - power[i - 1]) / (power[i] - power[i - 1] || 1)) * (grid[i] - grid[i - 1]);
        break;
      }
    }
    return { grid, power, mde, crit, reps: errs.length, nulls: nulls.length, errSd: L.sd(errs), mape: mean(mapes) };
  };

  // Rank geos by how well the others can reproduce them, then fill a 10–20% volume cell.
  const suggest = (data, s) => {
    const win = prepWindow(data.Y, s, s);
    const all = data.geos.map((_, i) => i);
    const vol = all.map((g) => win.m[g]);
    const total = vol.reduce((a, b) => a + b, 0);
    const ranked = all.map((g) => ({ g, mape: cellFit(win, [g], without(all, [g])).mape, share: vol[g] / total }))
      .sort((a, b) => a.mape - b.mape);
    const pick = [];
    let share = 0;
    for (const r of ranked) {
      if (share >= 0.12) break;
      if (r.share > 0.06 || share + r.share > 0.2) continue;
      pick.push(r); share += r.share;
    }
    return { pick, share };
  };

  const volumeShare = (data, test, s) => {
    let a = 0, b = 0;
    data.Y.forEach((y, g) => { let x = 0; for (let t = 0; t < s; t++) x += y[t]; b += x; if (test.includes(g)) a += x; });
    return a / (b || 1);
  };

  const parseUpload = (text) => {
    const rows = L.parseCSV(text);
    if (!rows.length) throw new Error('The file has no rows.');
    const keys = Object.keys(rows[0]);
    const find = (re, i) => keys.find((k) => re.test(k)) || keys[i];
    const kd = find(/^date|day/i, 0), kg = find(/geo|region|city|market|dma/i, 1), kv = find(/kpi|conv|sign|value|orders|count/i, 2);
    const dates = [...new Set(rows.map((r) => r[kd]))].filter(Boolean).sort();
    const geos = [...new Set(rows.map((r) => r[kg]))].filter(Boolean).sort();
    if (geos.length < 4) throw new Error('Need at least 4 regions in the geo column (1 test + 3 controls).');
    if (dates.length < 42) throw new Error('Need at least 42 days of data.');
    const di = new Map(dates.map((d, i) => [d, i])), gi = new Map(geos.map((g, i) => [g, i]));
    const Y = geos.map(() => new Float64Array(dates.length));
    let bad = 0;
    rows.forEach((r) => {
      const v = parseFloat(r[kv]);
      if (!Number.isFinite(v) || !gi.has(r[kg]) || !di.has(r[kd])) { bad++; return; }
      Y[gi.get(r[kg])][di.get(r[kd])] += v;
    });
    const filled = rows.length - bad, missing = geos.length * dates.length - filled;
    return { synthetic: false, geos, regions: geos.map(() => '–'), Y, dates, iso: dates, start: Math.round(dates.length * 0.75), bad, missing: Math.max(0, missing) };
  };

  const core = { GEOS, PRE, MAXPOST, T, DEFAULT_TEST, generate, projSimplex, simplexQP, prepWindow, cellFit, placeboCells, analyze, plan, suggest, volumeShare, parseUpload };
  window.GeoLiftCore = core;
  if (typeof document === 'undefined' || !document.getElementById('geo-app')) return;

  // ---------- UI ----------
  const $ = (id) => document.getElementById(id);
  const state = { data: null, test: [], planStale: true, planTab: false, csvName: '' };
  const getSeed = L.bindRange('seed', (v) => '#' + v, () => reseed());
  const getLift = L.bindRange('lift', (v) => '+' + v.toFixed(1) + '%', () => schedule());
  const getLen = L.bindRange('len', (v) => v + ' days', () => schedule());
  const num = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v >= 0 ? v : d; };
  ['spend', 'value'].forEach((id) => $(id).addEventListener('input', () => schedule()));

  const signed = (x) => fmt.signedPct(x, 1);
  // Shared line() spaces x labels by count only; thin them by host width so dates don't collide on phones.
  const every = (host, n, px = 64) => Math.max(1, Math.ceil(n / Math.max(3, Math.floor((host.clientWidth || 720) / px))));
  const tick = (x, d = 0) => fmt.num(x, d);
  const sampleTag = () => (state.data.synthetic ? 'Synthetic · seed ' + getSeed() : null);

  const dataTable = (host, cols, rows) => L.dataTable(host, cols.map((c, i) => ({ label: c, num: i > 0 })), rows);

  // ≤860px the sidebar renders after every output; move the key controls up beside the results
  const quick = () => {
    const strip = L.$('.lab-quick'); if (!strip) return;
    const items = L.$$('[data-quick]').map((n) => { const m = document.createComment('quick'); n.before(m); return [n, m]; });
    const mq = matchMedia('(max-width: 860px)');
    const place = () => items.forEach(([n, m]) => (mq.matches ? strip.append(n) : m.after(n)));
    mq.addEventListener('change', place); place();
  };

  const renderGeoList = () => {
    const box = $('geo-list');
    box.innerHTML = '';
    state.data.geos.forEach((name, g) => {
      const id = 'geo-' + g;
      const inp = L.el('input', { type: 'checkbox', id, value: g, checked: state.test.includes(g) || null });
      inp.addEventListener('change', () => {
        state.test = L.$$('#geo-list input:checked').map((x) => +x.value);
        schedule();
      });
      box.append(L.el('label', { class: 'check', for: id }, [inp, L.el('span', { text: name })]));
    });
  };

  const syncChecks = () => L.$$('#geo-list input').forEach((x) => { x.checked = state.test.includes(+x.value); });

  const setMode = () => {
    const syn = state.data.synthetic;
    $('lift').disabled = !syn;
    $('lift-hint').textContent = syn
      ? 'Simulation only. You set the true effect, then see whether the method recovers it.'
      : 'Your own data: the true effect is unknown.';
    $('seed-field').hidden = !syn;
    $('start-field').hidden = syn;
    $('data-status').textContent = syn
      ? `Synthetic: ${state.data.geos.length} German cities × ${state.data.dates.length} days, seeded model.`
      : `${state.csvName}: ${state.data.geos.length} regions × ${state.data.dates.length} days` + (state.data.missing ? `, ${state.data.missing} region-days missing (treated as 0)` : '') + (state.data.bad ? `, ${state.data.bad} rows skipped` : '') + '.';
    $('reset-wrap').hidden = syn;
    if (!syn) {
      const sel = $('start');
      sel.innerHTML = '';
      state.data.dates.forEach((d, i) => { if (i >= 28 && i <= state.data.dates.length - 7) sel.append(L.el('option', { value: i, text: d, selected: i === state.data.start || null })); });
    }
  };

  const loadSynthetic = () => {
    const prev = state.data && state.data.synthetic ? state.test : null;
    state.data = generate(getSeed());
    state.test = prev || DEFAULT_TEST.map((n) => state.data.geos.indexOf(n));
    renderGeoList(); setMode(); run();
  };

  const testStart = () => (state.data.synthetic ? PRE : +$('start').value);
  const postLen = () => Math.min(getLen(), state.data.dates.length - testStart());

  $('start').addEventListener('change', () => schedule());
  $('csv').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = parseUpload(await L.readFile(f));
      state.data = d; state.csvName = f.name;
      setMode();
      state.test = suggest(d, d.start).pick.map((r) => r.g);
      renderGeoList(); $('csv-err').textContent = ''; schedule();
    } catch (err) {
      $('csv-err').textContent = 'Could not read that file: ' + err.message;
    }
  });
  $('reset').addEventListener('click', () => { $('csv').value = ''; state.data = null; loadSynthetic(); });
  $('sample').addEventListener('click', () => {
    const d = state.data, s = testStart(), Y = applyLift(d.Y, state.test, s, d.synthetic ? getLift() / 100 : 0);
    const rows = [];
    d.iso.forEach((date, t) => d.geos.forEach((geo, g) => rows.push({ date, geo, kpi: Math.round(Y[g][t]) })));
    L.download('geo-lift-sample.csv', L.toCSV(rows, ['date', 'geo', 'kpi']));
  });
  $('suggest').addEventListener('click', () => {
    const r = suggest(state.data, testStart());
    state.test = r.pick.map((x) => x.g);
    syncChecks();
    $('suggest-out').textContent = `Picked ${r.pick.map((x) => `${state.data.geos[x.g]} (fit error ${fmt.pct(x.mape)})`).join(', ')}. Together ${fmt.pct(r.share)} of volume.`;
    schedule();
  });

  L.tabs(document, (id) => { state.planTab = id === 'p-plan'; if (state.planTab && state.planStale) renderPlan(); });

  const run = () => {
    const d = state.data, test = state.test;
    $('geo-share').textContent = test.length
      ? `${test.length} test ${test.length > 1 ? 'cities' : 'city'}, ${fmt.pct(volumeShare(d, test, testStart()))} of pre-period volume.`
      : 'Pick at least one test city.';
    state.planStale = true;
    if (!test.length || test.length > d.geos.length - 3) {
      $('verdict-v').textContent = '–';
      $('verdict-why').textContent = 'Pick between 1 and ' + (d.geos.length - 3) + ' test cities. The rest form the donor pool.';
      return;
    }
    renderAnalyze();
    if (state.planTab) renderPlan();
  };
  const schedule = L.debounce(run, 140);
  const reseed = L.debounce(() => loadSynthetic(), 140);

  const renderAnalyze = () => {
    const d = state.data, s = testStart(), post = postLen(), lift = d.synthetic ? getLift() / 100 : 0;
    const a = analyze(d, state.test, s, post, lift);
    const { real, ci, p } = a;
    const spend = num('spend', 0), value = num('value', 0);
    const lo = real.sumCf * ci[0], hi = real.sumCf * ci[1];
    const sig = ci[0] > 0 ? 'pos' : ci[1] < 0 ? 'neg' : 'none';

    $('verdict-v').textContent = signed(real.lift);
    $('verdict-v').className = 'verdict__v' + (sig === 'none' ? ' is-warn' : '');
    const range = `${signed(ci[0])} to ${signed(ci[1])}`;
    const why = {
      pos: `Significant at 90%. Over ${a.P} days the test cities ran ${signed(real.lift)} against their synthetic control, and the 90% interval (${range}) excludes zero.`,
      neg: `Significant negative effect at 90%. The interval (${range}) sits below zero. Check for spillover or a tracking break before trusting it.`,
      none: `Can't distinguish from noise. The 90% interval (${range}) includes zero: cities with no campaign show gaps this size.`,
    }[sig];
    const agree = (p <= 0.1) === (sig !== 'none') ? '' : ` The RMSPE rank test disagrees (p = ${p.toFixed(2)}), so call it borderline.`;
    $('verdict-why').textContent = why + agree;
    $('verdict-h').textContent = sig === 'pos' ? 'The campaign caused a lift' : sig === 'neg' ? 'The test cities fell behind' : 'No effect you can claim';

    $('k-incr').textContent = tick(real.incr);
    $('k-incr-l').textContent = `Incremental conv. (90%: ${tick(lo)} to ${tick(hi)})`;
    $('k-p').textContent = p.toFixed(2);
    $('k-roas').textContent = spend > 0 ? (real.incr * value / spend).toFixed(2) + '×' : '–';
    $('k-roas-l').textContent = spend > 0 ? `iROAS (90%: ${(lo * value / spend).toFixed(2)} to ${(hi * value / spend).toFixed(2)})` : 'iROAS (enter spend)';

    const truth = $('truth');
    if (d.synthetic) {
      const inside = lift >= ci[0] && lift <= ci[1];
      truth.innerHTML = `<b>You injected ${signed(lift)}.</b> The method estimated ${signed(real.lift)}; the 90% interval ${inside ? 'covers' : 'misses'} the true value.` +
        (inside ? '' : ' A 90% interval misses about 1 time in 10. Try another data seed.');
    } else truth.textContent = `Test window: ${d.dates[s]} to ${d.dates[a.E - 1]} (${a.P} days).`;
    $('fit-warn-wrap').hidden = real.mape <= 0.1;
    $('fit-warn').textContent = `Pre-period fit is poor (MAPE ${fmt.pct(real.mape)}). Add donor cities or pick test cities the controls can track.`;

    const xs = d.dates.slice(0, a.E);
    const actual = Array.from(real.agg), cf = Array.from(real.cf);
    const bLo = cf.map((v, t) => (t >= s ? v + a.dLo[t] : NaN)), bHi = cf.map((v, t) => (t >= s ? v + a.dHi[t] : NaN));
    L.line($('c-fit'), {
      x: xs, xEvery: every($('c-fit'), xs.length), series: [{ values: cf, cls: 's-muted' }, { values: actual, cls: 's-ink' }],
      bands: [{ lo: bLo, hi: bHi }], markers: [s], sample: sampleTag(),
      ariaLabel: 'Daily conversions in the test cities versus their synthetic control, with a 90% placebo band after the test start.',
      tipFmt: (i) => `${xs[i]}<br>Actual ${tick(actual[i])}<br>Synthetic ${tick(cf[i])}`,
    });
    const gap = actual.map((v, t) => v - cf[t]);
    L.line($('c-gap'), {
      x: xs, xEvery: every($('c-gap'), xs.length), series: [{ values: gap, cls: 's-ink' }], bands: [{ lo: a.dLo, hi: a.dHi }], markers: [s], height: 220, sample: sampleTag(),
      ariaLabel: 'Daily gap between actual and synthetic control.',
      tipFmt: (i) => `${xs[i]}<br>Gap ${tick(gap[i])}`,
    });
    const px = xs.slice(s);
    L.line($('c-cum'), {
      x: px, xEvery: every($('c-cum'), px.length), series: [{ values: a.cumGap, cls: 's-accent' }], bands: [{ lo: a.cumLo, hi: a.cumHi }], height: 220, sample: sampleTag(),
      ariaLabel: 'Cumulative incremental conversions in the test period with 90% interval.',
      tipFmt: (i) => `${px[i]}<br>Cumulative ${tick(a.cumGap[i])}<br>90%: ${tick(a.cumLo[i])} to ${tick(a.cumHi[i])}`,
    });

    $('b-fit').textContent = sig === 'none' ? 'Test cities stayed within noise of their synthetic control'
      : `Test cities ran ${signed(real.lift)} ${sig === 'pos' ? 'above' : 'against'} their synthetic control`;
    L.figure($('c-fit'), { legend: $('lg-fit'), caption: `Pre-period fit error ${fmt.pct(real.mape)}. ` + (real.mape <= 0.1
      ? 'The control tracks the test cities before launch, so the gap after the start line is the effect.'
      : 'The control tracks the test cities loosely before launch, so read the gap with care.') });
    $('b-gap').textContent = `The gap adds up to ${tick(real.incr)} conversions in ${a.P} days`;
    L.figure($('c-cum'), { legend: $('lg-cum'), caption: `After ${a.P} days: ${tick(real.incr)} incremental conversions, 90% interval ${tick(lo)} to ${tick(hi)}.` });
    dataTable($('d-fit'), ['Date', 'Actual', 'Synthetic'], xs.map((x, t) => [x + (t === s ? ' (start)' : ''), tick(actual[t]), tick(cf[t])]));
    dataTable($('d-gap'), ['Date', 'Daily gap', 'Cumulative', '90% low', '90% high'],
      px.map((x, i) => [x, tick(gap[s + i]), tick(a.cumGap[i]), tick(a.cumLo[i]), tick(a.cumHi[i])]));

    if (a.pl.length) {
      L.histogram($('c-placebo'), { sample: sampleTag(), values: a.ratios, mark: real.ratio, markLabel: 'Your test', bins: 18, xfmt: (v) => v.toFixed(1), ariaLabel: 'Distribution of post/pre RMSPE ratios across placebo groups, with the real test marked.' });
      const beaten = a.ratios.filter((r) => r < real.ratio).length;
      $('b-placebo').textContent = `Your test's gap beats ${beaten} of ${a.pl.length} placebo groups`;
      $('placebo-txt').textContent = `${a.pl.length} placebo groups of ${state.test.length} control ${state.test.length > 1 ? 'cities' : 'city'}, each given its own synthetic control. Your test's post/pre error ratio is ${real.ratio.toFixed(2)}, above ${beaten} of them. p = ${p.toFixed(2)}.`;
    }

    const rows = Array.from(real.w).map((w, k) => ({ w, g: real.donors[k] })).filter((r) => r.w > 0.001).sort((x, y) => y.w - x.w).slice(0, 10);
    const tb = $('weights');
    tb.innerHTML = '';
    rows.forEach((r) => tb.append(L.el('tr', {}, [
      L.el('td', { text: d.geos[r.g] }), L.el('td', { text: d.regions[r.g] }),
      L.el('td', { class: 'num', text: fmt.pct(r.w) }), L.el('td', { class: 'num', text: tick(mean(Array.from(d.Y[r.g].slice(0, s)))) }),
    ])));
    if (rows.length) $('b-w').textContent = `${d.geos[rows[0].g]} carries ${fmt.pct(rows[0].w, 0)} of the synthetic control`;
    $('weights-txt').textContent = `${Array.from(real.w).filter((w) => w > 0.001).length} of ${real.donors.length} control cities get weight. Test cities: ${state.test.map((g) => d.geos[g]).join(', ')}.`;
  };

  const renderPlan = () => {
    state.planStale = false;
    const d = state.data, s = testStart(), post = getLen();
    if (!state.test.length) return;
    const r = plan(d, state.test, s, post);
    if (r.error) { $('plan-err').textContent = r.error; $('b-power').textContent = 'Smallest lift this design can detect'; return; }
    $('plan-err').textContent = '';
    $('b-power').textContent = Number.isFinite(r.mde) ? `This design detects lifts of +${(r.mde * 100).toFixed(1)}% or more` : 'This design cannot detect lifts under 20%';
    $('k-share').textContent = fmt.pct(volumeShare(d, state.test, s));
    $('k-reps').textContent = String(r.reps);
    $('k-pmape').textContent = fmt.pct(r.mape);
    const x = r.grid.map((g) => (g * 100).toFixed(1) + '%');
    L.line($('c-power'), {
      x, series: [{ values: r.grid.map(() => 0.8), cls: 's-muted', label: '80% power' }, { values: r.power, cls: 's-accent', label: 'Detection rate' }], yMin: 0, yMax: 1, sample: sampleTag(), xEvery: Math.max(2, every($('c-power'), x.length, 56)),
      yfmt: (v) => Math.round(v * 100) + '%', height: 260,
      ariaLabel: 'Detection rate by true lift, with the 80% power line.',
      tipFmt: (i) => `True lift ${x[i]}<br>Detected in ${Math.round(r.power[i] * 100)}% of back-tests`,
    });
    $('plan-txt').textContent = `For these test cities and a ${post}-day test, the method detects a true lift of ${Number.isFinite(r.mde) ? '+' + (r.mde * 100).toFixed(1) + '%' : 'more than 20%'} in 80% of back-tests. ` +
      'Smaller effects will often read as noise.' + (!(r.mde <= 0.1) ? ' Add cities or run longer.' : '');
    dataTable($('d-power'), ['True lift', 'Detection rate'], r.grid.map((g, i) => [x[i], Math.round(r.power[i] * 100) + '%']));
  };

  quick();
  loadSynthetic();
})();
