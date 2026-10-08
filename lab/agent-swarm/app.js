// Multi-agent swarm replay. The model turns are recorded (data.js); the governance is recomputed here.
(() => {
  const D = (typeof window !== 'undefined' ? window : globalThis).SWARM_RUN;

  // ---------- governance engine (pure; also loaded by the Node test harness) ----------
  // Port of agent-swarm scripts/next.py (sweep_proposals, activatable) and swarmlib.activated_since,
  // plus the folder moves in scripts/file_result.py (objections, implemented_proposals) and
  // observe/server.py file_human_objection(). runtime/router.py imports these unchanged.
  const Gov = (() => {
    const EV = D.events.map(([ts, role, status, cost, turns, sum], i) => ({ i, ts, role, status, cost, turns, sum }));
    const PROPS = D.props.map(([id, by, at, final]) => ({ id, by, at, final }));
    const key = (role, at) => role + '|' + at;
    const group = (rows, k, v) => rows.reduce((m, r) => (m[k(r)] = (m[k(r)] || []).concat(v(r)), m), {});
    const filedBy = group(PROPS, (p) => key(p.by, p.at), (p) => p.id);
    const objBy = group(D.objs, ([, role, at]) => key(role, at), ([pid]) => pid);
    const implBy = group(D.impl, ([, role, at]) => key(role, at), ([pid]) => pid);
    const others = (p) => D.roles.filter((r) => r !== p.by && r !== D.writeRole);

    // swarmlib.activated_since: any logged turn by `role`, status exactly "ok", with ts strictly after `since`.
    // ISO-8601 UTC strings with microseconds, so string order is time order (as in Python).
    const activatedSince = (log, role, since) => !!since && log.some((e) => e.role === role && e.ts > since && e.status === 'ok');

    // replay(n, injected): folder state after the first n log events.
    // injected: [{ pid, role, pos }] objections written at position pos (after event pos-1 and its sweep).
    const replay = (n, injected = []) => {
      const st = {}, objs = {}, meta = {}, reopened = {}, firstInt = {}, done = {}, warnings = [], changes = [];
      const log = [];
      const move = (pid, to, why, at) => { changes.push({ pid, from: st[pid] || null, to, why, at }); st[pid] = to; };
      const object = (pid, role, at, pos, injectedFlag) => {
        if (st[pid] !== 'open' && st[pid] !== 'integrated') {
          warnings.push({ pos, text: `objection to unknown/already-done proposal '${pid}' dropped` });
          return false;
        }
        (objs[pid] = objs[pid] || []).push({ role, at, injected: injectedFlag, pos });
        // file_result.py: an objection against integrated/ moves the proposal back to open/
        if (st[pid] === 'integrated') { reopened[pid] = true; move(pid, 'open', { kind: 'reopen', role }, at); }
        else changes.push({ pid, from: 'open', to: 'open', why: { kind: 'block', role }, at });
        return true;
      };
      const sweep = (pos) => {
        // next.py sweep_proposals: sorted(open/*.md) == id order
        PROPS.filter((p) => st[p.id] === 'open').forEach((p) => {
          if (objs[p.id] && objs[p.id].length) return; // blocked by a standing objection
          const o = others(p);
          if (o.length && o.every((r) => activatedSince(log, r, p.at))) {
            move(p.id, 'integrated', { kind: 'integrate', roles: o }, log[log.length - 1].ts);
            if (firstInt[p.id] == null) firstInt[p.id] = pos;
          }
        });
      };
      const inject = (pos) => injected.filter((x) => x.pos === pos).forEach((x) => {
        x.applied = object(x.pid, x.role, null, pos, true);
      });
      inject(0);
      for (let k = 0; k < n; k++) {
        const e = EV[k], pos = k + 1, kk = key(e.role, e.ts);
        changes.length = 0;
        if (e.status !== 'error') {
          (filedBy[kk] || []).forEach((pid) => { meta[pid] = PROPS.find((p) => p.id === pid); move(pid, 'open', { kind: 'filed', role: e.role }, e.ts); });
          (objBy[kk] || []).forEach((pid) => object(pid, e.role, e.ts, pos, false));
          (implBy[kk] || []).forEach((pid) => {
            if (st[pid] === 'integrated') { move(pid, 'done', { kind: 'done', role: e.role }, e.ts); done[pid] = pos; }
            else warnings.push({ pos, text: `marked unknown/non-integrated proposal '${pid}' as implemented` });
          });
        }
        log.push(e);
        sweep(pos);
        inject(pos);
      }
      return { n, st, objs, meta, reopened, firstInt, done, warnings, changes: n ? changes : [], log };
    };

    // next.py activatable(), minus the unread-mail trigger (see page note).
    const activatable = (r) => {
      const out = {};
      D.roles.forEach((role) => {
        const reasons = [];
        if (role === D.writeRole) {
          const pending = Object.keys(r.st).sort().filter((pid) => r.st[pid] === 'integrated' && (!D.writeRoleTriggers || D.writeRoleTriggers.includes(r.meta[pid].by)));
          if (pending.length) reasons.push(`ready to implement: ${pending.join(', ')}`);
        } else {
          Object.keys(r.st).sort().forEach((pid) => {
            const p = r.meta[pid];
            if (r.st[pid] !== 'open' || p.by === role) return;
            if (!activatedSince(r.log, role, p.at)) reasons.push(`objection window: ${pid} awaiting your pass`);
          });
        }
        if (reasons.length) out[role] = reasons;
      });
      return out;
    };

    const owes = (r, pid) => others(r.meta[pid]).filter((role) => !activatedSince(r.log, role, r.meta[pid].at));

    return { EV, PROPS, replay, activatable, owes, activatedSince, others };
  })();

  // ---------- minimal JSON Schema check (the subset contract.schema.json uses) ----------
  const validate = (schema, v, path = '$', errs = []) => {
    const types = [].concat(schema.type || []);
    const typeOf = (x) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x);
    if (types.length && !types.includes(typeOf(v))) { errs.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(v)}`); return errs; }
    if (typeOf(v) === 'object') {
      (schema.required || []).forEach((k) => { if (!(k in v)) errs.push(`${path}: missing required property '${k}'`); });
      Object.keys(v).forEach((k) => {
        if (schema.properties && schema.properties[k]) validate(schema.properties[k], v[k], `${path}.${k}`, errs);
        else if (schema.additionalProperties === false) errs.push(`${path}: additional property '${k}' not allowed`);
      });
    }
    if (typeOf(v) === 'array' && schema.items) v.forEach((x, i) => validate(schema.items, x, `${path}[${i}]`, errs));
    return errs;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { Gov, validate };
  if (typeof document === 'undefined') return;

  // ---------- page ----------
  const L = window.Lab;
  const { el, svgEl, fmt } = L;
  const N = D.window;
  const hhmmss = (ts) => ts.slice(11, 19);
  const mins = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;
  const dur = (m) => (m == null ? '–' : m < 60 ? fmt.num(m, 1) + ' min' : fmt.num(m / 60, 1) + ' h');
  const usd = (x, d = 2) => (Number.isFinite(x) ? '$' + x.toFixed(d) : '–');
  // .code is white-space: pre; break long lines for display so panels don't need sideways scrolling
  const wrap = (s, w = 72) => s.split('\n').map((line) => {
    if (line.length <= w) return line;
    const lead = (line.match(/^\s*/) || [''])[0], ind = lead ? lead + '  ' : '', out = [];
    let cur = '';
    line.split(' ').forEach((word) => {
      if (cur && (cur + ' ' + word).length > w) { out.push(cur); cur = ind + word; } else cur = cur ? cur + ' ' + word : word;
    });
    return out.concat(cur).join('\n');
  }).join('\n');
  // long paths/identifiers get zero-width break points so they wrap at 375px instead of overflowing
  const breakable = (t) => t.replace(/\S{24,}/g, (w) => w.replace(/([/._,:-])/g, '$1\u200B'));
  const joinAnd = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  // ---------- 01 diagrams ----------
  const canvas = (host, w, h) => {
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' }, host);
    const defs = svgEl('defs', {}, svg);
    const pre = host.id + '-';
    [['ah', 'd-arrow'], ['ah-acc', 'd-arrow--accent']].forEach(([id, cls]) => {
      const m = svgEl('marker', { id: pre + id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      svgEl('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, m);
    });
    const text = (x, y, s, cls, anchor = 'start', rot) => {
      svgEl('text', { x, y, class: cls, 'text-anchor': anchor, transform: rot ? `rotate(${rot} ${x} ${y})` : null }, svg).textContent = s;
    };
    const box = (x, y, w2, h2, title, subs, cls = 'd-box', lh = 15) => {
      svgEl('rect', { x, y, width: w2, height: h2, class: cls }, svg);
      text(x + 12, y + 22, title, 'd-title');
      subs.forEach((t, i) => text(x + 12, y + 22 + lh + 4 + i * lh, t, 'd-sub'));
    };
    const edge = (d, cls = 'd-edge', both = false) => {
      const m = `url(#${pre}${cls === 'd-edge--accent' ? 'ah-acc' : 'ah'})`;
      svgEl('path', { d, class: cls, 'marker-end': m, 'marker-start': both ? m : null }, svg);
    };
    return { svg, text, box, edge };
  };

  // Phones get a stacked column: nodes top to bottom, links in the left gutter, loops up the right edge.
  // nodes: [{ t, subs, cls }]; links[i] joins node i and i+1: { label, dir: 'down'|'up', cls }
  // loops: [{ from, to, label, cls, lane }] drawn on the right, arrow ending at `to`.
  const stacked = (host, nodes, links, loops = []) => {
    const W = 320, BW = 270, GAP = 46, LH = 18;
    const hs = nodes.map((n) => 34 + n.subs.length * LH);
    const ys = hs.reduce((a, h, i) => a.concat(i ? a[i - 1] + hs[i - 1] + GAP : 4), []);
    const H = ys[ys.length - 1] + hs[hs.length - 1] + 4;
    const c = canvas(host, W, H);
    nodes.forEach((n, i) => c.box(4, ys[i], BW, hs[i], n.t, n.subs, n.cls || 'd-box', LH));
    links.forEach((l, i) => {
      const y0 = ys[i] + hs[i], y1 = ys[i + 1];
      c.edge(l.dir === 'up' ? `M36,${y1 - 1} L36,${y0 + 3}` : `M36,${y0 + 1} L36,${y1 - 3}`, l.cls || 'd-edge');
      c.text(48, (y0 + y1) / 2 + 5, l.label, 'd-label');
    });
    loops.forEach((l) => {
      const x = BW + 4 + (l.lane || 18);
      const ya = ys[l.from] + hs[l.from] / 2, yb = ys[l.to] + hs[l.to] / 2;
      c.edge(`M${BW + 4},${ya} L${x},${ya} L${x},${yb} L${BW + 7},${yb}`, l.cls || 'd-edge');
      c.text(x + 13, (ya + yb) / 2, l.label, 'd-label', 'middle', -90);
    });
  };

  // System context first: five boxes, every arrow a verb.
  const drawContext = () => {
    const c = canvas(document.getElementById('ctx'), 960, 260);
    c.box(20, 16, 150, 64, 'Human', ['optional', 'dashboard Reject'], 'd-box--soft');
    c.box(330, 16, 260, 64, 'Router', ['picks who acts next', 'pure function, no model call'], 'd-box--accent');
    c.box(20, 170, 200, 74, 'Run directory', ['mail · proposals', 'objections · log']);
    c.box(400, 170, 220, 74, 'Roles', ['4 × claude -p per turn', 'only engineer can write']);
    c.box(720, 170, 220, 74, 'Target repo', ['code changes land here']);
    c.edge('M60,80 L60,167', 'd-edge--dash');
    c.text(68, 128, 'files objections', 'd-label');
    c.edge('M200,168 L200,48 L327,48');
    c.text(208, 112, 'reads files + log', 'd-label');
    c.edge('M480,80 L480,167', 'd-edge--accent');
    c.text(488, 128, 'starts eligible roles', 'd-label');
    c.edge('M400,196 L223,196');
    c.text(310, 188, 'writes results', 'd-label', 'middle');
    c.edge('M220,222 L397,222');
    c.text(310, 238, 'reads inbox', 'd-label', 'middle');
    c.edge('M620,207 L717,207');
    c.text(669, 199, 'engineer edits', 'd-label', 'middle');

    stacked(document.getElementById('ctx-m'), [
      { t: 'Human', subs: ['optional, dashboard Reject'], cls: 'd-box--soft' },
      { t: 'Run directory', subs: ['mail · proposals', 'objections · log'] },
      { t: 'Router', subs: ['picks who acts next', 'pure function, no model call'], cls: 'd-box--accent' },
      { t: 'Roles', subs: ['4 × claude -p per turn', 'only engineer can write'] },
      { t: 'Target repo', subs: ['code changes land here'] },
    ], [
      { label: 'files objections', cls: 'd-edge--dash' },
      { label: 'router reads files + log' },
      { label: 'starts eligible roles', cls: 'd-edge--accent' },
      { label: 'engineer edits' },
    ], [{ from: 3, to: 1, label: 'write results, read inbox' }]);
  };

  const drawDiagram = () => {
    const c = canvas(document.getElementById('diagram'), 960, 500);
    const { text, box, edge } = c;

    // roles (from the pack)
    svgEl('rect', { x: 290, y: 8, width: 662, height: 112, class: 'd-group' }, c.svg);
    text(300, 24, 'pack: governance-pivot  (index.tsv + config.json)', 'd-label');
    const cfg = D.roleConfig;
    const roleSub = { research: ['web + read tools', 'budget $' + cfg.research.budget_usd], architect: ['read-only tools', 'files proposals'], critic: ['read-only tools', 'files objections'], engineer: ['only write role', 'Write, Edit, Bash'] };
    D.roles.forEach((r, i) => box(300 + i * 163, 34, 150, 74, r, roleSub[r]));

    // router
    box(16, 34, 234, 150, 'Router', ['LangGraph StateGraph', 'route() imports next.py:', 'sweep_proposals()', 'activatable()', 'Send → every eligible role', 'no model call, no human'], 'd-box--accent');
    edge('M250,70 L292,70', 'd-edge--accent');
    text(256, 62, 'starts', 'd-label');

    // turn + schema gate
    box(300, 160, 290, 74, 'claude -p, one per turn', ['tools scoped per role (--restricted,', 'except research) · budget · model']);
    box(640, 160, 312, 74, 'Schema gate', ['--json-schema contract.schema.json', 'structured_output or error']);
    edge('M455,120 L455,158');
    text(463, 144, 'sends bundle: objective, charter, inbox', 'd-label');
    edge('M590,197 L638,197');
    text(614, 189, 'returns', 'd-label', 'middle');
    edge('M800,234 L800,284');
    text(792, 262, 'file_result.py writes + logs', 'd-label', 'end');

    // run directory
    svgEl('rect', { x: 290, y: 286, width: 662, height: 110, class: 'd-group' }, c.svg);
    text(300, 302, 'run directory (the only state)', 'd-label');
    box(300, 312, 150, 74, 'log/', ['events.ndjson', 'append-only']);
    box(463, 312, 150, 74, 'mailbox/', ['inbox → consumed'], 'd-box--soft');
    box(626, 312, 150, 74, 'proposals/', ['open · integrated', 'done · objections'], 'd-box--soft');
    box(789, 312, 150, 74, 'tensions/', ['open · resolved'], 'd-box--soft');

    edge('M300,349 L133,349 L133,186', 'd-edge--accent');
    text(142, 340, 'router reads files + log', 'd-label');

    // observability
    box(16, 420, 234, 66, 'observe/ + evals', ['cost per role, objection matrix', 'proposal lifecycle'], 'd-box--soft');
    edge('M375,386 L375,453 L252,453', 'd-edge--dash');
    text(262, 446, 'reads log', 'd-label');

    stacked(document.getElementById('diagram-m'), [
      { t: 'Router', subs: ['LangGraph StateGraph', 'route() imports next.py', 'no model call, no human'], cls: 'd-box--accent' },
      { t: 'Roles from the pack', subs: ['research · architect · critic', 'engineer (only write role)'] },
      { t: 'claude -p, one per turn', subs: ['tools scoped per role', 'budget + model per role'] },
      { t: 'Schema gate', subs: ['--json-schema contract', 'structured_output or error'] },
      { t: 'Run directory', subs: ['log/events.ndjson, append-only', 'mailbox/ · proposals/', 'tensions/'] },
      { t: 'observe/ + evals', subs: ['cost per role, objections', 'proposal lifecycle'], cls: 'd-box--soft' },
    ], [
      { label: 'starts every eligible role', cls: 'd-edge--accent' },
      { label: 'sends bundle: charter, inbox' },
      { label: 'returns JSON' },
      { label: 'file_result.py writes + logs' },
      { label: 'observe reads the log', cls: 'd-edge--dash' },
    ], [{ from: 4, to: 0, label: 'router reads files + log', cls: 'd-edge--accent' }]);
  };

  // ---------- 02 simulator ----------
  const pos = document.getElementById('pos');
  pos.max = N;
  const injected = [];
  // open on the turn block 03 walks through: critic's objection reopens the already-integrated P001
  const START = D.sample.event + 1;
  let cur = START, timer = null;

  const tl = document.getElementById('tl');
  const effectsOf = (k) => {
    // what this event did, as recorded in the run's files
    const e = Gov.EV[k], bits = [];
    Gov.PROPS.filter((p) => p.by === e.role && p.at === e.ts).forEach((p) => bits.push('files ' + p.id));
    D.objs.filter(([, role, at]) => role === e.role && at === e.ts).forEach(([pid]) => bits.push('objects to ' + pid));
    D.impl.filter(([, role, at]) => role === e.role && at === e.ts).forEach(([pid]) => bits.push('lists ' + pid + ' as implemented'));
    return bits;
  };
  const rows = Gov.EV.slice(0, N).map((e, k) => {
    const fx = effectsOf(k);
    const body = el('div', {}, [
      fx.length || e.status !== 'ok' ? el('p', {}, [
        e.status !== 'ok' ? el('span', { class: 'tag tag--warn', text: e.status }) : null,
        e.status !== 'ok' && fx.length ? ' ' : null,
        fx.length ? el('b', { text: fx.join(' · ') }) : null,
      ]) : null,
      el('span', { text: breakable(e.sum || '') }),
    ]);
    const li = el('li', {}, [el('span', { class: 't', text: hhmmss(e.ts) }), el('span', { class: 'who', text: e.role }), body]);
    tl.append(li);
    return li;
  });

  const stateTag = (r, pid) => {
    const s = r.st[pid], blocked = s === 'open' && r.objs[pid] && r.objs[pid].length;
    if (s === 'done') return el('span', { class: 'tag tag--ink', text: 'done' });
    if (s === 'integrated') return el('span', { class: 'tag tag--ok', text: 'integrated' });
    if (blocked) return el('span', { class: 'tag tag--warn', text: 'blocked', title: r.reopened[pid] ? 'Reopened: objected to after it had integrated' : null });
    return el('span', { class: 'tag', text: 'objection window' });
  };

  const explain = (r) => {
    if (!r.n) return ['Start', 'Nothing has run yet. The objective sits in architect\'s inbox, so architect is the only role with a reason to act.'];
    const e = Gov.EV[r.n - 1];
    const lines = [];
    let head = null;
    r.changes.forEach((c) => {
      const p = r.meta[c.pid];
      if (c.why.kind === 'filed') { head = head || `${c.pid} filed`; lines.push(`${p.by} filed ${c.pid}. It integrates once ${joinAnd(Gov.others(p))} each finish an ok turn after ${hhmmss(p.at)}, with no objection on file.`); }
      if (c.why.kind === 'integrate') { head = `${c.pid} integrated`; lines.push(`${joinAnd(c.why.roles)} have all finished an ok turn since ${c.pid} was filed at ${hhmmss(p.at)}, and no objection is on file. Moved to integrated/. engineer can now pick it up.`); }
      if (c.why.kind === 'reopen') { head = `${c.pid} reopened`; lines.push(`${c.why.role} objected while ${c.pid} was integrated, so it moved back to open/. It stays blocked while the objection stands.`); }
      if (c.why.kind === 'block') { head = head || `${c.pid} blocked`; lines.push(`${c.why.role} objected to ${c.pid} while it was open. It cannot integrate while the objection stands.`); }
      if (c.why.kind === 'done') { head = `${c.pid} done`; lines.push(`engineer listed ${c.pid} in implemented_proposals while it was integrated. Moved to done/.`); }
    });
    if (!lines.length) lines.push(`${e.role} finished a turn (${e.status}). No proposal changed state.`);
    return [head || 'No change', lines.join(' ')];
  };

  const injSel = document.getElementById('inj-pid');
  const injRole = document.getElementById('inj-role');
  ['human', ...D.roles].forEach((r) => injRole.append(el('option', { value: r, text: r })));
  const injMsg = document.getElementById('inj-msg');
  const injList = document.getElementById('inj-list');

  const render = () => {
    const r = Gov.replay(cur, injected);
    pos.value = cur;
    document.getElementById('pos-out').textContent = `${cur} / ${N}`;
    const [v, why] = explain(r);
    const vEl = document.getElementById('verdict-v');
    vEl.textContent = v;
    vEl.classList.toggle('is-warn', /blocked|reopened/.test(v));
    document.getElementById('verdict-why').textContent = (cur ? `Event ${cur}, ${hhmmss(Gov.EV[cur - 1].ts)} UTC. ` : '') + why;
    const w = r.warnings.filter((x) => x.pos === cur);
    document.getElementById('warn-line').textContent = w.length ? 'file_result.py warning: ' + w.map((x) => x.text).join('; ') : '';

    const body = document.getElementById('state-body');
    body.innerHTML = '';
    const ids = Object.keys(r.st).sort();
    if (!ids.length) body.append(el('tr', {}, el('td', { colspan: 5, text: 'No proposals filed yet.' })));
    ids.forEach((pid) => {
      const o = r.objs[pid] || [];
      const owe = r.st[pid] === 'open' ? Gov.owes(r, pid) : [];
      const objTxt = o.length ? Object.entries(o.reduce((m, x) => (m[x.role + (x.injected ? ' (yours)' : '')] = (m[x.role + (x.injected ? ' (yours)' : '')] || 0) + 1, m), {})).map(([k, c]) => `${k} ×${c}`).join(', ') : '–';
      body.append(el('tr', {}, [
        el('td', {}, el('b', { text: pid })),
        el('td', { class: 'hide-sm', text: r.meta[pid].by }),
        el('td', {}, stateTag(r, pid)),
        el('td', { text: r.st[pid] === 'open' ? (owe.length ? owe.join(', ') : 'nobody') : '–' }),
        el('td', { text: objTxt }),
      ]));
    });

    const act = Gov.activatable(r);
    const dl = document.getElementById('eligible');
    dl.innerHTML = '';
    D.roles.forEach((role) => {
      dl.append(el('dt', { text: role }), el('dd', { text: act[role] ? act[role].join('; ') : (role === 'architect' && cur === 0 ? 'unread mail: 1 message (the objective)' : 'no governance trigger') }));
    });

    rows.forEach((li, k) => {
      li.classList.toggle('is-now', k === cur - 1);
      li.classList.toggle('is-future', k >= cur);
      if (k === cur - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    const now = rows[cur - 1];
    if (now) tl.scrollTop = now.offsetTop - tl.offsetTop - tl.clientHeight / 2 + now.clientHeight / 2;
    else tl.scrollTop = 0;

    const live = ids.filter((pid) => r.st[pid] === 'open' || r.st[pid] === 'integrated');
    const prev = injSel.value;
    injSel.innerHTML = '';
    live.forEach((pid) => injSel.append(el('option', { value: pid, text: `${pid} (${r.st[pid]})` })));
    if (!live.length) injSel.append(el('option', { value: '', text: 'No open or integrated proposal here' }));
    if (live.includes(prev)) injSel.value = prev;
    injSel.disabled = !live.length;
    document.getElementById('inj-add').disabled = !live.length;

    injList.innerHTML = '';
    injected.forEach((x, i) => {
      injList.append(el('li', {}, [
        el('span', { class: 'f-rule', text: 'pos ' + x.pos }),
        el('span', { class: 'f-msg' }, [`${x.role} objects to ${x.pid}`, x.pos > cur ? ' (not reached yet)' : x.applied === false ? ' (dropped: not open or integrated)' : '', ' ',
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Remove ${x.role} objection to ${x.pid}`, onclick: () => { injected.splice(i, 1); injMsg.textContent = 'Objection removed.'; render(); } }, 'Remove')]),
      ]));
    });
  };

  const stop = () => { clearInterval(timer); timer = null; const b = document.getElementById('play'); b.textContent = 'Play'; b.setAttribute('aria-pressed', 'false'); };
  const go = (k) => { cur = L.clamp(k, 0, N); render(); };
  pos.addEventListener('input', () => { stop(); go(+pos.value); });
  document.getElementById('step').addEventListener('click', () => { stop(); go(cur + 1); });
  document.getElementById('reset').addEventListener('click', () => { stop(); go(0); });
  document.getElementById('play').addEventListener('click', (ev) => {
    if (timer) return stop();
    if (cur >= N) cur = 0;
    ev.currentTarget.textContent = 'Pause';
    ev.currentTarget.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => { if (cur >= N) return stop(); go(cur + 1); }, 900);
  });
  document.getElementById('inj-add').addEventListener('click', () => {
    const pid = injSel.value, role = injRole.value;
    if (!pid) return;
    injected.push({ pid, role, pos: cur });
    injMsg.textContent = `Filed: ${role} objects to ${pid} at position ${cur}. Step forward to see what changes.`;
    render();
  });
  document.getElementById('inj-clear').addEventListener('click', () => { injected.length = 0; injMsg.textContent = 'All injected objections removed.'; render(); });

  // ---------- 03 one role turn ----------
  const S = D.sample, se = Gov.EV[S.event];
  document.getElementById('turn-intro').textContent = `Event ${S.event + 1} in the log: critic at ${hhmmss(se.ts)} UTC. Two engineer messages were waiting. critic read the diff, found that it breaks exact-count tests, and objected to P001 while P001 was integrated. That objection is what reopens P001 in the simulator above.`;
  document.getElementById('in-note').textContent = `The full input bundle was ${fmt.num(S.bundleBytes / 1024, 1)} KB: run objective, critic's charter, the board snapshot, these unread messages and the output contract. Only the inbox part is shown.`;
  const inMsgs = document.getElementById('in-msgs');
  const inPres = S.inbox.map((m) => {
    const pre = el('pre', { class: 'code mt-sm' });
    inMsgs.append(el('h3', { class: 'group-label', text: m.name }), pre);
    return [pre, `from: ${m.from}\nto: critic\nat: ${m.at}\n\n${m.body}`];
  });
  const outPre = document.getElementById('out-json');
  // chars per line from the panel width (Space Mono 12px is about 7.3px a character)
  const fill = () => {
    const w = Math.max(34, Math.min(88, Math.floor((document.getElementById('b-turn').clientWidth - 32) / 7.3)));
    inPres.forEach(([pre, t]) => { pre.textContent = wrap(t, w); });
    outPre.textContent = wrap(JSON.stringify(S.output, null, 2), w);
  };
  fill();
  window.addEventListener('resize', L.debounce(fill, 150));

  const rc = D.roleConfig.critic;
  document.getElementById('cfg-json').textContent = '"critic": ' + JSON.stringify(rc, null, 1).replace(/\n\s*/g, ' ');
  document.getElementById('cfg-charter').textContent = [
    '## Authority',
    '',
    'No target-repo write access. You file tensions and objections.',
    '',
    'Object only on a hard criterion — everything else is a note, not a veto.',
    'Hard criteria: a factual/citation claim you cannot verify against a real',
    'source or the actual code, a HARDSTOPS.md violation, [...] or code that',
    "doesn't match its milestone's actual spec, doesn't pass `npm run verify`,",
    "or reaches into a later milestone's scope.",
  ].join('\n');
  document.getElementById('cfg-cmd').textContent = [
    'claude -p "<bundle>" \\',
    '  --append-system-prompt "<critic.md>" \\',
    `  --restricted --tools "${rc.tools}" --add-dir <target-repo> \\`,
    '  --json-schema "<contract.schema.json>" --output-format json \\',
    `  --max-budget-usd ${rc.budget_usd} --model ${rc.model}`,
  ].join('\n');

  const env = S.envelope;
  const envDl = document.getElementById('out-env');
  [['Cost', usd(env.total_cost_usd, 4)], ['Turns', String(env.num_turns)], ['Duration', fmt.num(env.duration_ms / 1000, 0) + ' s'], ['Result', `${env.subtype}, is_error: ${env.is_error}`], ['Permission denials', env.permission_denials.length ? env.permission_denials.length : 'none']]
    .forEach(([k, v]) => envDl.append(el('dt', { text: k }), el('dd', { text: v })));

  // file_result.py's checks, against the folder state at the moment this turn was filed
  const before = Gov.replay(S.event, []);
  const fileCheck = (out) => {
    const res = [];
    if (out.role !== se.role) return [{ bad: true, rule: 'file_result.py', msg: `role mismatch (activated ${se.role}, output says ${out.role})`, fix: 'ValueError. Logged as status "error"; nothing is filed.' }];
    (out.objections || []).forEach((o) => {
      const s = before.st[o.proposal_id];
      if (s === 'open' || s === 'integrated') res.push({ bad: false, rule: 'file_result.py', msg: `Objection to ${o.proposal_id} filed. It was ${s}${s === 'integrated' ? ', so it moves back to open/' : ''}. Filer ${before.meta[o.proposal_id].by} gets a notification in its inbox.`, fix: null });
      else res.push({ bad: true, rule: 'file_result.py', msg: `objection to unknown/already-done proposal '${o.proposal_id}' dropped`, fix: 'Status becomes "ok_with_warnings". The rest of the turn is still filed.' });
    });
    res.push({ bad: false, rule: 'file_result.py', msg: `Inbox archived: ${S.inbox.length} messages moved to consumed/. One line appended to events.ndjson.`, fix: null });
    return res;
  };
  const mutate = (kind) => {
    const o = JSON.parse(JSON.stringify(S.output));
    if (kind === 'extra') o.priority = 'high';
    if (kind === 'nosum') delete o.log_summary;
    if (kind === 'noreason') delete o.objections[0].reason;
    if (kind === 'role') o.role = 'architect';
    if (kind === 'ghost') o.objections[0].proposal_id = 'P099';
    return o;
  };
  const valList = document.getElementById('val-list');
  const showVal = (kind) => {
    const out = mutate(kind);
    const errs = validate(D.schema, out);
    valList.innerHTML = '';
    const item = (rule, msg, fix, bad) => valList.append(el('li', {}, [
      el('span', { class: 'f-rule', text: rule }),
      el('span', { class: 'f-msg' }, [el('span', { class: bad ? 'tag tag--warn' : 'tag tag--ok', text: bad ? 'fails' : 'passes' }), ' ', msg]),
      fix ? el('span', { class: 'f-fix', text: fix }) : null,
    ]));
    if (errs.length) {
      errs.forEach((x) => item('schema', x, null, true));
      item('runtime/nodes.py', 'no structured_output in result (schema validation may have failed)', 'With --json-schema the CLI enforces the schema itself, so the node never receives this output. Logged as status "error".', true);
      return;
    }
    item('schema', 'Matches contract.schema.json: required fields present, no unknown fields, every type correct.', null, false);
    fileCheck(out).forEach((x) => item(x.rule, x.msg, x.fix, x.bad));
  };
  L.bindSeg(document.getElementById('mut'), showVal);
  showVal('none');

  const rej = document.getElementById('rej-list');
  const full = Gov.replay(Gov.EV.length, []);
  const warnEv = Gov.EV.findIndex((e) => e.status === 'ok_with_warnings');
  const errEv = Gov.EV.findIndex((e) => e.status === 'error');
  const w0 = full.warnings.find((x) => x.pos === warnEv + 1);
  [
    [warnEv, 'ok_with_warnings', w0 ? w0.text : '', 'Two engineer turns both shipped the same milestone. The first moved it to done/. This one listed an id that was no longer in integrated/, so that item was dropped and the turn was logged with a warning.'],
    [errEv, 'error', Gov.EV[errEv].sum, 'The CLI returned a rate-limit error. The node logs it and writes a marker file; the router reads the marker first and ends the run instead of retrying.'],
  ].forEach(([k, status, msg, fix]) => {
    const e = Gov.EV[k];
    rej.append(el('li', {}, [
      el('span', { class: 'f-rule', text: `${e.role} · ${hhmmss(e.ts)}` }),
      el('span', { class: 'f-msg' }, [el('span', { class: 'tag tag--warn', text: status }), ' ', msg]),
      el('span', { class: 'f-fix', text: fix }),
    ]));
  });

  // ---------- 04 observability (full run) ----------
  const EVs = Gov.EV;
  const roleStats = D.roles.map((role) => {
    const es = EVs.filter((e) => e.role === role);
    const cost = L.sum(es.map((e) => e.cost || 0));
    return { role, n: es.length, warn: es.filter((e) => e.status === 'ok_with_warnings').length, err: es.filter((e) => e.status === 'error').length, cost, per: cost / es.filter((e) => e.cost != null).length };
  });
  const totalCost = L.sum(roleStats.map((r) => r.cost));
  const first = EVs[0].ts, last = EVs[EVs.length - 1].ts;
  const gaps = EVs.slice(1).map((e, i) => ({ i: i + 1, m: mins(EVs[i].ts, e.ts) })).sort((a, b) => b.m - a.m)[0];
  const final = full;
  const ids = Gov.PROPS.map((p) => p.id);
  const doneIds = ids.filter((id) => final.st[id] === 'done');
  document.getElementById('obs-intro').textContent = `All ${EVs.length} logged turns of the run, ${hhmmss(first)} to ${hhmmss(last)} UTC. The longest quiet stretch, ${dur(gaps.m)}, follows the rate-limit error: the run stopped and was restarted later. Costs are the CLI's own total_cost_usd per turn.`;
  const stats = document.getElementById('obs-stats');
  const top = [...roleStats].sort((a, b) => b.cost - a.cost)[0];
  document.getElementById('b-obs').textContent = `The ${top.role} role spent ${Math.round((top.cost / totalCost) * 100)}% of the run's ${usd(totalCost, 0)}`;
  [[String(EVs.length), 'Logged turns'], [`${doneIds.length} / ${ids.length}`, 'Proposals done'], [String(D.objs.length), 'Objections filed']]
    .forEach(([n, l]) => stats.append(el('div', { class: 'stat' }, [el('span', { class: 'n', text: n }), el('span', { class: 'l', text: l })])));

  const byCost = [...roleStats].sort((a, b) => b.cost - a.cost);
  L.bars(document.getElementById('c-cost'), {
    labels: byCost.map((r) => r.role),
    groups: [{ values: byCost.map((r) => r.cost), cls: 'b-ink', name: 'Cost' }],
    horizontal: true, labelWidth: 110,
    yfmt: (v) => '$' + v, valueFmt: (v) => usd(v, 2),
    ariaLabel: 'Model cost per role in USD: ' + byCost.map((r) => `${r.role} ${usd(r.cost)}`).join(', '),
  });
  const rb = document.getElementById('role-body');
  roleStats.forEach((r) => rb.append(el('tr', {}, [
    el('td', { text: r.role }), el('td', { class: 'num', text: String(r.n) }), el('td', { class: 'num hide-sm', text: String(r.warn) }),
    el('td', { class: 'num hide-sm', text: String(r.err) }), el('td', { class: 'num', text: usd(r.cost) }), el('td', { class: 'num', text: usd(r.per) }),
  ])));

  // objection matrix: objector × filer of the proposal objected to (same shape as evals/report.py)
  const filer = Object.fromEntries(Gov.PROPS.map((p) => [p.id, p.by]));
  const objectors = [...new Set(D.objs.map((o) => o[1]))].sort();
  const cols = D.roles;
  const cnt = (a, b) => D.objs.filter(([pid, role]) => role === a && filer[pid] === b).length;
  const distinct = (a) => new Set(D.objs.filter((o) => o[1] === a).map((o) => o[0])).size;
  const mt = document.getElementById('matrix');
  mt.append(el('thead', {}, el('tr', {}, [el('th', { scope: 'col', text: 'Objector' }), ...cols.map((c) => el('th', { scope: 'col', class: 'num', text: c })), el('th', { scope: 'col', class: 'num', text: 'Proposals hit' })])));
  mt.append(el('tbody', {}, objectors.map((a) => el('tr', {}, [el('th', { scope: 'row', text: a }), ...cols.map((c) => el('td', { class: 'num', text: cnt(a, c) ? String(cnt(a, c)) : '–' })), el('td', { class: 'num', text: String(distinct(a)) })]))));
  const selfObj = cnt('architect', 'architect');
  document.getElementById('matrix-txt').textContent = `Rows are who objected, columns whose proposal it was. Only architect filed proposals in this run, so every objection lands in one column. ${selfObj} of ${D.objs.length} objections are architect objecting to its own proposals: parallel architect turns filed the same milestone more than once, and later turns objected to the duplicates so that only one could integrate. Objection files are append-only, so repeat objections from later turns pile up on the same proposal.`;

  const lb = document.getElementById('life-body');
  const tInt = [];
  Gov.PROPS.forEach((p) => {
    const ip = final.firstInt[p.id], dp = final.done[p.id];
    const ti = ip != null ? mins(p.at, EVs[ip - 1].ts) : null;
    if (ti != null) tInt.push(ti);
    const s = final.st[p.id];
    lb.append(el('tr', {}, [
      el('td', {}, el('b', { text: p.id })),
      el('td', {}, s === 'done' ? el('span', { class: 'tag tag--ink', text: 'done' }) : el('span', { class: 'tag', text: 'blocked' })),
      el('td', { class: 'num', text: dur(ti) }),
      el('td', { class: 'num', text: dp != null ? dur(mins(p.at, EVs[dp - 1].ts)) : '–' }),
      el('td', { class: 'num hide-sm', text: final.objs[p.id] ? String(final.objs[p.id].length) : '–' }),
    ]));
  });
  const pauseA = EVs[gaps.i - 1].ts, pauseB = EVs[gaps.i].ts;
  const spanned = Gov.PROPS.filter((p) => final.firstInt[p.id] != null && p.at < pauseA && EVs[final.firstInt[p.id] - 1].ts >= pauseB).map((p) => p.id);
  document.getElementById('life-txt').textContent = `Time from filing to integration is computed by running the same rule over the full log. ${tInt.length} of ${ids.length} proposals ever integrated; median wait ${dur(L.quantile(tInt, 0.5))}. The wait is how long it takes for every non-write role to come round once.` + (spanned.length ? ` ${joinAnd(spanned)} was filed just before the pause, so its wait includes it.` : '');
  const match = Gov.PROPS.filter((p) => final.st[p.id] === p.final).length;
  const realWarn = EVs.filter((e) => e.status === 'ok_with_warnings').length;
  document.getElementById('check-line').innerHTML = `<b>Check:</b> replaying the rule over all ${EVs.length} events leaves ${match} of ${ids.length} proposals in the folder the real run left them in, and predicts ${full.warnings.length} "non-integrated proposal" warnings. The log has ${realWarn} turns with warnings; the other ${realWarn - full.warnings.length} was a duplicate-tension skip.`;

  // ≤860px the sidebar renders after every output; move the key controls up beside the results
  const quick = () => {
    const strip = L.$('.lab-quick'); if (!strip) return;
    const items = L.$$('[data-quick]').map((n) => { const m = document.createComment('quick'); n.before(m); return [n, m]; });
    const mq = matchMedia('(max-width: 860px)');
    const place = () => items.forEach(([n, m]) => (mq.matches ? strip.append(n) : m.after(n)));
    mq.addEventListener('change', place); place();
  };

  drawContext();
  drawDiagram();
  quick();
  L.tabs(document.getElementById('b-turn').parentNode);
  render();
})();
