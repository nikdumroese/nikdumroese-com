// Intent-signal lead scorer. Port of a stdlib-only Python scoring module (ICP + capped signal score,
// tier + branch routing), a deterministic copy gate, and a logistic re-weighting loop. All data synthetic.
(() => {
  const L = window.Lab;

  // ================= model (ported) =================
  const SIGNALS = [
    { key: 'segment_pql', label: 'Product PQL', w: 5, src: 'Product telemetry', desc: 'Self-hosted usage composite: invoices, plans, seats, failed payments, months hosted' },
    { key: 'helm_fork', label: 'Helm chart fork', w: 5, src: 'GitHub API', desc: 'Forked the Helm charts (Kubernetes production deploy)' },
    { key: 'github_fork_main', label: 'Main repo fork', w: 4, src: 'GitHub API', desc: 'Forked the main repo' },
    { key: 'inbound_form', label: 'Inbound form', w: 4, src: 'CRM / form', desc: 'Filled the inbound form' },
    { key: 'github_fork_api', label: 'API repo fork', w: 3, src: 'GitHub API', desc: 'Forked the API repo' },
    { key: 'pypi_active', label: 'Python client active', w: 3, src: 'PyPI', desc: 'Python client in active use' },
    { key: 'job_posting', label: 'Billing job post', w: 3, src: 'Job-board APIs', desc: 'Hiring a billing or platform engineer' },
    { key: 'docker_deployed', label: 'Docker image pulled', w: 2, src: 'Docker Hub', desc: 'Pulled the Docker image' },
    { key: 'website_pricing', label: 'Pricing page visit', w: 2, src: 'Visitor ID', desc: 'Visited the pricing page' },
    { key: 'github_star', label: 'GitHub star', w: 1, src: 'GitHub API', desc: 'Starred the main repo' },
  ];
  const SIG = Object.fromEntries(SIGNALS.map((s) => [s.key, s]));
  const SOURCE = { w: Object.fromEntries(SIGNALS.map((s) => [s.key, s.w])), cap: 15, tA: 20, tB: 12, tC: 7, half: 0 };

  const ICP_DIMS = [
    { key: 'billing_complexity', label: 'Billing complexity' },
    { key: 'company_scale', label: 'Company scale' },
    { key: 'funding_growth', label: 'Funding / growth' },
    { key: 'headcount', label: 'Headcount' },
    { key: 'technical_fit', label: 'Technical fit' },
  ];
  const BILLING = { flat: 'flat-rate', subscription: 'subscription', 'usage-based': 'usage-based', hybrid: 'hybrid' };
  const STAGE_NOUN = { 'pre-seed': 'pre-seed team', seed: 'seed-stage team', 'series-a': 'Series A team', 'series-b-plus': 'Series B+ team', bootstrapped: 'bootstrapped team', public: 'public company' };
  const STAGE = { 'pre-seed': 'pre-seed', seed: 'seed', 'series-a': 'Series A', 'series-b-plus': 'Series B+', bootstrapped: 'bootstrapped', public: 'public' };

  const icpParts = (f) => {
    const base = { flat: 1, subscription: 1, 'usage-based': 2, hybrid: 3 }[f.billing_model];
    const extra = [f.multi_currency && 'multi-currency', f.multi_product && 'multi-product', f.enterprise_contracts && 'enterprise contracts'].filter(Boolean);
    const bc = extra.length ? Math.min(base + 1, 3) : base;
    const hc = f.headcount;
    const scale = hc >= 200 ? 3 : hc >= 20 ? 2 : hc >= 1 ? 1 : 0;
    const stage = { 'pre-seed': 0, bootstrapped: 1, seed: 1, 'series-a': 2, 'series-b-plus': 3, public: 3 }[f.funding_stage];
    const fund = f.funding_total_m >= 50 ? Math.max(stage, 3) : stage;
    const head = hc >= 100 ? 3 : hc >= 10 ? 2 : hc >= 1 ? 1 : 0;
    const tech = f.api_first && f.high_event_volume ? 3 : f.api_first ? 2 : 1;
    return [
      { key: 'billing_complexity', pts: bc, rule: `${BILLING[f.billing_model]} = ${base}` + (extra.length ? `, +1 for ${extra.join(', ')} (max 3)` : '') },
      { key: 'company_scale', pts: scale, rule: `${hc} people: 200+ = 3, 20+ = 2, 1+ = 1` },
      { key: 'funding_growth', pts: fund, rule: `${STAGE[f.funding_stage]} = ${stage}` + (f.funding_total_m >= 50 ? `, raised $${f.funding_total_m}M (50M+ floors at 3)` : '') },
      { key: 'headcount', pts: head, rule: `${hc} people: 100+ = 3, 10+ = 2, 1+ = 1` },
      { key: 'technical_fit', pts: tech, rule: f.api_first ? (f.high_event_volume ? 'API-first and 1M+ events a month' : 'API-first, under 1M events a month') : 'Not API-first' },
    ];
  };

  // Five product triggers, each mapped to a feature gap. Mirrors segment_pql_composite().
  const pqlParts = (s) => {
    const p = [];
    const inv = s.invoices_30d, cx = s.plans + s.metrics;
    if (inv >= 20) p.push([`${inv} invoices in 30d`, inv >= 200 ? 3 : inv >= 50 ? 2 : 1]);
    if (cx >= 2) p.push([`${cx} plans + metrics`, cx >= 8 ? 3 : cx >= 4 ? 2 : 1]);
    if (s.seats >= 2) p.push([`${s.seats} seats`, s.seats >= 3 ? 2 : 1]);
    if (s.payment_failed) p.push(['failed payment', 2]);
    if (s.hosting_months >= 2) p.push([`${s.hosting_months} months hosted`, s.hosting_months >= 6 ? 2 : 1]);
    return p;
  };
  const pqlComposite = (s) => Math.min(15, L.sum(pqlParts(s).map((x) => x[1])));

  const firedFlags = (s) => ({
    segment_pql: pqlComposite(s) > 0,
    helm_fork: s.helm, github_fork_main: s.fork_main, inbound_form: s.inbound, github_fork_api: s.fork_api,
    pypi_active: s.pypi, job_posting: s.job, docker_deployed: s.docker, website_pricing: s.pricing, github_star: s.star,
  });

  const assignBranch = (s) => {
    if (s.invoices_30d >= 50) return { b: 'A', name: 'Upgrade', rule: `Product PQL confirmed: ${s.invoices_30d} invoices in 30 days (rule: 50+). Routes to the upgrade sequence: managed cloud vs self-hosted economics.` };
    const hit = [s.fork_main && 'main repo fork', s.helm && 'Helm chart fork', s.fork_api && 'API repo fork', s.pypi && 'Python client active'].filter(Boolean);
    if (hit.length) return { b: 'B', name: 'Integrator', rule: `Building with the product: ${hit.join(', ')}. Any fork or Python client routes to the integrator sequence.` };
    return { b: 'C', name: 'Evaluator', rule: 'No PQL, fork or client install. Star, job post, pricing visit or ICP match alone routes to the evaluator sequence.' };
  };

  const scoreAccount = (a, cfg) => {
    const icp = icpParts(a.f);
    const icpScore = L.sum(icp.map((x) => x.pts));
    const fired = firedFlags(a.s);
    const sig = [];
    SIGNALS.forEach((d) => {
      if (!fired[d.key]) return;
      const age = a.s.age[d.key];
      const decay = cfg.half > 0 ? 0.5 ** (age / cfg.half) : 1;
      let base, rule;
      if (d.key === 'segment_pql') {
        const comp = pqlComposite(a.s);
        base = comp * cfg.w.segment_pql / 5;
        rule = `Composite ${comp}: ` + pqlParts(a.s).map(([t, p]) => `${t} +${p}`).join(', ') + (cfg.w.segment_pql !== 5 ? `; × ${cfg.w.segment_pql}/5` : '');
      } else {
        base = cfg.w[d.key];
        rule = `${d.desc}; weight ${base}`;
      }
      if (cfg.half > 0) rule += `; ${age}d old, × ${decay.toFixed(2)}`;
      sig.push({ key: d.key, pts: base * decay, rule, age });
    });
    const raw = L.sum(sig.map((x) => x.pts));
    const signal = Math.min(raw, cfg.cap);
    const total = icpScore + signal;
    const tier = total >= cfg.tA ? 'A' : total >= cfg.tB ? 'B' : total >= cfg.tC ? 'C' : 'none';
    return { a, icp, icpScore, sig, raw, signal, cut: raw - signal, total, tier, branch: tier === 'none' ? null : assignBranch(a.s) };
  };

  // ================= synthetic data =================
  const NAMES = ['Quillmetric', 'Tallyforge', 'Emberlane Data', 'Corvid Metering', 'Halyard Cloud', 'Plinthwork', 'Sablepoint AI', 'Tesselate Labs', 'Wrenfield Systems', 'Kestrel Ledger',
    'Marrowgate', 'Ostline', 'Pellucid Grid', 'Brackenbill', 'Cindral', 'Fennic Robotics', 'Gravelle IO', 'Hollowpine', 'Inkwell Telemetry', 'Juniper Arc',
    'Kilnworks', 'Larchmont Compute', 'Mossgrove', 'Nettlefield', 'Orrery Health', 'Pebblecast', 'Quarrystone', 'Rookery Data', 'Saltmarsh AI', 'Thistlecode',
    'Umberline', 'Vellum Freight', 'Willowmere', 'Yarrowbyte', 'Zephyrine', 'Alderpoint', 'Bramblewire', 'Cobaltine', 'Driftmark', 'Eskerline',
    'Fallowfield Energy', 'Glintmoor', 'Heronsgate Labs', 'Ivorybill', 'Jettison Metrics', 'Kittiwake Pay', 'Lanternfish AI', 'Murmurline', 'Nightjar Infra', 'Oakhollow'];
  const FIRST = ['Ana', 'Ben', 'Chiara', 'Dev', 'Elif', 'Femi', 'Greta', 'Hugo', 'Ines', 'Jonas', 'Kofi', 'Lena', 'Mateo', 'Nadia', 'Omar', 'Priya', 'Rui', 'Sana', 'Tomas', 'Yuki'];
  const INDUSTRY = ['fintech', 'ai', 'devtools', 'data', 'iot', 'infra', 'security', 'martech', 'healthtech', 'logistics'];
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  const genAccount = (r, name) => {
    const hc = Math.round(L.clamp(Math.exp(r.normal(3.7, 1.1)), 3, 2500));
    const stage = hc < 15 ? r.pick(['pre-seed', 'seed', 'seed', 'bootstrapped']) : hc < 60 ? r.pick(['seed', 'series-a', 'series-a', 'bootstrapped']) : hc < 250 ? r.pick(['series-a', 'series-b-plus', 'series-b-plus']) : r.pick(['series-b-plus', 'series-b-plus', 'public']);
    const raised = { 'pre-seed': 1, seed: 3, bootstrapped: 0, 'series-a': 12, 'series-b-plus': 45, public: 150 }[stage];
    const u = r();
    const api = r() < 0.6;
    const f = {
      headcount: hc, funding_stage: stage, funding_total_m: Math.round(raised * Math.exp(r.normal(0, 0.5))),
      billing_model: u < 0.15 ? 'flat' : u < 0.45 ? 'subscription' : u < 0.8 ? 'usage-based' : 'hybrid',
      multi_currency: r() < 0.35, multi_product: r() < 0.3, enterprise_contracts: r() < (hc > 100 ? 0.5 : 0.15),
      api_first: api, high_event_volume: r() < (api ? 0.45 : 0.1), industry: r.pick(INDUSTRY),
    };
    const fit = L.sum(icpParts(f).map((x) => x.pts));
    const e = r.normal(0, 1) + 0.18 * (fit - 9);
    const on = (b) => r() < sigmoid(b + 0.9 * e);
    const hosted = on(-1.4);
    const s = {
      invoices_30d: hosted ? Math.round(Math.exp(r.normal(3.6 + 0.4 * e, 1.2))) : 0,
      plans: hosted ? r.int(1, 6) : 0, metrics: hosted ? r.int(0, 7) : 0, seats: hosted ? r.int(1, 5) : 0,
      payment_failed: hosted && r() < 0.25, hosting_months: hosted ? r.int(1, 14) : 0,
      helm: on(-2.6), fork_main: on(-1.9), fork_api: on(-2.2), pypi: on(-2.0), docker: on(-1.3),
      job: r() < 0.12, pricing: on(-1.2), inbound: on(-2.4), star: on(-0.4),
    };
    s.age = Object.fromEntries(SIGNALS.map((d) => [d.key, r.int(0, 29)]));
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
    return { name, domain: `${slug}.example`, contact: r.pick(FIRST), f, s };
  };

  const live = (() => {
    const r = L.rng(303);
    return NAMES.map((n, i) => ({ id: i, ...genAccount(r, n) }));
  })();

  // Hidden ground truth: related to the hand-set weights, not equal to them. Fresh signals count more.
  const TRUTH = { icp: [0.35, 0.1, 0.2, 0.05, 0.45], sig: { segment_pql: 2.0, helm_fork: 0.4, github_fork_main: 0.3, inbound_form: 1.8, github_fork_api: 0.9, pypi_active: 1.5, job_posting: 0.2, docker_deployed: 1.0, website_pricing: 1.2, github_star: 0 }, b0: -4.6, half: 14 };
  const sigFlags = (s) => {
    const f = firedFlags(s);
    f.segment_pql = s.invoices_30d >= 50;
    return SIGNALS.map((d) => (f[d.key] ? 1 : 0));
  };
  const features = (a) => [...icpParts(a.f).map((x) => x.pts), ...sigFlags(a.s)];
  const FEAT_LABELS = [...ICP_DIMS.map((d) => d.label), ...SIGNALS.map((d) => d.label)];

  const history = (() => {
    const r = L.rng(4242);
    return Array.from({ length: 400 }, (_, i) => {
      const a = genAccount(r, `H${i}`);
      const x = features(a);
      let z = TRUTH.b0 + L.sum(TRUTH.icp.map((w, k) => w * x[k]));
      SIGNALS.forEach((d, k) => { if (x[5 + k]) z += TRUTH.sig[d.key] * 0.5 ** (a.s.age[d.key] / TRUTH.half); });
      a.y = r() < sigmoid(z) ? 1 : 0;
      a.fold = i % 4;
      return a;
    });
  })();

  // ================= learning =================
  const fitLogit = (X, y, lambda, iters = 700, lr = 0.5) => {
    const n = X.length, p = X[0].length;
    const mu = Array.from({ length: p }, (_, j) => L.mean(X.map((r) => r[j])));
    const sd = Array.from({ length: p }, (_, j) => L.sd(X.map((r) => r[j])) || 1);
    const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
    const b = new Array(p).fill(0);
    let b0 = Math.log((L.mean(y) + 1e-6) / (1 - L.mean(y) + 1e-6));
    for (let t = 0; t < iters; t++) {
      const g = new Array(p).fill(0);
      let g0 = 0;
      for (let i = 0; i < n; i++) {
        let z = b0;
        for (let j = 0; j < p; j++) z += b[j] * Z[i][j];
        const e = sigmoid(z) - y[i];
        g0 += e;
        for (let j = 0; j < p; j++) g[j] += e * Z[i][j];
      }
      b0 -= lr * g0 / n;
      for (let j = 0; j < p; j++) b[j] -= lr * (g[j] + lambda * b[j]) / n;
    }
    const raw = b.map((v, j) => v / sd[j]);
    const predict = (x) => sigmoid(b0 + L.sum(x.map((v, j) => b[j] * (v - mu[j]) / sd[j])));
    return { raw, predict };
  };

  // Mann–Whitney AUC with tie handling.
  const auc = (scores, y) => {
    const idx = scores.map((s, i) => i).sort((i, j) => scores[i] - scores[j]);
    const rank = new Array(scores.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
      for (let k = i; k <= j; k++) rank[idx[k]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    const pos = y.filter(Boolean).length, neg = y.length - pos;
    const rs = L.sum(rank.filter((_, i) => y[i]));
    return (rs - pos * (pos + 1) / 2) / (pos * neg);
  };

  const deciles = (scores, y) => {
    const idx = scores.map((s, i) => i).sort((i, j) => scores[j] - scores[i] || i - j);
    const n = idx.length;
    return Array.from({ length: 10 }, (_, d) => {
      const part = idx.slice(Math.round(d * n / 10), Math.round((d + 1) * n / 10));
      return L.mean(part.map((i) => y[i]));
    });
  };

  const learn = (lambda, cfg) => {
    const X = history.map(features), y = history.map((a) => a.y);
    const oof = new Array(history.length);
    let hold;
    for (let k = 0; k < 4; k++) {
      const tr = history.map((a, i) => i).filter((i) => history[i].fold !== k);
      const m = fitLogit(tr.map((i) => X[i]), tr.map((i) => y[i]), lambda);
      history.forEach((a, i) => { if (a.fold === k) oof[i] = m.predict(X[i]); });
      if (k === 0) hold = m;
    }
    const test = history.map((a, i) => i).filter((i) => history[i].fold === 0);
    const ty = test.map((i) => y[i]);
    const srcScore = history.map((a) => scoreAccount(a, SOURCE).total);
    const curScore = history.map((a) => scoreAccount(a, cfg).total);
    return {
      coef: hold.raw,
      aucSrc: auc(test.map((i) => srcScore[i]), ty),
      aucCur: auc(test.map((i) => curScore[i]), ty),
      aucFit: auc(test.map((i) => hold.predict(X[i])), ty),
      nTest: test.length,
      base: L.mean(y),
      liftFit: deciles(oof, y),
      liftSrc: deciles(srcScore, y),
    };
  };

  // Learned flag coefficients → 0–5 integer weights, strongest positive signal = 5.
  const learnedWeights = (coef) => {
    const sc = coef.slice(5);
    const top = Math.max(...sc, 1e-9);
    return Object.fromEntries(SIGNALS.map((d, k) => [d.key, Math.round(L.clamp(5 * sc[k] / top, 0, 5))]));
  };

  // ================= outreach: template + gate =================
  const when = (age) => (age <= 7 ? 'this week' : age <= 14 ? 'last week' : 'this month');

  const draft = (sc) => {
    const { a, branch } = sc;
    if (!branch) return null;
    const s = a.s, f = a.f, org = a.name, bill = BILLING[f.billing_model];
    const hi = `Hi ${a.contact},\n\n`;
    if (branch.b === 'A') {
      const cx = s.plans + s.metrics;
      const pain = s.payment_failed ? 'failed payments need dunning, not manual retries'
        : s.seats >= 3 ? 'more of the team needs access, and per-role permissions start to matter'
          : cx >= 8 ? 'plan and metric sprawl outgrows ad hoc revenue reports'
            : 'invoice email delivery becomes a job of its own';
      return {
        subject: `${s.invoices_30d} invoices a month, self-hosted`,
        body: `${hi}${org} has run the self-hosted edition for ${s.hosting_months} months and issued about ${s.invoices_30d} invoices in the last 30 days.\n\nAt that volume ${pain}. That is the part the managed cloud removes.\n\nWorth 20 minutes?`,
      };
    }
    if (branch.b === 'B') {
      const acts = [['helm_fork', s.helm, 'deployed the Helm charts', 'Helm charts'], ['github_fork_main', s.fork_main, 'forked the main repo', 'main repo'],
        ['github_fork_api', s.fork_api, 'forked the API repo', 'API repo'], ['pypi_active', s.pypi, 'integrated the Python client', 'Python client']]
        .filter((x) => x[1]).sort((x, y) => s.age[x[0]] - s.age[y[0]]);
      const [key, , act, tool] = acts[0];
      return {
        subject: `${org} and the ${tool}`,
        body: `${hi}${org} ${act} ${when(s.age[key])}. Makes sense for a ${bill} business with ${f.headcount} people.\n\nWe help teams like yours run ${bill} billing in production without building the metering layer in-house.\n\nWorth 20 minutes?`,
      };
    }
    const opts = [['job_posting', s.job, 'is hiring for billing infrastructure'], ['inbound_form', s.inbound, 'asked about pricing through the site form'],
      ['segment_pql', s.hosting_months > 0, `has run the self-hosted edition for ${s.hosting_months} months`],
      ['website_pricing', s.pricing, 'looked at pricing ' + when(s.age.website_pricing)], ['docker_deployed', s.docker, 'pulled the Docker image ' + when(s.age.docker_deployed)],
      ['github_star', s.star, 'starred the open-source repo']].filter((x) => x[1]);
    const what = opts.length ? opts[0][2] : `runs ${bill} pricing`;
    return {
      subject: `Billing at ${org}`,
      body: `${hi}${org} ${what}. For a ${STAGE_NOUN[f.funding_stage]} on ${bill} pricing, that usually means invoicing is about to outgrow the spreadsheet.\n\nWe work with teams at that stage to ship pricing changes in days, not quarters. Worth 20 minutes?`,
    };
  };

  const BANNED = /\b(solution|seamless|powerful|robust|cutting-edge|empower|leverage|industry-leading|world-class|innovative|synerg)/gi;
  const WEAK_OPEN = /^(I wanted|Just wanted|I noticed|We noticed|I saw|I came across|I hope this|Following up)/i;
  // Claim patterns → the signals that would justify them. Drives both "cites a signal" and "no false claim".
  const CLAIMS = [
    { re: /self-hosted|\b\d[\d,]*\s+invoices\b/i, ok: ['segment_pql'], what: 'self-hosted usage' },
    { re: /\bhelm\b/i, ok: ['helm_fork'], what: 'Helm deploy' },
    { re: /\bfork(ed|s)?\b/i, ok: ['helm_fork', 'github_fork_main', 'github_fork_api'], what: 'a fork' },
    { re: /\bmain repo\b/i, ok: ['github_fork_main'], what: 'main repo' },
    { re: /\bapi repo\b/i, ok: ['github_fork_api'], what: 'API repo' },
    { re: /python client|\bpypi\b/i, ok: ['pypi_active'], what: 'Python client' },
    { re: /\bdocker\b/i, ok: ['docker_deployed'], what: 'Docker pull' },
    { re: /\bhiring\b|job post/i, ok: ['job_posting'], what: 'hiring' },
    { re: /\bstarred\b/i, ok: ['github_star'], what: 'a star' },
    { re: /pricing page|looked at pricing|visited (the |your )?pricing/i, ok: ['website_pricing'], what: 'pricing visit' },
    { re: /\bform\b|reached out|asked about/i, ok: ['inbound_form'], what: 'inbound form' },
  ];
  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  const sentences = (t) => t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);

  const gate = (subject, body, a) => {
    const out = [];
    const add = (rule, ok, msg, fix) => out.push({ rule, ok, msg, fix: ok ? null : fix });
    const wb = words(body), ws = words(subject);
    add('Word count · body', wb <= 75, `${wb} words (max 75)`, 'Cut a sentence. One idea, one ask.');
    add('Word count · subject', ws <= 8, `${ws} words (max 8)`, 'Shorten the subject to the signal.');
    const banned = [...new Set(((subject + ' ' + body).match(BANNED) || []).map((m) => m.toLowerCase()))];
    add('Banned vocabulary', !banned.length, banned.length ? `Found: ${banned.join(', ')}` : 'None found', 'Replace with the specific thing it does.');
    const hasOrg = body.toLowerCase().includes(a.name.toLowerCase());
    add('Company named', hasOrg, hasOrg ? `"${a.name}" appears in the body` : `"${a.name}" missing from the body`, 'Name the company.');
    const fired = firedFlags(a.s);
    const hits = CLAIMS.filter((c) => c.re.test(body));
    const real = hits.filter((c) => c.ok.some((k) => fired[k]));
    const fake = hits.filter((c) => !c.ok.some((k) => fired[k]));
    add('Cites a real signal', real.length > 0, real.length ? `Cites ${real.map((c) => c.what).join(', ')}` : 'No fired signal referenced', 'Reference what the account actually did. No signal, no send.');
    add('No unbacked claim (added here)', !fake.length, fake.length ? `Claims ${fake.map((c) => c.what).join(', ')}, which did not fire` : 'Every claim maps to a fired signal', 'Remove claims the signal table cannot back.');
    const opener = sentences(body.replace(/^\s*(hi|hello|hey)\b[^\n]*\n+/i, ''))[0] || '';
    add('Opening sentence', !WEAK_OPEN.test(opener), WEAK_OPEN.test(opener) ? `Opens with "${opener.match(WEAK_OPEN)[0]}"` : 'Starts with the point', 'Delete the first clause and start with the signal.');
    const ss = sentences(body), last = ss[ss.length - 1] || '', q = (body.match(/\?/g) || []).length;
    add('Single ask, ends on a question', /\?\s*$/.test(last) && q === 1, q === 1 && /\?\s*$/.test(last) ? 'One question, at the end' : `${q} question mark${q === 1 ? '' : 's'}; last sentence ${/\?/.test(last) ? 'is' : 'is not'} a question`, 'End on one question, e.g. "Worth 20 minutes?"');
    return { rules: out, pass: out.every((r) => r.ok), words: wb };
  };

  if (!window.document) {
    window.LeadScorer = { SIGNALS, SOURCE, live, history, scoreAccount, pqlComposite, icpParts, assignBranch, features, fitLogit, auc, deciles, learn, learnedWeights, draft, gate, TRUTH };
    return;
  }

  // ================= UI =================
  const { $, el, fmt } = L;
  const pts = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(1));
  const TIER_CLS = { A: 'tag tag--stop', B: 'tag tag--ink', C: 'tag tag--ok', none: 'tag' };
  const tierLabel = (t) => (t === 'none' ? 'None' : t);

  // weight sliders
  const wHost = $('#weights');
  SIGNALS.forEach((d) => {
    wHost.append(el('div', { class: 'field' }, [
      el('div', { class: 'field__top' }, [el('label', { for: `w-${d.key}`, text: d.label }), el('output', { for: `w-${d.key}` })]),
      el('input', { type: 'range', id: `w-${d.key}`, min: 0, max: 5, step: 1, value: d.w }),
      d.key === 'segment_pql' ? el('p', { class: 'hint', text: 'Scales the 0–12 usage composite. 5 = composite as-is.' }) : null,
    ]));
  });

  const ids = [...SIGNALS.map((d) => `w-${d.key}`), 'cap', 'tA', 'tB', 'tC', 'half'];
  const getCfg = () => ({
    w: Object.fromEntries(SIGNALS.map((d) => [d.key, +$(`#w-${d.key}`).value])),
    cap: +$('#cap').value, tA: +$('#tA').value, tB: +$('#tB').value, tC: +$('#tC').value, half: +$('#half').value,
  });
  const setVal = (id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input')); };

  let state = { sel: null, sort: 'total', all: false, edited: false, draftFor: null, learned: null };
  let cfg = getCfg(), scored = [];

  const keepOrder = (id) => {
    const c = getCfg();
    if (id === 'tA' && c.tB >= c.tA) setVal('tB', c.tA - 1);
    if ((id === 'tA' || id === 'tB') && getCfg().tC >= getCfg().tB) setVal('tC', getCfg().tB - 1);
    if (id === 'tC' && c.tB <= c.tC) setVal('tB', c.tC + 1);
    if ((id === 'tC' || id === 'tB') && getCfg().tA <= getCfg().tB) setVal('tA', getCfg().tB + 1);
  };

  ids.forEach((id) => L.bindRange(id, id === 'half' ? (v) => (v ? `${v} days` : 'Off') : null, () => { keepOrder(id); update(); }));

  const cfgNote = () => {
    const diffs = [];
    SIGNALS.forEach((d) => { if (cfg.w[d.key] !== d.w) diffs.push(`${d.label} ${d.w}→${cfg.w[d.key]}`); });
    ['cap', 'tA', 'tB', 'tC', 'half'].forEach((k) => { if (cfg[k] !== SOURCE[k]) diffs.push(`${k === 'half' ? 'half-life' : k} ${SOURCE[k]}→${cfg[k]}`); });
    $('#cfg-note').textContent = diffs.length ? `Changed from source: ${diffs.join(' · ')}` : 'Source model settings.';
  };

  const renderTable = () => {
    const key = state.sort === 'icp' ? 'icpScore' : state.sort;
    const rows = [...scored].sort((x, y) => y[key] - x[key] || y.total - x.total || x.a.name.localeCompare(y.a.name));
    ['icp', 'signal', 'total'].forEach((k) => $(`#h-${k}`).setAttribute('aria-sort', k === state.sort ? 'descending' : 'none'));
    const tb = $('#rank tbody');
    tb.innerHTML = '';
    (state.all ? rows : rows.slice(0, 15)).forEach((sc, i) => {
      const tr = el('tr', {
        class: 'clickable' + (sc.a.id === state.sel ? ' is-sel' : ''), tabindex: 0,
        'aria-label': `${sc.a.name}, tier ${tierLabel(sc.tier)}, total ${pts(sc.total)}`,
        onclick: () => select(sc.a.id, true),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(sc.a.id, true); } },
      }, [
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', { text: sc.a.name }),
        el('td', {}, el('span', { class: TIER_CLS[sc.tier], text: tierLabel(sc.tier) })),
        el('td', { text: sc.branch ? `${sc.branch.b} · ${sc.branch.name}` : '–' }),
        el('td', { class: 'num', text: pts(sc.icpScore) }),
        el('td', { class: 'num', text: pts(sc.signal) }),
        el('td', { class: 'num pos', text: pts(sc.total) }),
      ]);
      if (sc.a.id === state.sel) tr.setAttribute('aria-current', 'true');
      tb.append(tr);
    });
    $('#more').textContent = state.all ? 'Show top 15' : 'Show all 50';
    $('#more').setAttribute('aria-expanded', String(state.all));
    const c = { A: 0, B: 0, C: 0, none: 0 };
    scored.forEach((s) => c[s.tier]++);
    $('#k-a').textContent = c.A; $('#k-b').textContent = c.B; $('#k-c').textContent = c.C; $('#k-n').textContent = c.none;
  };

  const renderExplain = () => {
    const sc = scored.find((s) => s.a.id === state.sel);
    const { a } = sc;
    $('#b2').textContent = a.name;
    $('#x-sub').textContent = `${a.domain} · ${a.f.industry} · ${a.f.headcount} people · ${STAGE[a.f.funding_stage]}`;
    $('#x-icp').textContent = `${pts(sc.icpScore)}/15`;
    $('#x-sig').textContent = `${pts(sc.signal)}/${cfg.cap}`;
    $('#x-tot').textContent = pts(sc.total);
    $('#x-tier').textContent = tierLabel(sc.tier);

    const labels = [], gi = [], gs = [], gc = [];
    sc.icp.forEach((p, i) => { labels.push(ICP_DIMS[i].label); gi.push(p.pts); gs.push(0); gc.push(0); });
    sc.sig.forEach((p) => { labels.push(SIG[p.key].label); gi.push(0); gs.push(p.pts); gc.push(0); });
    if (sc.cut > 1e-9) { labels.push(`Cap at ${cfg.cap}`); gi.push(0); gs.push(0); gc.push(-sc.cut); }
    L.bars($('#x-chart'), {
      labels, horizontal: true, stacked: true, labelWidth: 170,
      groups: [{ values: gi, cls: 'b-ink' }, { values: gs, cls: 'b-accent' }, { values: gc, cls: 'b-muted' }],
      valueFmt: (v) => (v < 0 ? '−' + pts(-v) : '+' + pts(v)),
      ariaLabel: `Score breakdown for ${a.name}: ICP ${pts(sc.icpScore)}, signal ${pts(sc.signal)} after cap, total ${pts(sc.total)}`,
    });

    const tb = $('#x-rules tbody');
    tb.innerHTML = '';
    const row = (c, r, p, cls) => tb.append(el('tr', {}, [el('td', { text: c }), el('td', { text: r }), el('td', { class: 'num' + (cls ? ' ' + cls : ''), text: p })]));
    sc.icp.forEach((p, i) => row(ICP_DIMS[i].label, p.rule, `+${pts(p.pts)}`));
    if (!sc.sig.length) row('Signals', 'None fired in the last 30 days', '0');
    sc.sig.forEach((p) => row(`${SIG[p.key].label} · ${SIG[p.key].src}`, p.rule, `+${pts(p.pts)}`));
    if (sc.cut > 1e-9) row('Signal cap', `Raw signal ${pts(sc.raw)} capped at ${cfg.cap}`, `−${pts(sc.cut)}`, 'neg');
    row('Total', `ICP ${pts(sc.icpScore)} + signal ${pts(sc.signal)}. Tiers: A ≥ ${cfg.tA}, B ≥ ${cfg.tB}, C ≥ ${cfg.tC}`, pts(sc.total), 'pos');

    if (sc.branch) {
      $('#x-branch').textContent = `Branch ${sc.branch.b} · ${sc.branch.name}`;
      $('#x-branch').className = 'verdict__v';
      $('#x-branch-why').textContent = sc.branch.rule;
    } else {
      $('#x-branch').textContent = 'No outreach';
      $('#x-branch').className = 'verdict__v is-warn';
      $('#x-branch-why').textContent = `Total ${pts(sc.total)} is below the Tier C threshold of ${cfg.tC}. The account stays in nurture until a new signal fires.`;
    }

    const f = a.f, s = a.s, yn = (b) => (b ? 'yes' : 'no');
    const fired = SIGNALS.filter((d) => firedFlags(s)[d.key]).map((d) => `${d.label} (${s.age[d.key]}d ago)`);
    const kv = [
      ['Contact', `${a.contact} (fictional)`],
      ['Funding', `${STAGE[f.funding_stage]}, $${f.funding_total_m}M raised`],
      ['Billing model', `${BILLING[f.billing_model]}; multi-currency ${yn(f.multi_currency)}, multi-product ${yn(f.multi_product)}, enterprise contracts ${yn(f.enterprise_contracts)}`],
      ['Technical', `API-first ${yn(f.api_first)}, 1M+ events/month ${yn(f.high_event_volume)}`],
      ['Product usage', s.hosting_months ? `${s.invoices_30d} invoices/30d, ${s.plans} plans, ${s.metrics} metrics, ${s.seats} seats, failed payment ${yn(s.payment_failed)}, ${s.hosting_months} months self-hosted` : 'Not self-hosting'],
      ['Signals fired', fired.length ? fired.join(', ') : 'None'],
    ];
    const dl = $('#x-raw');
    dl.innerHTML = '';
    kv.forEach(([k, v]) => dl.append(el('dt', { text: k }), el('dd', { text: v })));
  };

  const runGate = () => {
    const sc = scored.find((s) => s.a.id === state.sel);
    const list = $('#g-list');
    list.innerHTML = '';
    if (!sc.branch) {
      $('#g-v').textContent = 'Not drafted';
      $('#g-v').className = 'verdict__v';
      $('#g-why').textContent = 'Below threshold. Nothing goes out.';
      return;
    }
    const g = gate($('#subj').value, $('#body').value, sc.a);
    $('#g-v').textContent = g.pass ? 'PASS' : 'FAIL';
    $('#g-v').className = 'verdict__v' + (g.pass ? '' : ' is-stop');
    const nf = g.rules.filter((r) => !r.ok).length;
    $('#g-why').textContent = g.pass ? `${g.words} words · all fields present · sending` : `${nf} rule${nf > 1 ? 's' : ''} failed · one LLM retry with the failures as feedback, then human review`;
    g.rules.forEach((r) => list.append(el('li', {}, [
      el('span', { class: r.ok ? 'tag tag--ok' : 'tag tag--stop', text: r.ok ? 'Pass' : 'Fail' }),
      el('div', {}, [el('span', { class: 'f-rule', text: r.rule }), el('p', { class: 'f-msg', text: r.msg })]),
      r.fix ? el('p', { class: 'f-fix', text: r.fix }) : null,
    ])));
  };

  const fillDraft = (force) => {
    const sc = scored.find((s) => s.a.id === state.sel);
    const sig = `${sc.a.id}:${sc.branch ? sc.branch.b : '-'}`;
    if (!force && state.draftFor === sig) return runGate();
    state.draftFor = sig;
    const d = draft(sc);
    $('#subj').value = d ? d.subject : '';
    $('#body').value = d ? d.body : '';
    $('#subj').disabled = !d; $('#body').disabled = !d; $('#redraft').disabled = !d;
    runGate();
  };

  const select = (id, scroll) => {
    state.sel = id;
    renderTable(); renderExplain(); fillDraft(false);
    if (scroll) $('#explain').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  // ---------- learn tab ----------
  const renderLearn = () => {
    const r = state.learned;
    $('#l-src').textContent = r.aucSrc.toFixed(3);
    $('#l-cur').textContent = r.aucCur.toFixed(3);
    $('#l-fit').textContent = r.aucFit.toFixed(3);
    $('#l-base').textContent = fmt.pct(r.base, 0);
    $('#l-n').textContent = r.nTest;
    const top = Math.max(...r.coef.slice(5), 1e-9);
    const learned = r.coef.map((c) => 5 * c / top);
    const current = [1, 1, 1, 1, 1, ...SIGNALS.map((d) => cfg.w[d.key])];
    L.bars($('#l-w'), {
      labels: FEAT_LABELS, horizontal: true, labelWidth: 170,
      groups: [{ values: learned, cls: 'b-accent', name: 'Learned' }, { values: current, cls: 'b-ink', name: 'Current' }],
      tipFmt: (i, g) => `${FEAT_LABELS[i]}<br>${g ? 'Current' : 'Learned'}: ${(g ? current : learned)[i].toFixed(2)} pts${i < 5 ? ' per ICP point' : ''}`,
      ariaLabel: 'Learned versus current weights for 5 ICP dimensions and 10 signals',
    });
    L.bars($('#l-lift'), {
      labels: Array.from({ length: 10 }, (_, i) => String(i + 1)), yfmt: (v) => fmt.pct(v, 0),
      groups: [{ values: r.liftFit, cls: 'b-accent' }, { values: r.liftSrc, cls: 'b-ink' }],
      tipFmt: (i, g) => `Decile ${i + 1}<br>${g ? 'Source weights' : 'Learned'}: ${fmt.pct((g ? r.liftSrc : r.liftFit)[i], 0)} converted`,
      ariaLabel: `Conversion rate by score decile. Top decile: learned ${fmt.pct(r.liftFit[0], 0)}, source ${fmt.pct(r.liftSrc[0], 0)}; base rate ${fmt.pct(r.base, 0)}`,
      height: 260, refLine: r.base,
    });
  };

  const relearn = L.debounce(() => { state.learned = learn(+$('#lam').value, cfg); renderLearn(); }, 120);
  L.bindRange('lam', (v) => String(v), relearn);

  $('#apply').addEventListener('click', () => {
    const w = learnedWeights(state.learned.coef);
    SIGNALS.forEach((d) => setVal(`w-${d.key}`, w[d.key]));
    $('#apply-note').textContent = 'Applied: ' + SIGNALS.map((d) => `${d.label} ${w[d.key]}`).join(' · ') + '. Live ranking updated.';
  });

  // ---------- wiring ----------
  const update = () => {
    cfg = getCfg();
    scored = live.map((a) => scoreAccount(a, cfg));
    if (state.sel == null) state.sel = [...scored].sort((x, y) => y.total - x.total)[0].a.id;
    cfgNote();
    renderTable(); renderExplain(); fillDraft(false);
    if (state.learned) {
      const X = history.filter((a) => a.fold === 0);
      state.learned.aucCur = auc(X.map((a) => scoreAccount(a, cfg).total), X.map((a) => a.y));
      renderLearn();
    }
  };

  L.bindSeg($('#sort'), (v) => { state.sort = v; renderTable(); });
  $('#more').addEventListener('click', () => { state.all = !state.all; renderTable(); });
  $('#reset').addEventListener('click', () => {
    SIGNALS.forEach((d) => setVal(`w-${d.key}`, d.w));
    ['cap', 'tA', 'tB', 'tC', 'half'].forEach((k) => setVal(k, SOURCE[k]));
    $('#apply-note').textContent = 'Back on the source weights.';
  });
  $('#redraft').addEventListener('click', () => fillDraft(true));
  $('#subj').addEventListener('input', runGate);
  $('#body').addEventListener('input', runGate);
  L.tabs(document, (p) => { if (p === 'p-learn') renderLearn(); });

  update();
  state.learned = learn(+$('#lam').value, cfg);
  renderLearn();
})();
