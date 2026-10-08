// Agent governance lab: UI over engine.js (the ported agent-governance core) and data.js (fixture data).
(() => {
  const L = window.Lab, E = window.AGEngine, DATA = window.AG_DATA;
  const { $, el, esc, fmt } = L;

  const tsOf = (r) => r.started_at || r.completed_at;
  const EVENTS = [...DATA.events].sort((a, b) => tsOf(a).localeCompare(tsOf(b)));
  const N = EVENTS.length;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const DEFAULT_POLICY = clone(DATA.policy);

  // Fixed list of tone streams and days (from the full run) so the drift chart doesn't reshuffle during replay.
  const FULL = E.run({ rawEvents: EVENTS, policy: DEFAULT_POLICY, outcomes: DATA.outcomes });
  // Streams with an alarm in the full week first, so the chart opens on the one worth looking at.
  const alarmed = new Set(FULL.drift.alarms.map((a) => `${a.agentId}|${a.channel}`));
  const STREAMS = [...new Set(FULL.drift.points.map((p) => `${p.agentId}|${p.channel}`))].sort((a, b) => alarmed.has(b) - alarmed.has(a));
  const STREAM_LABEL = Object.fromEntries(FULL.drift.points.map((p) => [`${p.agentId}|${p.channel}`, `${p.agentLabel} · ${E.channelLabel(p.channel)}`]));
  const DAYS = (() => {
    const out = [], d = new Date(tsOf(EVENTS[0]).slice(0, 10) + 'T00:00:00Z'), end = tsOf(EVENTS[N - 1]).slice(0, 10);
    while (d.toISOString().slice(0, 10) <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  })();

  const S = { policy: clone(DEFAULT_POLICY), k: N, overrides: [], sel: null, stream: STREAMS[0], role: 'legal', timer: null, st: null };

  const DEC = {
    auto: { label: 'Auto-approve', cls: 'tag tag--ok' },
    review: { label: 'Needs review', cls: 'tag tag--warn' },
    block: { label: 'Blocked', cls: 'tag tag--stop' },
  };
  const VERDICT_CLS = { pass: 'tag', warn: 'tag tag--warn', fail: 'tag tag--stop' };
  const chip = (d, text) => el('span', { class: DEC[d].cls, text: text || DEC[d].label });
  const when = (iso) => `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
  const short = (s, n = 46) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '—');
  const decisionWord = (d) => ({ auto: 'auto-approve', review: 'needs review', block: 'blocked' }[d]);

  /* ---------- controls ---------- */
  const fmt2 = (v) => v.toFixed(2);
  const posLabel = (v) => (v === 0 ? '0 / ' + N : `${v} / ${N} · ${when(tsOf(EVENTS[v - 1]))}`);

  const setRange = (id, v) => {
    const i = document.getElementById(id);
    i.value = v;
    i.dispatchEvent(new Event('sync'));
  };
  const bind = (id, f, apply) => {
    const get = L.bindRange(id, f, (v) => { apply(v); update(); });
    const input = document.getElementById(id), out = document.querySelector(`output[for="${id}"]`);
    input.addEventListener('sync', () => { out.textContent = f(+input.value); });
    return get;
  };

  bind('pos', posLabel, (v) => { S.k = v; stop(); });
  bind('ceil', (v) => fmt.eur(v).replace('€', '$') + '/day', (v) => { S.policy.spend.ceilingsByAgent['blog-agent'] = v; });
  bind('maxmail', (v) => String(v), (v) => { S.policy.spend.maxEmailsPerDay = v; });
  bind('warn', fmt2, (v) => {
    S.policy.tov.warnBelow = v;
    if (S.policy.tov.failBelow > v) { S.policy.tov.failBelow = v; setRange('fail', v); }
  });
  bind('fail', fmt2, (v) => {
    S.policy.tov.failBelow = v;
    if (S.policy.tov.warnBelow < v) { S.policy.tov.warnBelow = v; setRange('warn', v); }
  });
  bind('drop', fmt2, (v) => { S.policy.drift.dropThreshold = v; });
  bind('minsamp', String, (v) => { S.policy.drift.minSamples = v; });
  bind('window', (v) => v + 'h', (v) => { S.policy.conflict.windowHours = v; });
  bind('omin', String, (v) => { S.policy.outcomes.minSamples = v; });

  [['ceil-growth', 'growth-agent'], ['ceil-budget', 'budget-bot']].forEach(([id, agent]) => {
    document.getElementById(id).addEventListener('input', (e) => {
      const v = e.target.value.trim();
      if (v === '' || !Number.isFinite(+v)) delete S.policy.spend.ceilingsByAgent[agent];
      else S.policy.spend.ceilingsByAgent[agent] = +v;
      update();
    });
  });

  // Approval rules editor: one select per rule, plus the default.
  const ruleLabel = (r) => `${r.checkType ? E.checkTypeLabel(r.checkType) : 'Any check'} · ${r.verdict || 'any verdict'}`;
  const decisionSelect = (id, value, onChange) => {
    const s = el('select', { class: 'select', id, onchange: (e) => { onChange(e.target.value); update(); } },
      ['auto', 'review', 'block'].map((d) => el('option', { value: d, text: DEC[d].label, selected: d === value })));
    return s;
  };
  const buildRules = () => {
    const host = $('#rules');
    host.innerHTML = '';
    S.policy.approval.rules.forEach((r, i) => {
      host.append(el('div', { class: 'field' }, [
        el('label', { for: `rule-${i}`, text: `${i + 1}. ${ruleLabel(r)}` }),
        decisionSelect(`rule-${i}`, r.decision, (v) => { r.decision = v; }),
      ]));
    });
    host.append(el('div', { class: 'field' }, [
      el('label', { for: 'rule-default', text: 'No rule matches / all pass' }),
      decisionSelect('rule-default', S.policy.approval.default, (v) => { S.policy.approval.default = v; }),
    ]));
  };

  const syncControls = () => {
    const p = S.policy;
    setRange('ceil', p.spend.ceilingsByAgent['blog-agent']);
    setRange('maxmail', p.spend.maxEmailsPerDay);
    setRange('warn', p.tov.warnBelow);
    setRange('fail', p.tov.failBelow);
    setRange('drop', p.drift.dropThreshold);
    setRange('minsamp', p.drift.minSamples);
    setRange('window', p.conflict.windowHours);
    setRange('omin', p.outcomes.minSamples);
    $('#ceil-growth').value = p.spend.ceilingsByAgent['growth-agent'] ?? '';
    $('#ceil-budget').value = p.spend.ceilingsByAgent['budget-bot'] ?? '';
    buildRules();
  };

  $('#policy-reset').addEventListener('click', () => { S.policy = clone(DEFAULT_POLICY); syncControls(); update(); });
  $('#policy-dl').addEventListener('click', () => L.download('policy.json', JSON.stringify(S.policy, null, 2) + '\n', 'application/json'));

  /* ---------- replay ---------- */
  const setK = (k) => { S.k = Math.max(0, Math.min(N, k)); setRange('pos', S.k); update(); };
  const stop = () => {
    if (!S.timer) return;
    clearInterval(S.timer); S.timer = null;
    $('#play').textContent = 'Play'; $('#play').setAttribute('aria-pressed', 'false');
  };
  $('#back').addEventListener('click', () => { stop(); setK(S.k - 1); });
  $('#step').addEventListener('click', () => { stop(); setK(S.k + 1); });
  $('#rewind').addEventListener('click', () => { stop(); setK(0); });
  $('#play').addEventListener('click', () => {
    if (S.timer) return stop();
    if (S.k >= N) setK(0);
    $('#play').textContent = 'Pause'; $('#play').setAttribute('aria-pressed', 'true');
    S.timer = setInterval(() => { if (S.k >= N) stop(); else setK(S.k + 1); }, 700);
  });

  /* ---------- gate actions (append-only) ---------- */
  L.bindSeg($('#role'), (v) => { S.role = v; });
  const decideHuman = (eventId, decision) => {
    S.overrides = [...S.overrides, { eventId, decision, actorRole: S.role, note: decision === 'auto' ? 'approved' : 'rejected', createdAt: new Date().toISOString() }];
    const ev = S.st.rows.find((r) => r.eventId === eventId);
    $('#gate-status').textContent = `${decision === 'auto' ? 'Approved' : 'Rejected'}: ${ev.agentLabel}, ${E.actionTypeLabel(ev.actionType).toLowerCase()}. Override row ${S.overrides.length} appended.`;
    update();
    const next = $('#queue button');
    (next || $('#b-gate')).focus();
  };
  $('#b-gate').setAttribute('tabindex', '-1');
  $('#ov-reset').addEventListener('click', () => {
    S.overrides = [];
    $('#gate-status').textContent = 'Fixture ledger reloaded. Override rows cleared.';
    update();
  });

  /* ---------- render: ledger ---------- */
  const decidedByText = (ev) => {
    const eff = S.st.effective.get(ev.eventId);
    if (eff.overridden) return `Override by ${eff.overrideActorRole} (system: ${decisionWord(eff.systemDecision)})`;
    const a = S.st.approvals.find((x) => x.eventId === ev.eventId);
    const d = a.decidedBy;
    if (!d) return `All checks pass → default ${decisionWord(a.decision)}`;
    if (d.ruleIndex < 0) return `${E.checkTypeLabel(d.checkType)} ${d.verdict}, no rule → default`;
    return `${E.checkTypeLabel(d.checkType)} ${d.verdict} → rule ${d.ruleIndex + 1}`;
  };

  const select = (id, focus) => {
    S.sel = id;
    renderTable();
    renderDetail();
    if (focus) { const li = document.querySelector(`#ev-rows li[data-id="${id}"]`); li && li.focus(); }
  };

  const renderCounts = () => {
    const g = S.st.gate;
    $('#k-events').textContent = S.st.rows.length;
    $('#b-ledger').textContent = S.st.rows.length
      ? `${g.auto} of ${S.st.rows.length} actions run; ${g.review} wait for review, ${g.block} blocked`
      : 'The ledger is empty; step the replay to ingest actions';
    $('#k-find').textContent = S.st.findings.length;
  };

  // Chronological log of all fixture events: ingested ones are selectable, not-yet-ingested ones are dimmed.
  const renderTable = () => {
    const list = $('#ev-rows');
    const keepScroll = list.scrollTop;
    list.innerHTML = '';
    EVENTS.forEach((raw, i) => {
      const ev = S.st.rows[i];
      if (!ev) {
        list.append(el('li', { class: 'is-future', 'aria-hidden': 'true' }, [
          el('span', { class: 't', text: when(tsOf(raw)) }),
          el('span', { class: 'who', text: raw.agent || raw.zap_title }),
          el('span', { class: 'note', text: 'Not ingested yet' }),
        ]));
        return;
      }
      const eff = S.st.effective.get(ev.eventId);
      const li = el('li', {
        class: ev.eventId === S.sel ? 'is-now' : null, tabindex: 0, 'data-id': ev.eventId, role: 'button',
        'aria-pressed': String(ev.eventId === S.sel),
        onclick: () => select(ev.eventId),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(ev.eventId, true); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const sib = e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
            if (sib && sib.tabIndex === 0) sib.focus();
          }
        },
      }, [
        el('span', { class: 't', text: when(ev.ts.toISOString()) }),
        el('span', { class: 'who', text: ev.agentLabel }),
        el('span', {}, [
          chip(eff.decision), document.createTextNode(` ${E.actionTypeLabel(ev.actionType)}: `),
          el('span', { text: short(ev.subjectRef, 44), title: ev.subjectRef || '' }), el('br'),
          el('span', { class: 'note', text: decidedByText(ev) }),
        ]),
      ]);
      list.append(li);
    });
    list.scrollTop = keepScroll;
  };

  // Keep the newest ingested event in view inside the log (never scrolls the page itself).
  const followLatest = () => {
    const list = $('#ev-rows'), li = list.children[S.k - 1];
    if (!li) { list.scrollTop = 0; return; }
    const top = li.offsetTop - list.offsetTop, bottom = top + li.offsetHeight;
    if (bottom > list.scrollTop + list.clientHeight || top < list.scrollTop) list.scrollTop = Math.max(0, bottom - list.clientHeight + 8);
  };

  const renderDetail = () => {
    const ev = S.st.rows.find((r) => r.eventId === S.sel);
    $('#detail').hidden = !ev;
    $('#d-empty').hidden = !!ev;
    if (!ev) { $('#d-title').textContent = 'Check trace'; return; }
    const eff = S.st.effective.get(ev.eventId);
    const a = S.st.approvals.find((x) => x.eventId === ev.eventId);
    $('#d-title').textContent = `Check trace · ${ev.eventId}`;
    const kv = $('#d-kv');
    kv.innerHTML = '';
    const pair = (k, v) => kv.append(el('dt', { text: k }), el('dd', {}, [].concat(v)));
    pair('Agent', `${ev.agentLabel} (${ev.agentId}) via ${E.sourceLabel(ev.source)}, attribution ${ev.attributionConfidence}`);
    pair('Action', `${E.actionTypeLabel(ev.actionType)} · ${E.channelLabel(ev.channel)} · ${ev.ts.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
    pair('Subject', ev.subjectRef || '—');
    pair('Decision', [chip(eff.decision), document.createTextNode(' ' + decidedByText(ev))]);
    if (a.reasons.length) pair('Reasons', a.reasons.join(' · '));

    const list = $('#d-checks');
    list.innerHTML = '';
    const checks = S.st.checks.filter((c) => c.eventId === ev.eventId);
    checks.forEach((c) => {
      const kids = [
        el('span', { class: 'f-rule' }, [el('span', { class: VERDICT_CLS[c.verdict], text: c.verdict })]),
        el('span', { class: 'f-msg', text: `${E.checkTypeLabel(c.checkType)}${c.score != null ? ` · score ${c.score.toFixed(2)}` : ''}: ${c.rationale}` }),
      ];
      if (c.offendingSpans.length) kids.push(el('span', { class: 'f-fix', text: c.offendingSpans.map((s) => `“${s}”`).join(' · ') }));
      list.append(el('li', {}, kids));
    });
    const ran = new Set(checks.map((c) => c.checkType));
    const na = ['tov', 'claims', 'competitor', 'regulated', 'spend', 'conflict'].filter((t) => !ran.has(t));
    $('#d-na').textContent = na.length ? `Not applicable to this action: ${na.map(E.checkTypeLabel).join(', ')}.` : '';
    $('#d-raw').textContent = JSON.stringify(ev.rawPayload, null, 2);
    const { rawPayload, ...row } = ev;
    $('#d-row').textContent = JSON.stringify({ ...row, ts: ev.ts.toISOString() }, null, 2);
  };

  /* ---------- render: gate ---------- */
  // Dry-run effect: what the action does if it goes ahead, read from the raw payload and the ledger so far.
  const dryRun = (ev) => {
    const raw = ev.rawPayload;
    if (ev.actionType === 'ad.budget_change') {
      const prev = S.st.rows.filter((r) => r.ts < ev.ts && r.subjectRef === ev.subjectRef && r.money?.budgetNew != null).pop();
      const ceil = S.policy.spend.ceilingsByAgent[ev.agentId];
      return [
        ['Campaign', ev.subjectRef],
        ['Daily budget', `${prev ? prev.money.budgetNew + ' → ' : ''}${ev.money.budgetNew} ${ev.money.currency}${prev ? '' : ' (no earlier change in the ledger)'}`],
        ['Ceiling', ceil == null ? 'none for this agent' : `${ceil} ${S.policy.spend.currency}/day`],
      ];
    }
    if (ev.actionType === 'email.send') return [['Send to', raw.action.output.to], ['Subject', ev.content.subject], ['Body', short(ev.content.text, 160)]];
    if (ev.actionType === 'page.publish') return [['Publish', ev.subjectRef], ['Title', ev.content.subject], ['Body', short(ev.content.text, 160)]];
    if (ev.actionType === 'social.post') return [['Post to', raw.tool_call.args.network], ['Text', short(ev.content.text, 160)]];
    return [['Action', E.actionTypeLabel(ev.actionType)]];
  };

  const renderGate = () => {
    const g = S.st.gate;
    const queue = g.pending.filter((p) => !p.overridden);
    $('#b-gate').textContent = queue.length ? `${queue.length} action${queue.length === 1 ? '' : 's'} wait${queue.length === 1 ? 's' : ''} for a human` : 'Nothing is waiting for a human';
    $('#k-ov').textContent = S.overrides.length;
    $('#k-exp').textContent = '$' + fmt.num(S.st.outcomes.totalGateExposureRevenue);
    const host = $('#queue');
    host.innerHTML = '';
    $('#queue-empty').hidden = queue.length > 0;
    queue.forEach((p) => {
      const ev = S.st.rows.find((r) => r.eventId === p.eventId);
      const title = `${p.agentLabel} · ${E.actionTypeLabel(p.actionType)}`;
      host.append(el('li', {}, [
        el('span', { class: 'f-rule' }, [chip(p.decision)]),
        el('div', { class: 'f-msg' }, [
          el('b', { text: title }), el('br'),
          el('span', { class: 'note', text: `${short(p.subjectRef, 34)} · ${when(p.ts)}`, title: p.subjectRef || '' }),
          el('p', { class: 'mt-sm', text: p.reasons.join(' · ') }),
          el('p', { class: 'note mt-sm', text: 'Dry run, if approved:' }),
          el('dl', { class: 'kv mt-sm' }, dryRun(ev).flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
          el('div', { class: 'btns' }, [
            el('button', { class: 'btn btn--sm', type: 'button', text: 'Approve', 'aria-label': `Approve: ${title}`, onclick: () => decideHuman(p.eventId, 'auto') }),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Reject', 'aria-label': `Reject: ${title}`, onclick: () => decideHuman(p.eventId, 'block') }),
          ]),
        ]),
      ]));
    });
    const hist = g.history;
    $('#hist-empty').hidden = hist.length > 0;
    $('#hist-wrap').hidden = !hist.length;
    const hb = $('#hist');
    hb.innerHTML = '';
    hist.forEach((h) => hb.append(el('tr', {}, [
      el('td', {}, [document.createTextNode(`${h.agentLabel} · ${E.actionTypeLabel(h.actionType)}`), el('br'), el('span', { class: 'note', text: short(h.subjectRef, 40) })]),
      el('td', {}, [chip(h.systemDecision)]),
      el('td', {}, [chip(h.overrideDecision, h.overrideDecision === 'auto' ? 'Approved' : h.overrideDecision === 'block' ? 'Rejected' : 'Needs review')]),
      el('td', { class: 'hide-sm note', text: h.actorRole }),
    ])));
  };

  /* ---------- render: drift ---------- */
  const streamSeg = $('#stream');
  STREAMS.forEach((s, i) => streamSeg.append(el('button', { type: 'button', 'data-value': s, 'aria-pressed': String(i === 0), text: STREAM_LABEL[s] })));
  L.bindSeg(streamSeg, (v) => { S.stream = v; renderDrift(); });

  const renderDrift = () => {
    const d = S.st.drift, p = S.policy;
    const pts = d.points.filter((x) => `${x.agentId}|${x.channel}` === S.stream);
    const byDay = new Map(pts.map((x) => [x.date, x]));
    const base = d.baselines[S.stream];
    const alarmDays = new Set(d.alarms.filter((a) => `${a.agentId}|${a.channel}` === S.stream).map((a) => a.date));
    const values = DAYS.map((day) => (byDay.has(day) ? byDay.get(day).mean : NaN));
    const series = [{ values, cls: 's-ink', name: 'Daily mean', label: 'Daily mean' }];
    if (base) series.push({ values: DAYS.map(() => base.mean), cls: 's-muted', name: 'Baseline', label: 'Baseline' });
    series.push({ values: DAYS.map(() => p.tov.warnBelow), cls: 's-accent', name: 'Warn line', label: 'Warn line' });
    L.line($('#c-drift'), {
      sample: `Fixture · ${DAYS.length} days`,
      x: DAYS.map((x) => x.slice(5)),
      series,
      yMin: 0, yMax: 1, height: 260, yfmt: (v) => v.toFixed(1),
      ariaLabel: `Daily tone score, ${STREAM_LABEL[S.stream]}`,
      points: DAYS.map((day, i) => (byDay.has(day) ? { i, v: byDay.get(day).mean, cls: alarmDays.has(day) ? 'dot-accent' : 'dot-ink', r: alarmDays.has(day) ? 5 : 3.5 } : null)).filter(Boolean),
      tipFmt: (i) => {
        const pt = byDay.get(DAYS[i]);
        if (!pt) return `${DAYS[i]}<br>No scored actions`;
        return `${DAYS[i]}<br>Mean ${pt.mean.toFixed(2)} (${pt.n} scored)<br>Baseline ${base.mean.toFixed(2)}${alarmDays.has(DAYS[i]) ? '<br>Alarm' : ''}`;
      },
    });
    const streamAlarms = d.alarms.filter((a) => `${a.agentId}|${a.channel}` === S.stream);
    L.figure($('#c-drift'), {
      caption: !base ? `${STREAM_LABEL[S.stream]}: nothing scored yet.`
        : streamAlarms.length ? `${STREAM_LABEL[S.stream]}: ${streamAlarms.map((a) => `${a.date.slice(5)} scored ${a.mean.toFixed(2)}`).join(', ')}, against a usual ${base.mean.toFixed(2)}.`
        : `${STREAM_LABEL[S.stream]}: every scored day stays near its usual ${base.mean.toFixed(2)}.`,
    });
    L.dataTable($('#drift-data'), ['Day', { label: 'Mean score', num: true }, { label: 'Scored', num: true, hideSm: true }, { label: 'Baseline', num: true }, 'Alarm'],
      DAYS.map((day) => {
        const pt = byDay.get(day);
        return [day.slice(5), pt ? pt.mean.toFixed(2) : '–', pt ? pt.n : 0, base ? base.mean.toFixed(2) : '–', alarmDays.has(day) ? 'Yes' : ''];
      }), { summary: 'Daily scores as a table' });
    const flaggedStreams = new Set(d.alarms.map((a) => `${a.agentId}|${a.channel}`));
    $('#b-drift').textContent = !d.alarms.length ? 'No agent drifted from its usual tone'
      : flaggedStreams.size === 1 ? `${STREAM_LABEL[[...flaggedStreams][0]]}: ${d.alarms.length === 1 ? 'one day' : d.alarms.length + ' days'} off its usual tone`
      : `${flaggedStreams.size} agent streams drifted off their usual tone`;
    $('#drift-note').textContent = base
      ? `Baseline ${base.mean.toFixed(2)} from ${base.n} day${base.n === 1 ? '' : 's'}. Alarm if a day is under the warn line (${p.tov.warnBelow.toFixed(2)}) or more than ${p.drift.dropThreshold.toFixed(2)} under the baseline (below ${(base.mean - p.drift.dropThreshold).toFixed(2)}).`
      : 'No scored actions from this stream in the ledger yet.';

    const tb = $('#alarms');
    tb.innerHTML = '';
    $('#alarms-empty').hidden = d.alarms.length > 0;
    $('#alarms-wrap').hidden = !d.alarms.length;
    d.alarms.forEach((a) => tb.append(el('tr', {}, [
      el('td', { text: `${a.agentLabel} / ${E.channelLabel(a.channel)}` }),
      el('td', { class: 'num', text: a.date.slice(5) }),
      el('td', { class: 'num neg', text: a.mean.toFixed(2) }),
      el('td', { class: 'num', text: a.baseline.toFixed(2) }),
      el('td', { class: 'hide-sm note', text: a.reason === 'below_threshold' ? 'Below warn line' : `Dropped ${a.drop.toFixed(2)} vs. baseline` }),
    ])));
  };

  /* ---------- render: report ---------- */
  const renderReport = () => {
    const m = S.st.model;
    const host = $('#report');
    host.innerHTML = '';
    if (!m.totals.events) { host.append(el('p', { text: 'The ledger is empty, so there is nothing to report yet.' })); return; }
    const sub = (t) => el('h3', { class: 'group-label mt-md', text: t });
    host.append(
      el('h3', { text: `${m.org} — agent governance weekly digest` }),
      el('p', { class: 'note mt-sm', text: `${m.range.from.slice(0, 10)} → ${m.range.to.slice(0, 10)} · policy ${m.policyVersion} · fixture data` }),
    );
    const head = el('ul', { class: 'findings mt-sm' });
    const text = E.renderDigestText(m).split('\n');
    text.slice(3, text.indexOf('TOP 3') - 1).forEach((l) => head.append(el('li', {}, [el('span', { class: 'f-rule', text: '—' }), el('span', { class: 'f-msg', text: l })])));
    host.append(head);

    host.append(sub('Top 3'));
    const top = el('ul', { class: 'findings' });
    m.topThree.forEach((s, i) => top.append(el('li', {}, [el('span', { class: 'f-rule', text: String(i + 1) }), el('span', { class: 'f-msg', text: s })])));
    host.append(top);

    host.append(sub(`Findings (${m.findings.length})`));
    const ft = el('table', { class: 'tbl' }, [
      el('thead', {}, el('tr', {}, ['Severity', 'Check', 'Agent', 'Why'].map((h, i) => el('th', { scope: 'col', class: i === 2 ? 'hide-sm' : null, text: h })))),
      el('tbody', {}, m.findings.map((f) => el('tr', {}, [
        el('td', {}, [el('span', { class: f.severity === 'high' ? 'tag tag--warn' : 'tag', text: f.severity })]),
        el('td', { text: E.checkTypeLabel(f.checkType) }),
        el('td', { class: 'hide-sm', text: f.agentLabel }),
        el('td', { text: f.rationale }),
      ]))),
    ]);
    host.append(el('div', { class: 'tbl-wrap' }, ft));

    if (m.drift.alarms.length) {
      host.append(sub('Agents off their usual tone'));
      const ul = el('ul', { class: 'findings' });
      m.drift.alarms.forEach((a) => ul.append(el('li', {}, [
        el('span', { class: 'f-rule', text: a.date.slice(5) }),
        el('span', { class: 'f-msg', text: `${a.agentLabel} / ${E.channelLabel(a.channel)}: tone score ${a.mean.toFixed(2)} vs. its usual ${a.baseline.toFixed(2)}` }),
      ])));
      host.append(ul);
    }

    if (m.gate.pending.length) {
      host.append(sub('Blocked or needs review'));
      const ul = el('ul', { class: 'findings' });
      m.gate.pending.forEach((p) => ul.append(el('li', {}, [
        el('span', { class: 'f-rule' }, [el('span', { class: p.decision === 'block' ? 'tag tag--ink' : 'tag', text: DEC[p.decision].label })]),
        el('span', { class: 'f-msg', text: `${p.agentLabel} · ${E.actionTypeLabel(p.actionType)} · ${short(p.subjectRef, 34)}${p.overridden ? ` (override by ${p.overrideActorRole})` : ''}` }),
        el('span', { class: 'f-fix', text: p.reasons.join(' · ') }),
      ])));
      host.append(ul);
    }

    host.append(sub('By agent'));
    host.append(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { scope: 'col', text: 'Agent' }), el('th', { scope: 'col', class: 'hide-sm', text: 'Source' }),
        el('th', { scope: 'col', class: 'num', text: 'Actions' }), el('th', { scope: 'col', class: 'num', text: 'Findings' }),
        el('th', { scope: 'col', class: 'num', text: 'Ceiling' }),
      ])),
      el('tbody', {}, m.agents.map((a) => el('tr', {}, [
        el('td', { text: a.label }), el('td', { class: 'hide-sm', text: E.sourceLabel(a.source) }),
        el('td', { class: 'num', text: a.eventCount }), el('td', { class: 'num', text: a.findingCount }),
        el('td', { class: 'num', text: a.ceiling == null ? 'none' : '$' + a.ceiling }),
      ]))),
    ])));
  };

  const fileBase = () => `agent-governance-digest-${(S.st.model.range.to || 'empty').slice(0, 10)}`;
  $('#dl-md').addEventListener('click', () => L.download(fileBase() + '.md', E.renderDigestMarkdown(S.st.model), 'text/markdown'));
  $('#dl-txt').addEventListener('click', () => L.download(fileBase() + '.txt', E.renderDigestText(S.st.model), 'text/plain'));
  $('#dl-json').addEventListener('click', () => L.download(fileBase() + '.json', JSON.stringify(S.st.model, null, 2) + '\n', 'application/json'));

  /* ---------- main loop ---------- */
  let prevK = null;
  function update() {
    const errs = E.validatePolicy(S.policy);
    $('#policy-err').textContent = errs.join(' ');
    if (errs.length) return;
    S.st = E.run({ rawEvents: EVENTS.slice(0, S.k), policy: S.policy, outcomes: DATA.outcomes, overrides: S.overrides });
    if (S.sel && !S.st.rows.some((r) => r.eventId === S.sel)) S.sel = null;
    const kChanged = prevK !== S.k;
    if (kChanged && S.k > 0 && prevK !== null) {
      const ev = S.st.rows[S.k - 1];
      const eff = S.st.effective.get(ev.eventId);
      $('#last').textContent = `Latest in: ${ev.agentLabel}, ${E.actionTypeLabel(ev.actionType).toLowerCase()} → ${DEC[eff.decision].label.toLowerCase()}.`;
    } else if (S.k === 0) $('#last').textContent = 'Ledger empty.';
    prevK = S.k;
    renderCounts();
    renderTable();
    if (kChanged) followLatest();
    renderDetail();
    renderGate();
    renderDrift();
    renderReport();
  }

  // ≤860px the sidebar renders after every output; move the key controls up beside the results
  const quick = () => {
    const strip = L.$('.lab-quick'); if (!strip) return;
    const items = L.$$('[data-quick]').map((n) => { const m = document.createComment('quick'); n.before(m); return [n, m]; });
    const mq = matchMedia('(max-width: 860px)');
    const place = () => items.forEach(([n, m]) => (mq.matches ? strip.append(n) : m.after(n)));
    mq.addEventListener('change', place); place();
  };

  quick();
  L.tabs($('#detail'));
  buildRules();
  S.sel = 'evt-spend-001';
  update();
})();
