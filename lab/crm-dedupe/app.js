// CRM dedupe & standardiser: UI over engine.js. All user data is inserted as text, never as HTML.
(() => {
  const L = window.Lab, E = window.CRMDedupe;
  const { $, $$, el, svgEl, fmt } = L;
  const SEED = 20261008, PEOPLE = 190, PAGE = 40;

  const S = {
    rows: [], headers: [], truth: null, map: {}, res: null, cl: null, golden: [], decisions: {},
    mergesShown: PAGE, reviewShown: PAGE, open: new Set(),
  };

  const n0 = (x) => fmt.num(x);
  const show = (v) => String(v).replace(/^ +| +$/g, (m) => '␣'.repeat(m.length)) || '(blank)';
  const sc = (x) => (x == null ? '–' : x.toFixed(2));

  // ---------------------------------------------------------------- data in
  function setData(rows, headers, truth, label, own) {
    S.rows = rows; S.headers = headers; S.truth = truth; S.decisions = {}; S.open.clear();
    S.mergesShown = S.reviewShown = PAGE;
    S.map = E.detectColumns(headers);
    $('#data-status').textContent = label;
    const t = $('#truth');
    t.disabled = !truth;
    if (!truth) t.checked = false;
    $('#truth-hint').textContent = truth
      ? 'Sample only. The generator knows which rows are the same person.'
      : 'Not available for your own data: there is no answer key.';
    buildMapping();
    const hasName = S.map.first || S.map.last || S.map.full, hasKey = S.map.email || S.map.phone;
    if (own && (!hasName || !hasKey)) {
      $('#map-more').open = true;
      $('#map-note').textContent = `Could not detect ${[!hasName && 'a name column', !hasKey && 'an email or phone column'].filter(Boolean).join(' or ')}. Pick it below; unmapped columns pass through.`;
    } else $('#map-note').textContent = 'Detected from your headers. Change any that are wrong; unmapped columns pass through.';
    runAll();
  }

  function loadSample() {
    const g = E.generate(L.rng(SEED), PEOPLE);
    $('#paste').value = '';
    setData(g.rows, g.headers, g.truth, `Sample: ${g.rows.length} synthetic rows for ${g.people} fictional people.`);
  }

  function loadText(text, label) {
    const rows = L.parseCSV(text);
    const headers = rows.length ? Object.keys(rows[0]) : Object.keys(L.parseCSV((text.split(/\r?\n/)[0] || '') + '\nx')[0] || {});
    setData(rows, headers.filter(Boolean), null, rows.length ? `${label}: ${n0(rows.length)} rows, ${headers.length} columns.` : `${label}: no data rows found.`, true);
  }

  function buildMapping() {
    const host = $('#mapping');
    host.textContent = '';
    E.FIELDS.forEach((f) => {
      const id = 'map-' + f;
      const sel = el('select', { class: 'select', id }, [el('option', { value: '', text: '(none)' })]);
      S.headers.forEach((h) => sel.append(el('option', { value: h, text: h })));
      sel.value = S.map[f] || '';
      sel.addEventListener('change', () => {
        if (sel.value) S.map[f] = sel.value; else delete S.map[f];
        S.decisions = {};
        runAll();
      });
      host.append(el('div', { class: 'field' }, [el('label', { for: id, text: E.FIELD_LABEL[f] }), sel]));
    });
  }

  // ---------------------------------------------------------------- run
  const stdOn = () => Object.fromEntries($$('#std input').map((c) => [c.dataset.std, c.checked]));
  const thr = () => ({ auto: +$('#auto').value, review: Math.min(+$('#review').value, +$('#auto').value) });

  function runAll() {
    S.res = E.run(S.rows, S.map, { defaultCountry: $('#country').value, on: stdOn() });
    S.passCols = S.headers.filter((h) => !Object.values(S.map).includes(h));
    recluster();
    renderFixFilter();
    renderFixes();
  }

  function recluster() {
    const { auto, review } = thr();
    S.cl = E.cluster(S.res.recs, S.res.pairs, { auto, review, decisions: S.decisions });
    S.golden = S.cl.clusters.map((m) => (m.length > 1 ? E.survive(S.res.recs, m, S.passCols) : null));
    S.order = S.cl.clusters.map((m, ci) => ci).filter((ci) => S.cl.clusters[ci].length > 1);
    S.links = S.order.map((ci) => S.cl.mergedPairs.get(S.cl.label[S.cl.clusters[ci][0]]) || []);
    const weakest = new Map(S.order.map((ci, k) => [ci, Math.min(...S.links[k].map((p) => p.s))]));
    S.weak = weakest;
    S.linksByCi = new Map(S.order.map((ci, k) => [ci, S.links[k]]));
    S.order.sort((a, b) => weakest.get(a) - weakest.get(b));
    render();
  }

  // ---------------------------------------------------------------- render: summary + stages
  function render() {
    const { recs, fixes, pairs } = S.res, cl = S.cl, n = recs.length;
    const out = cl.clusters.length, merged = n - out;
    const pending = cl.review.filter((q) => !q.decision && !q.linked).length;
    $('#b1').textContent = n ? `${n0(n)} rows → ${n0(out)} records` : 'No rows loaded';
    $('#k-in').textContent = n0(n);
    $('#k-out').textContent = n0(out);
    $('#k-dup').textContent = n0(merged);
    $('#k-rev').textContent = n0(pending);
    $('#sum-live').textContent = n ? `${n0(n)} rows in, ${n0(out)} records out. ${n0(pending)} ${pending === 1 ? 'pair awaits' : 'pairs await'} review.` : 'No rows loaded.';

    const to = $('#truth-out');
    if (S.truth && $('#truth').checked) {
      const ev = E.evaluate(cl.label, S.truth);
      to.hidden = false;
      to.textContent = `Against the generator's hidden person IDs (pairwise): precision ${ev.precision.toFixed(3)}, recall ${ev.recall.toFixed(3)}, F1 ${ev.f1.toFixed(3)}. ${n0(ev.fp)} wrong pair links, ${n0(ev.fn)} true pairs not yet linked.`;
    } else to.hidden = true;

    const fields = new Set(fixes.map((f) => f.field));
    const all = (n * (n - 1)) / 2, r = S.res.reasons;
    const filledFromDup = S.golden.reduce((s, g) => s + (g ? Object.values(g.prov).filter((p) => p && p.from !== g.master).length : 0), 0);
    const { auto, review } = thr();
    const stages = [
      ['01 Standardise', `${n0(fixes.length)} cells changed across ${fields.size} fields.`, `Default country ${$('#country').value} for rows without one. ${n0(recs.filter((x) => x.phone && !x.phoneOk).length)} phones left as-is (no country or too short); ${n0(recs.filter((x) => !x.emailValid).length)} malformed emails flagged.`],
      ['02 Block', `${n0(pairs.length)} candidate pairs instead of ${n0(all)} all-pairs comparisons.`, `First found via email ${n0(r.email)}, phone ${n0(r.phone)}, company + phonetic name ${n0(r.company)}, phonetic name ${n0(r.name)}. ${S.res.skipped ? n0(S.res.skipped) + ` blocks over ${E.MAX_BLOCK} rows skipped.` : 'No oversized blocks.'}`],
      ['03 Score', `Weighted similarity on email, phone, first name, last name and company.`, `${n0(pairs.filter((p) => p.s >= auto).length)} pairs at or above ${auto.toFixed(2)}; ${n0(cl.review.length)} between ${review.toFixed(2)} and ${auto.toFixed(2)}.`],
      ['04 Cluster', `${n0(S.order.length)} clusters merged ${n0(merged + S.order.length)} rows into ${n0(S.order.length)} records.`, `${n0(pending)} borderline pairs wait for review; ${n0(Object.keys(S.decisions).length)} decided by hand.`],
      ['05 Survive', `${n0(S.order.length)} golden records built field by field.`, `${n0(filledFromDup)} field values taken from a row other than the master, each with its source row and rule.`],
    ];
    const ol = $('#stages');
    ol.textContent = '';
    stages.forEach(([k, msg, fix]) => ol.append(el('li', {}, [el('span', { class: 'f-rule', text: k }), el('span', { class: 'f-msg', text: msg }), el('span', { class: 'f-fix', text: fix })])));

    drawHist();
    renderMerges();
    renderReview();
    renderOut();
  }

  // Histogram with fixed 0–1 domain and two threshold lines. Width follows the host, redrawn on resize.
  function drawHist() {
    const host = $('#hist'), vals = S.res.pairs.map((p) => p.s);
    const { auto, review } = thr();
    const B = 25, counts = new Array(B).fill(0);
    vals.forEach((v) => counts[Math.min(B - 1, Math.floor(v * B))]++);
    const W0 = Math.max(300, Math.round(host.clientWidth || 720)), H0 = 230, m = { t: 22, r: 16, b: 30, l: 44 };
    const W = W0 - m.l - m.r, H = H0 - m.t - m.b;
    host.textContent = '';
    const svg = svgEl('svg', { viewBox: `0 0 ${W0} ${H0}`, width: W0, height: H0, role: 'img', 'aria-label': `Histogram of ${vals.length} candidate pair scores; review from ${review.toFixed(2)}, auto-merge from ${auto.toFixed(2)}` });
    host.append(svg);
    const ticks = L.niceTicks(0, Math.max(1, ...counts), 4), top = ticks[ticks.length - 1] || 1;
    const y = (c) => H - (c / top) * H, x = (v) => v * W;
    ticks.forEach((t) => {
      svgEl('line', { x1: m.l, x2: m.l + W, y1: m.t + y(t), y2: m.t + y(t), class: 'grid' }, svg);
      svgEl('text', { x: m.l - 8, y: m.t + y(t) + 3.5, 'text-anchor': 'end', class: 'tick' }, svg).textContent = t;
    });
    const g = svgEl('g', { transform: `translate(${m.l},${m.t})` }, svg);
    counts.forEach((c, i) => {
      const mid = (i + 0.5) / B;
      const cls = mid >= auto ? 'b-accent' : mid >= review ? 'b-ink' : 'b-muted';
      const r = svgEl('rect', { x: x(i / B) + 1, y: y(c), width: Math.max(1, W / B - 2), height: H - y(c), class: cls }, g);
      r.addEventListener('pointermove', (ev) => L.tip.show(`${(i / B).toFixed(2)}–${((i + 1) / B).toFixed(2)}<br>${c} pairs`, ev.clientX, ev.clientY));
      r.addEventListener('pointerleave', L.tip.hide);
    });
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((t) => { svgEl('text', { x: x(t), y: H + 20, 'text-anchor': 'middle', class: 'tick' }, g).textContent = t.toFixed(1); });
    svgEl('line', { x1: 0, x2: W, y1: H, y2: H, class: 'axis' }, g);
    svgEl('line', { x1: x(review), x2: x(review), y1: -8, y2: H, class: 's-muted' }, g);
    svgEl('line', { x1: x(auto), x2: x(auto), y1: -8, y2: H, class: 's-accent' }, g);
    const close = x(auto) - x(review) < 70;
    svgEl('text', { x: x(review) - 4, y: -10, 'text-anchor': 'end', class: 'lbl lbl--muted' }, g).textContent = 'review ' + review.toFixed(2);
    svgEl('text', { x: Math.min(W, x(auto) + 4), y: close ? 8 : -10, 'text-anchor': x(auto) > W - 90 ? 'end' : 'start', class: 'lbl' }, g).textContent = 'auto ' + auto.toFixed(2);
    host._w = W0;
    $('#hist-cap').textContent = `Each bar counts candidate pairs by match score. ${n0(vals.length)} pairs from blocking.`;
  }
  window.addEventListener('resize', L.debounce(() => { const h = $('#hist'); if (S.res && Math.abs((h._w || 0) - h.clientWidth) > 4) drawHist(); }, 150));

  function renderWeights() {
    const W = E.WEIGHTS, tb = $('#weights');
    [
      ['Email', W.email, 'Exact match on the normalised key. A different email counts at half weight.'],
      ['Phone', W.phone, 'Exact match on E.164.'],
      ['First name', W.first, 'Jaro-Winkler after umlaut folding and nickname lookup.'],
      ['Last name', W.last, 'Jaro-Winkler after umlaut folding. Also tried swapped with first name.'],
      ['Company', W.company, 'Token Jaccard on the company fingerprint, legal forms removed.'],
      ['Name only', '×' + E.NAME_ONLY, 'Applied when no email, phone or company can be compared.'],
      ['First names differ', '×' + E.FIRST_CONFLICT, 'Applied when first-name similarity is under 0.75.'],
    ].forEach(([a, w, b]) => tb.append(el('tr', {}, [el('td', { text: a }), el('td', { class: 'num', text: typeof w === 'number' ? w.toFixed(2) : w }), el('td', { text: b })])));
  }

  // ---------------------------------------------------------------- merges tab
  const recName = (r) => [r.first, r.last].filter(Boolean).join(' ') || r.email || r.id;
  const recRow = (r, master) => el('tr', {}, [
    el('td', { text: r.id + (master ? ' (master)' : '') }), el('td', { text: recName(r) }), el('td', { text: r.email }),
    el('td', { text: r.phone }), el('td', { text: r.company }), el('td', { text: r.title }), el('td', { text: r.stage }), el('td', { class: 'num', text: r.date }),
  ]);
  const smallTable = (label, heads, rows) => el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl', 'aria-label': label }, [
    el('thead', {}, el('tr', {}, heads.map((h) => el('th', { text: h })))), el('tbody', {}, rows),
  ])]);
  const GOLD_LABEL = { first: 'First name', last: 'Last name', email: 'Email', phone: 'Phone', company: 'Company', country: 'Country', title: 'Job title', seniority: 'Seniority', fn: 'Function', stage: 'Lifecycle', date: 'Last activity' };

  function clusterDetail(ci) {
    const gs = S.golden[ci], recs = S.res.recs, members = S.cl.clusters[ci];
    const dl = el('dl', { class: 'kv' });
    Object.keys(GOLD_LABEL).forEach((f) => {
      if (!gs.g[f]) return;
      const p = gs.prov[f];
      dl.append(el('dt', { text: GOLD_LABEL[f] }), el('dd', {}, [document.createTextNode(gs.g[f] + ' '), el('span', { class: 'note', text: p ? `← ${p.from}, ${p.rule}` : '' })]));
    });
    Object.entries(gs.g.extra).forEach(([c, v]) => {
      if (!v) return;
      const p = gs.prov['x:' + c];
      dl.append(el('dt', { text: c }), el('dd', {}, [document.createTextNode(v + ' '), el('span', { class: 'note', text: p ? `← ${p.from}, ${p.rule}` : '' })]));
    });
    const links = (S.linksByCi.get(ci) || []).map((q) => el('tr', {}, [
      el('td', { text: recs[q.a].id }), el('td', { text: recs[q.b].id }), el('td', { class: 'num', text: q.s.toFixed(3) }),
      el('td', { text: q.sig.join(', ') || '–' }), el('td', { text: q.decision === 'merge' ? 'merged by hand' : 'blocked on ' + q.via.join(', ') }),
    ]));
    return el('div', {}, [
      el('p', { class: 'kicker', text: 'Golden record' }), dl,
      el('p', { class: 'kicker', text: 'Source rows (standardised)' }),
      smallTable('Source rows', ['Row', 'Name', 'Email', 'Phone', 'Company', 'Title', 'Stage', 'Last activity'], members.map((i) => recRow(recs[i], recs[i].id === gs.master))),
      el('p', { class: 'kicker', text: 'Pair links' }),
      smallTable('Pair links', ['A', 'B', 'Score', 'Matched', 'How found'], links),
    ]);
  }

  function renderMerges() {
    const tb = $('#merges');
    tb.textContent = '';
    const list = S.order.slice(0, S.mergesShown);
    $('#merges-cap').textContent = S.order.length
      ? `${n0(S.order.length)} merged records, weakest link first so the riskiest merges are on top.`
      : 'No merges at these settings.';
    list.forEach((ci) => {
      const gs = S.golden[ci], g = gs.g, links = S.linksByCi.get(ci) || [];
      const sig = [...new Set(links.flatMap((q) => q.sig))].join(', ');
      const open = S.open.has(ci), did = 'cd-' + ci;
      const btn = el('button', { type: 'button', class: 'btn btn--sm btn--ghost', 'aria-expanded': String(open), 'aria-controls': did, text: open ? 'Hide' : 'Show' });
      const det = el('tr', { id: did, hidden: !open }, el('td', { colspan: 5 }, open ? clusterDetail(ci) : null));
      btn.addEventListener('click', () => {
        const now = !S.open.has(ci);
        if (now) { S.open.add(ci); if (!det.firstChild.firstChild) det.firstChild.append(clusterDetail(ci)); } else S.open.delete(ci);
        det.hidden = !now;
        btn.setAttribute('aria-expanded', String(now));
        btn.textContent = now ? 'Hide' : 'Show';
      });
      tb.append(el('tr', {}, [
        el('td', {}, [el('strong', { text: [g.first, g.last].filter(Boolean).join(' ') || g.email || gs.master }), el('br'), el('span', { class: 'note', text: [g.email, g.company].filter(Boolean).join(' · ') })]),
        el('td', { class: 'num', text: gs.members.length }),
        el('td', { class: 'num', text: S.weak.get(ci).toFixed(2) }),
        el('td', { text: sig || '–' }),
        el('td', {}, btn),
      ]), det);
    });
    const more = $('#merges-more');
    more.hidden = S.order.length <= S.mergesShown;
    more.textContent = `Show more (${n0(S.order.length - list.length)} left)`;
  }

  // ---------------------------------------------------------------- review tab
  function renderReview() {
    const recs = S.res.recs, ul = $('#review-list');
    ul.textContent = '';
    const q = S.cl.review.filter((p) => !p.linked);
    const pending = q.filter((p) => !p.decision).length;
    $('#review-cap').textContent = q.length
      ? `${n0(pending)} pairs scored between ${thr().review.toFixed(2)} and ${thr().auto.toFixed(2)} and need a decision. Results update as you click. Click a pressed button again to undo.`
      : 'Nothing in the review band at these thresholds.';
    q.slice(0, S.reviewShown).forEach((p) => {
      const A = recs[p.a], B = recs[p.b], key = E.pairKey(A, B), f = p.f;
      const row = (label, a, b, s) => el('tr', {}, [el('td', { text: label }), el('td', { text: a || '–' }), el('td', { text: b || '–' }), el('td', { class: 'num', text: s })]);
      const tbl = smallTable(`Pair ${A.id} and ${B.id}`, ['Field', A.id, B.id, 'Score'], [
        row('First name', A.first, B.first, sc(f.first) + (f.swapped ? ' (swapped)' : '')),
        row('Last name', A.last, B.last, sc(f.last)),
        row('Email', A.email, B.email, sc(f.email)),
        row('Phone', A.phone, B.phone, sc(f.phone)),
        row('Company', A.company, B.company, sc(f.company)),
        row('Title', A.title, B.title, ''),
        row('Country', A.country, B.country, ''),
        row('Last activity', A.date, B.date, ''),
      ]);
      const mk = (val, label) => {
        const b = el('button', { type: 'button', class: 'btn btn--sm' + (p.decision === val ? '' : ' btn--ghost'), 'aria-pressed': String(p.decision === val), 'data-key': key + '#' + val, text: label });
        b.addEventListener('click', () => {
          if (S.decisions[key] === val) delete S.decisions[key]; else S.decisions[key] = val;
          const all = () => [...$('#review-list').querySelectorAll('button[data-key]')];
          const idx = all().indexOf(b);
          recluster();
          // The pair can drop out of the queue once a merge links it transitively; then land on whatever took its slot.
          const now = all(), again = now.find((x) => x.dataset.key === key + '#' + val);
          const next = again || now[idx - (idx % 2)] || now[now.length - 2];
          if (next) next.focus();
        });
        return b;
      };
      const status = p.decision === 'merge' ? 'Merged by you' : p.decision === 'separate' ? 'Kept separate by you' : 'Pending';
      ul.append(el('li', {}, [
        el('span', { class: 'f-rule', text: p.s.toFixed(2) }),
        el('div', { class: 'f-msg' }, [
          el('p', {}, [el('span', { class: 'tag' + (p.decision ? ' tag--ok' : ' tag--warn'), text: status }), document.createTextNode(` Matched: ${p.sig.join(', ') || 'partial name'}. ${f.nameOnly ? 'Name-only evidence. ' : ''}${f.firstConflict ? 'First names differ. ' : ''}`)]),
          tbl,
          el('div', { class: 'btns' }, [mk('merge', 'Merge'), mk('separate', 'Keep separate')]),
        ]),
      ]));
    });
    const more = $('#review-more');
    more.hidden = q.length <= S.reviewShown;
    more.textContent = `Show more (${n0(q.length - Math.min(q.length, S.reviewShown))} left)`;
  }

  // ---------------------------------------------------------------- fixes tab
  function renderFixFilter() {
    const sel = $('#fix-filter'), cur = sel.value, counts = {};
    S.res.fixes.forEach((f) => { counts[f.field] = (counts[f.field] || 0) + 1; });
    sel.textContent = '';
    sel.append(el('option', { value: '', text: `All fields (${n0(S.res.fixes.length)})` }));
    Object.entries(counts).forEach(([k, v]) => sel.append(el('option', { value: k, text: `${k} (${n0(v)})` })));
    sel.value = counts[cur] ? cur : '';
  }
  function renderFixes() {
    const f = $('#fix-filter').value, list = S.res.fixes.filter((x) => !f || x.field === f), cap = 300;
    const tb = $('#fixes');
    tb.textContent = '';
    list.slice(0, cap).forEach((x) => tb.append(el('tr', {}, [
      el('td', { class: 'num', text: x.id }), el('td', { text: x.field }), el('td', { class: 'old', text: show(x.before) }), el('td', { text: x.after || '(blank)' }),
    ])));
    $('#fixes-cap').textContent = list.length
      ? `${n0(list.length)} changes${list.length > cap ? `, first ${cap} shown; the clean CSV has all of them` : ''}. ␣ marks a stray space.`
      : 'No changes for this field.';
  }

  // ---------------------------------------------------------------- output
  function outputColumns() {
    const m = S.map, cols = [['record_id', (g) => g.id]];
    if (m.first || m.last || m.full) cols.push(['first_name', (g) => g.first], ['last_name', (g) => g.last]);
    if (m.email) cols.push(['email', (g) => g.email]);
    if (m.phone) cols.push(['phone', (g) => g.phone]);
    if (m.company) cols.push(['company', (g) => g.company]);
    if (m.country) cols.push(['country', (g) => g.country]);
    if (m.title) cols.push(['job_title', (g) => g.title], ['seniority', (g) => g.seniority], ['job_function', (g) => g.fn]);
    if (m.lifecycle) cols.push(['lifecycle_stage', (g) => g.stage]);
    if (m.last_activity) cols.push(['last_activity', (g) => g.date]);
    cols.push(['merged_from', (g) => g.merged || '']);
    S.passCols.forEach((c) => cols.push([c, (g) => g.extra[c]]));
    return cols;
  }
  function cleanRecords() {
    const recs = S.res.recs;
    return S.cl.clusters.map((m, ci) => {
      if (m.length === 1) {
        const r = recs[m[0]];
        return { ...r, fn: r.fn, extra: r.raw };
      }
      const gs = S.golden[ci];
      return { ...gs.g, merged: gs.members.filter((x) => x !== gs.master).join(' ') };
    }).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  }
  function renderOut() {
    const cols = outputColumns(), recs = cleanRecords();
    const head = $('#out-head'), body = $('#out-body');
    head.textContent = ''; body.textContent = '';
    head.append(el('tr', {}, cols.map(([c]) => el('th', { text: c }))));
    recs.slice(0, 25).forEach((g) => body.append(el('tr', {}, cols.map(([, fn]) => el('td', { text: fn(g) == null ? '' : fn(g) })))));
    $('#out-cap').textContent = recs.length
      ? `${n0(recs.length)} records. Preview shows the first 25. The merge log lists every golden field with its source row and rule, plus every pair link.`
      : 'Load data to produce output.';
    S.out = { cols, recs };
  }
  function downloadClean() {
    const { cols, recs } = S.out;
    const objs = recs.map((g) => Object.fromEntries(cols.map(([c, fn]) => [c, fn(g)])));
    L.download('crm-clean.csv', L.toCSV(objs, cols.map(([c]) => c)));
  }
  function downloadLog() {
    const recs = S.res.recs, rows = [];
    S.order.forEach((ci, k) => {
      const gs = S.golden[ci], cid = 'M' + String(k + 1).padStart(5, '0'), members = gs.members.join(' ');
      Object.keys(GOLD_LABEL).forEach((f) => {
        const p = gs.prov[f];
        rows.push({ cluster_id: cid, golden_id: gs.master, member_ids: members, kind: 'field', field: f, value: gs.g[f], source_record: p ? p.from : '', rule: p ? p.rule : 'empty in all rows', score: '' });
      });
      Object.keys(gs.g.extra).forEach((c) => {
        const p = gs.prov['x:' + c];
        rows.push({ cluster_id: cid, golden_id: gs.master, member_ids: members, kind: 'field', field: c, value: gs.g.extra[c], source_record: p ? p.from : '', rule: p ? p.rule : 'empty in all rows', score: '' });
      });
      (S.linksByCi.get(ci) || []).forEach((q) => rows.push({
        cluster_id: cid, golden_id: gs.master, member_ids: members, kind: 'link', field: '', value: recs[q.a].id + ' ~ ' + recs[q.b].id,
        source_record: '', rule: (q.decision === 'merge' ? 'manual merge; ' : 'auto; ') + 'matched ' + (q.sig.join('+') || 'partial') + '; blocked on ' + q.via.join('+'), score: q.s.toFixed(3),
      }));
    });
    S.cl.review.filter((q) => q.decision === 'separate').forEach((q) => rows.push({
      cluster_id: '', golden_id: '', member_ids: '', kind: 'kept-separate', field: '', value: recs[q.a].id + ' ~ ' + recs[q.b].id, source_record: '', rule: 'manual keep separate', score: q.s.toFixed(3),
    }));
    L.download('crm-merge-log.csv', L.toCSV(rows, ['cluster_id', 'golden_id', 'member_ids', 'kind', 'field', 'value', 'source_record', 'rule', 'score']));
  }

  // ---------------------------------------------------------------- wiring
  const thrFmt = (v) => v.toFixed(2);
  L.bindRange('auto', thrFmt, () => { if (+$('#review').value > +$('#auto').value) { $('#review').value = $('#auto').value; $('output[for="review"]').textContent = thrFmt(+$('#review').value); } recluster(); });
  L.bindRange('review', thrFmt, () => { if (+$('#review').value > +$('#auto').value) { $('#auto').value = $('#review').value; $('output[for="auto"]').textContent = thrFmt(+$('#auto').value); } recluster(); });
  $('#country').addEventListener('change', runAll);
  $$('#std input').forEach((c) => c.addEventListener('change', () => { S.decisions = {}; runAll(); }));
  $('#truth').addEventListener('change', render);
  $('#load-sample').addEventListener('click', loadSample);
  $('#use-paste').addEventListener('click', () => loadText($('#paste').value, 'Pasted CSV'));
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await L.readFile(f);
    loadText(text, f.name);
  });
  $('#fix-filter').addEventListener('change', renderFixes);
  $('#merges-more').addEventListener('click', () => { S.mergesShown += PAGE; renderMerges(); });
  $('#review-more').addEventListener('click', () => { S.reviewShown += PAGE; renderReview(); });
  $('#dl-clean').addEventListener('click', downloadClean);
  $('#dl-log').addEventListener('click', downloadLog);
  L.tabs(document);
  renderWeights();
  loadSample();
})();
