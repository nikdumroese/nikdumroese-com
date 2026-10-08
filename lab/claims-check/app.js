(() => {
  const L = window.Lab;
  const G = window.ClaimsGate;
  const $ = (id) => document.getElementById(id);

  const ui = {
    channel: $('channel'), market: $('market'), copy: $('copy'), hint: $('copy-hint'),
    verdict: $('verdict'), why: $('why'), annot: $('annot'), findings: $('findings'), ledger: $('ledger'),
    bChannel: $('b-channel'), batch: $('batch'), bRows: $('b-rows'),
    custom: $('custom'), customList: $('custom-list'),
  };
  const custom = [];
  const getThreshold = L.bindRange('threshold', (v) => String(v), () => { runGate(); runBatch(); });

  const VERDICT = {
    approve: { label: 'Auto-approve', cls: '', tag: 'tag--ok' },
    review: { label: 'Needs review', cls: 'is-warn', tag: 'tag--warn' },
    block: { label: 'Blocked', cls: 'is-stop', tag: 'tag--stop' },
    empty: { label: 'Waiting for copy', cls: '', tag: '' },
  };
  const SEV_TAG = { block: 'tag tag--stop', warn: 'tag tag--warn', info: 'tag' };

  const evaluate = (text, channel) => G.run({
    text, channel, market: ui.market.value, threshold: getThreshold(), customBanned: custom,
  });

  // ---------- single draft ----------
  // Findings can overlap (a hype word inside a long sentence). Cut the text at every span edge,
  // then merge neighbouring pieces covered by the same set of findings into one <mark>.
  const annotate = (text, findings) => {
    const n = text.length;
    const spans = [];
    const cuts = new Set([0, n]);
    findings.forEach((f) => f.spans.forEach(([a, b]) => {
      a = L.clamp(a, 0, n); b = L.clamp(b, 0, n);
      if (b > a) { spans.push({ a, b, f }); cuts.add(a); cuts.add(b); }
    }));
    const pts = [...cuts].sort((x, y) => x - y);
    const pieces = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const cover = spans.filter((s) => s.a <= a && s.b >= b).map((s) => s.f);
      const key = cover.map((f) => f.id).join(' ');
      const last = pieces[pieces.length - 1];
      if (last && last.key === key) last.b = b;
      else pieces.push({ a, b, key, cover });
    }
    const frag = document.createDocumentFragment();
    pieces.forEach((p) => {
      const t = text.slice(p.a, p.b);
      if (!p.cover.length) { frag.append(t); return; }
      const label = p.cover.map((f) => `${f.rule}: ${f.message}`).join(' | ');
      frag.append(L.el('mark', {
        class: p.cover.every((f) => f.severity === 'info') ? 'm-info' : null,
        tabindex: '0', role: 'button', title: label, 'aria-label': `${t}. ${label}`,
        'data-f': p.cover[0].id, text: t,
      }));
    });
    ui.annot.replaceChildren(frag);
  };

  const renderFindings = (findings) => {
    if (!findings.length) {
      ui.findings.replaceChildren(L.el('li', {}, [
        L.el('p', { class: 'f-msg' }, [L.el('span', { class: 'tag tag--ok', text: 'clear' }), ' No rule fired.']),
      ]));
      return;
    }
    ui.findings.replaceChildren(...findings.map((f) => L.el('li', { id: 'find-' + f.id, tabindex: '-1' }, [
      L.el('div', {}, [
        L.el('p', { class: 'f-rule' }, [L.el('span', { class: SEV_TAG[f.severity], text: f.severity }), ` ${f.rule} · ${f.category}` + (f.evidence ? ` · ${f.evidence}` : '')]),
        L.el('p', { class: 'f-msg', text: f.message }),
      ]),
      L.el('p', { class: 'f-fix', text: f.fix }),
    ])));
  };

  const runGate = () => {
    const text = ui.copy.value;
    const r = evaluate(text, ui.channel.value);
    const v = VERDICT[r.verdict];
    ui.verdict.textContent = v.label;
    ui.verdict.className = 'verdict__v' + (v.cls ? ' ' + v.cls : '');
    ui.why.textContent = r.verdict === 'review' ? r.reason.replace(/Biggest contributors: .*$/, `Biggest contributors: ${r.findings.filter((f) => f.severity === 'warn').sort((a, b) => b.weight - a.weight).slice(0, 2).map((f) => `${f.message.replace(/\.$/, '')} (${f.rule})`).join('; ')}.`) : r.reason;
    const count = (s) => r.findings.filter((f) => f.severity === s).length;
    $('k-score').textContent = text.trim() ? `${r.score}/${r.threshold}` : '–';
    $('k-block').textContent = text.trim() ? count('block') : '–';
    $('k-warn').textContent = text.trim() ? count('warn') : '–';
    const nb = count('block'), nw = count('warn'), s = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    $('b2').textContent = !text.trim() ? 'Paste a draft to check it'
      : r.verdict === 'block' ? `Blocked: ${s(nb, 'finding')} stop this draft`
      : r.verdict === 'review' ? `Needs review: ${s(nw, 'warning')} add up to ${r.score} (limit ${r.threshold})`
      : `Auto-approved: risk ${r.score}, under the ${r.threshold} limit`;
    const nf = nb + nw;
    $('b3').textContent = nf ? `${s(nf, 'finding')} to fix, each with a suggestion` : 'Nothing to fix';
    annotate(text.replace(/\r\n?/g, '\n'), r.findings);
    renderFindings(r.findings);
    ui.ledger.textContent = JSON.stringify(r.ledger, null, 2);
    renderConfig();
  };

  const jump = (mark) => {
    const li = $('find-' + mark.dataset.f);
    if (!li) return;
    li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    li.focus({ preventScroll: true });
  };
  ui.annot.addEventListener('click', (e) => { const m = e.target.closest('mark'); if (m) jump(m); });
  ui.annot.addEventListener('keydown', (e) => {
    const m = e.target.closest('mark');
    if (m && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); jump(m); }
  });

  const syncHint = () => { ui.hint.textContent = G.CHANNELS[ui.channel.value].hint; };

  // ---------- batch ----------
  let batchResults = [];
  const splitBatch = (raw) => {
    const t = raw.replace(/\r\n?/g, '\n');
    const parts = /^\s*---\s*$/m.test(t) ? t.split(/^\s*---\s*$/m) : t.split('\n');
    return parts.map((s) => s.trim()).filter(Boolean).slice(0, 200);
  };
  const runBatch = () => {
    const channel = ui.bChannel.value;
    batchResults = splitBatch(ui.batch.value).map((text, i) => ({ i: i + 1, text, r: evaluate(text, channel) }));
    const tally = { approve: 0, review: 0, block: 0 };
    batchResults.forEach((b) => { tally[b.r.verdict]++; });
    $('b-approve').textContent = tally.approve;
    $('b-review').textContent = tally.review;
    $('b-block').textContent = tally.block;
    $('b5').textContent = batchResults.length ? `${tally.approve} of ${batchResults.length} variants ship without a human` : "Run an agent's drafts through the gate";
    ui.bRows.replaceChildren(...batchResults.map((b) => {
      const top = b.r.findings.find((f) => f.severity !== 'info') || b.r.findings[0];
      const open = () => {
        ui.channel.value = channel;
        ui.copy.value = b.text;
        syncHint();
        runGate();
        $('t-gate').click();
        ui.copy.focus();
      };
      const btn = L.el('button', { type: 'button', class: 'row-btn', 'aria-label': `Open variant ${b.i} in the single-draft view`, text: String(b.i), onclick: open });
      return L.el('tr', {
        class: 'clickable',
        onclick: (e) => { if (!e.target.closest('.row-btn')) btn.click(); },
      }, [
        L.el('td', { class: 'num' }, btn),
        L.el('td', { text: b.text.length > 140 ? b.text.slice(0, 137) + '…' : b.text }),
        L.el('td', {}, [L.el('span', { class: 'tag ' + VERDICT[b.r.verdict].tag, text: VERDICT[b.r.verdict].label })]),
        L.el('td', { class: 'num', text: b.r.score }),
        L.el('td', { class: 'hide-sm', text: top ? `${top.rule}: ${top.message}` : '–' }),
      ]);
    }));
  };
  $('b-csv').addEventListener('click', () => {
    const rows = batchResults.map((b) => ({
      variant: b.text, channel: b.r.channel, market: b.r.market, verdict: b.r.verdict, risk_score: b.r.score,
      threshold: b.r.threshold, findings: b.r.findings.map((f) => `${f.severity}:${f.rule}`).join(' '),
      reason: b.r.reason,
    }));
    if (rows.length) L.download('claims-gate-batch.csv', L.toCSV(rows));
  });

  // ---------- config ----------
  const renderConfig = () => {
    const channel = ui.channel.value, market = ui.market.value;
    const active = G.activeRules(channel, market).map((r) => (r.id === 'TOV-CUSTOM'
      ? Object.assign({}, r, { params: { terms: custom.slice() } }) : r));
    $('rules-count').textContent = `${active.length} of ${G.RULES.length} rules apply to ${G.CHANNELS[channel].name} copy in ${G.MARKETS[market].name}. Change the channel or market in the controls and this list changes with it.`;
    $('rules-json').textContent = JSON.stringify(active, null, 2);
  };
  const renderRegister = () => {
    $('reg-rows').replaceChildren(...G.REGISTER.map((r) => L.el('tr', {}, [
      L.el('td', { class: 'num', text: r.id }),
      L.el('td', { text: r.claim + (r.qualifier ? ` (keep "${r.qualifier}")` : '') }),
      L.el('td', { text: r.markets.join(', ') }),
      L.el('td', {}, [L.el('span', { class: r.retired ? 'tag tag--warn' : 'tag tag--ok', text: r.retired ? 'Retired' : 'Approved' })]),
      L.el('td', { class: 'hide-sm', text: r.source }),
    ])));
    $('competitors').textContent = `Competitor list: ${G.COMPETITORS.join(', ')}. Any mention goes to review. A comparison or a dig at one blocks.`;
  };
  const renderCustom = () => {
    ui.customList.replaceChildren(...custom.map((w, i) => L.el('button', {
      type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `Remove banned word ${w}`, text: `${w} ×`,
      onclick: () => { custom.splice(i, 1); renderCustom(); runGate(); runBatch(); },
    })));
  };
  const addCustom = () => {
    const w = ui.custom.value.trim().toLowerCase();
    if (w && !custom.includes(w)) custom.push(w);
    ui.custom.value = '';
    renderCustom(); runGate(); runBatch();
  };
  $('add-custom').addEventListener('click', addCustom);
  ui.custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });

  // ---------- wiring ----------
  const loadSample = (id) => {
    const s = G.SAMPLES.find((x) => x.id === id);
    ui.channel.value = s.channel;
    ui.market.value = s.market;
    ui.copy.value = s.text;
    syncHint();
    runGate(); runBatch();
  };
  document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => loadSample(b.dataset.sample)));
  ui.copy.addEventListener('input', L.debounce(runGate, 150));
  ui.batch.addEventListener('input', L.debounce(runBatch, 200));
  ui.channel.addEventListener('change', () => { syncHint(); runGate(); });
  ui.market.addEventListener('change', () => { runGate(); runBatch(); });
  ui.bChannel.addEventListener('change', runBatch);

  // ≤860px the sidebar renders after every output; move the key controls up beside the results
  const quick = () => {
    const strip = L.$('.lab-quick'); if (!strip) return;
    const items = L.$$('[data-quick]').map((n) => { const m = document.createComment('quick'); n.before(m); return [n, m]; });
    const mq = matchMedia('(max-width: 860px)');
    const place = () => items.forEach(([n, m]) => (mq.matches ? strip.append(n) : m.after(n)));
    mq.addEventListener('change', place); place();
  };

  L.tabs(document);
  quick();
  ui.batch.value = G.BATCH_SAMPLE;
  renderRegister();
  loadSample('review');
})();
