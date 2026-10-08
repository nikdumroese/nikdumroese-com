// Agent governance engine: a browser/Node port of the deterministic core of agent-governance/src.
// The source writes to PGlite tables (events, checks, findings, approvals, approval_overrides).
// Here the same rows live in plain arrays, and the "tables" are only ever appended to.
(function (root) {
  'use strict';

  /* ---------- labels (src/domain.ts) ---------- */
  const CHECK_TYPE_LABELS = { tov: 'Tone of voice', claims: 'Claims', competitor: 'Competitor mentions', regulated: 'Regulated language', spend: 'Spend', conflict: 'Conflicting actions' };
  const CHANNEL_LABELS = { email: 'Email', web: 'Web', paid_social: 'Paid social', paid_search: 'Paid search', organic_social: 'Organic social', agent_run: 'Live agent run' };
  const SOURCE_LABELS = { hubspot: 'HubSpot', zapier: 'Zapier', lindy: 'Lindy', agent_governance: 'Deployed here' };
  const ACTION_TYPE_LABELS = { 'email.send': 'Sent an email', 'page.publish': 'Published a page', 'ad.create': 'Created an ad', 'ad.budget_change': 'Changed ad budget', 'social.post': 'Posted to social', 'task.execute': 'Ran a task' };
  const checkTypeLabel = (t) => CHECK_TYPE_LABELS[t] || t;
  const channelLabel = (t) => CHANNEL_LABELS[t] || t;
  const actionTypeLabel = (t) => ACTION_TYPE_LABELS[t] || t;
  const sourceLabel = (t) => SOURCE_LABELS[t] || t;

  const day = (d) => d.toISOString().slice(0, 10);

  /* ---------- normalize (src/normalize.ts) ---------- */
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const num = (v) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : undefined; };

  function normalizeZapier(raw, orgId) {
    if (raw.action.type !== 'send_email') throw new Error(`zapier: unsupported action.type "${raw.action.type}" (${raw.ext_id})`);
    const out = raw.action.output;
    const content = { text: str(out.body_text) };
    if (out.subject) content.subject = out.subject;
    return {
      orgId, ts: new Date(raw.started_at), source: 'zapier',
      agentId: raw.agent_key ?? slugify(raw.zap_title), agentLabel: raw.zap_title,
      attributionConfidence: raw.agent_key ? 'high' : 'medium',
      actionType: 'email.send', channel: 'email', subjectRef: out.subject ?? null,
      content, money: null, rawPayload: raw,
    };
  }

  function normalizeLindy(raw, orgId) {
    const { tool, args } = raw.tool_call;
    const base = {
      orgId, ts: new Date(raw.completed_at), source: 'lindy',
      agentId: raw.agent_key ?? slugify(raw.agent), agentLabel: raw.agent,
      attributionConfidence: raw.agent_key ? 'high' : 'medium', rawPayload: raw,
    };
    let actionType, channel, subjectRef, content, money = null;
    switch (tool) {
      case 'cms.publish_post':
        actionType = 'page.publish'; channel = 'web'; subjectRef = str(args.url) || null;
        content = { text: str(args.markdown), subject: str(args.title) };
        break;
      case 'social.create_post':
        actionType = 'social.post'; channel = 'organic_social'; subjectRef = str(args.permalink) || null;
        content = { text: str(args.text) };
        break;
      case 'google_ads.update_budget': {
        actionType = 'ad.budget_change'; channel = 'paid_search'; subjectRef = str(args.campaign) || null;
        const budget = num(args.daily_budget_usd);
        const currency = str(args.currency) || 'USD';
        content = { text: `Daily budget set to ${budget ?? '?'} ${currency} on campaign "${str(args.campaign)}"` };
        money = { currency };
        if (budget !== undefined) money.budgetNew = budget;
        break;
      }
      default:
        throw new Error(`lindy: unsupported tool "${tool}" (${raw.ext_id})`);
    }
    return { ...base, actionType, channel, subjectRef, content, money };
  }

  // HubSpot normalizer omitted: the bundled fixtures contain no HubSpot events.
  function normalize(raw, orgId) {
    const row = raw.provider === 'zapier' ? normalizeZapier(raw, orgId)
      : raw.provider === 'lindy' ? normalizeLindy(raw, orgId)
      : (() => { throw new Error(`unknown provider "${raw.provider}" (${raw.ext_id ?? '?'})`); })();
    // The source gets a uuid from Postgres; the fixture ext_id is unique (src/fixtures.test.ts) so it stands in.
    return { eventId: raw.ext_id, ...row };
  }

  /* ---------- MockJudge (src/judge/mock.ts) — deterministic, offline, the repo's default judge ---------- */
  const capsWords = (text) => (text.match(/\b[A-Z]{2,}\b/g) || []).filter((w) => w !== 'USD' && w !== 'US');
  const words = (text) => text.match(/\b[\p{L}']+\b/gu) || [];
  const sentences = (text) => text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const joinForScoring = (input) => [input.subject, input.text].filter(Boolean).join('\n');

  function scoreToV(input, policy) {
    const text = joinForScoring(input);
    const lower = text.toLowerCase();
    const spans = [], reasons = [];
    let score = 1;
    const banned = policy.bannedWords.filter((w) => lower.includes(w.toLowerCase()));
    if (banned.length) { score -= 0.25 * banned.length; spans.push(...banned); reasons.push(`banned phrases: ${banned.join(', ')}`); }
    const allWords = words(text), caps = capsWords(text);
    const capsRatio = allWords.length ? caps.length / allWords.length : 0;
    if (capsRatio > 0.6) { score -= 0.5; reasons.push('almost entirely upper-case'); spans.push(caps.slice(0, 4).join(' ')); }
    else if (capsRatio > 0.3) { score -= 0.3; reasons.push('heavy upper-case for emphasis'); spans.push(caps.slice(0, 4).join(' ')); }
    const bangs = (text.match(/!/g) || []).length;
    if (bangs >= 3) { score -= 0.3; reasons.push(`${bangs} exclamation marks`); }
    if (/!{2,}/.test(text)) { score -= 0.2; spans.push('!!!'); reasons.push('stacked exclamation marks'); }
    const sents = sentences(text);
    const avgLen = sents.length ? sents.reduce((n, s) => n + words(s).length, 0) / sents.length : 0;
    if (avgLen > policy.maxSentenceLen) { score -= 0.15; reasons.push(`long sentences (avg ${Math.round(avgLen)} words)`); }
    if (!policy.allowEmoji) {
      const emoji = text.match(/\p{Extended_Pictographic}/gu) || [];
      if (emoji.length) { score -= 0.15; spans.push(...emoji.slice(0, 3)); reasons.push('emoji in a channel that should not use them'); }
    }
    score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
    return { score, rationale: reasons.length ? reasons.join('; ') : 'reads as on-voice', offendingSpans: [...new Set(spans)].filter(Boolean) };
  }
  // src/judge/types.ts verdictFromScore
  const verdictFromScore = (score, p) => (score < p.failBelow ? 'fail' : score < p.warnBelow ? 'warn' : 'pass');

  /* ---------- checks (src/checks/*.ts) ---------- */
  const TEXT_ACTIONS = new Set(['email.send', 'page.publish', 'social.post', 'task.execute']);
  const textOf = (e) => { const o = { text: e.content.text ?? '' }; if (e.content.subject) o.subject = e.content.subject; return o; };
  function firstSentenceWith(text, needle) {
    const hit = text.split(/(?<=[.!?])\s+/).find((s) => s.toLowerCase().includes(needle.toLowerCase()));
    return (hit ?? '').trim().slice(0, 160);
  }

  function tovCheck(event, ctx) {
    if (!TEXT_ACTIONS.has(event.actionType)) return null;
    const r = scoreToV(textOf(event), ctx.policy.tov);
    return { checkType: 'tov', score: r.score, verdict: verdictFromScore(r.score, ctx.policy.tov), rationale: r.rationale, offendingSpans: r.offendingSpans };
  }

  const DISCLAIMER = /(according to|based on|case study|\bstudy\b|customer[- ]reported|median|on average|average of|\d+\s*(customers|teams)\b)/i;
  function claimsCheck(event, ctx) {
    if (!TEXT_ACTIONS.has(event.actionType)) return null;
    const { text, subject } = textOf(event);
    const hay = `${subject ?? ''}\n${text}`.toLowerCase();
    const hits = ctx.policy.claims.lexicon.filter((t) => hay.includes(t.toLowerCase()));
    if (!hits.length) return { checkType: 'claims', score: null, verdict: 'pass', rationale: 'no claim language', offendingSpans: [] };
    const triggered = Object.entries(ctx.policy.claims.substantiationTriggers).filter(([, ws]) => ws.some((w) => hay.includes(w.toLowerCase()))).map(([c]) => c);
    const hasDisclaimer = DISCLAIMER.test(text);
    const spans = [...hits, ...hits.map((h) => firstSentenceWith(text, h)).filter(Boolean)];
    if (triggered.length && !hasDisclaimer) {
      return { checkType: 'claims', score: null, verdict: 'fail', rationale: `${triggered.join('/')} claim ("${hits.join(', ')}") with no named customer or study`, offendingSpans: [...new Set(spans)] };
    }
    if (hasDisclaimer) return { checkType: 'claims', score: null, verdict: 'pass', rationale: `claim language present but substantiated ("${hits.join(', ')}")`, offendingSpans: [] };
    return { checkType: 'claims', score: null, verdict: 'warn', rationale: `claim language without substantiation ("${hits.join(', ')}")`, offendingSpans: [...new Set(spans)] };
  }

  function competitorCheck(event, ctx) {
    if (!TEXT_ACTIONS.has(event.actionType)) return null;
    const { text, subject } = textOf(event);
    const low = `${subject ?? ''}\n${text}`.toLowerCase();
    const seen = new Set();
    const hits = ctx.policy.competitors.filter((c) => {
      const k = c.toLowerCase();
      if (seen.has(k) || !low.includes(k)) return false;
      seen.add(k);
      return true;
    });
    if (!hits.length) return { checkType: 'competitor', score: null, verdict: 'pass', rationale: 'no competitor named', offendingSpans: [] };
    const spans = [...hits, ...hits.map((h) => firstSentenceWith(text, h)).filter(Boolean)];
    return { checkType: 'competitor', score: null, verdict: 'fail', rationale: `mentions competitor(s) we should never name: ${hits.join(', ')}`, offendingSpans: [...new Set(spans)] };
  }

  function regulatedCheck(event, ctx) {
    if (!TEXT_ACTIONS.has(event.actionType)) return null;
    const { text, subject } = textOf(event);
    const low = `${subject ?? ''}\n${text}`.toLowerCase();
    const hits = ctx.policy.regulated.filter((p) => low.includes(p.toLowerCase()));
    if (!hits.length) return { checkType: 'regulated', score: null, verdict: 'pass', rationale: 'no regulated phrasing', offendingSpans: [] };
    const spans = [...hits, ...hits.map((h) => firstSentenceWith(text, h)).filter(Boolean)];
    return { checkType: 'regulated', score: null, verdict: 'warn', rationale: `security/compliance phrasing needs Legal sign-off: ${hits.join(', ')}`, offendingSpans: [...new Set(spans)] };
  }

  const dayKey = (agentId, ts) => `${agentId}|${day(ts)}`;
  function spendCheck(event, ctx) {
    const { ceilingsByAgent, currency, maxEmailsPerDay } = ctx.policy.spend;
    if (event.actionType === 'ad.budget_change' || event.actionType === 'ad.create') {
      const amount = event.money?.budgetNew ?? event.money?.spendDelta;
      if (amount == null) return null;
      const ceiling = ceilingsByAgent[event.agentId];
      const cap = ceiling ?? Number.POSITIVE_INFINITY;
      if (amount > cap) {
        return { checkType: 'spend', score: null, verdict: 'fail', rationale: `${event.agentLabel} set ${amount} ${currency}/day on "${event.subjectRef ?? '?'}" — ceiling is ${cap} ${currency}`, offendingSpans: [`${amount} ${currency}/day`] };
      }
      return { checkType: 'spend', score: null, verdict: 'pass', rationale: `budget ${amount} ${currency}/day within ceiling ${cap} ${currency}`, offendingSpans: [] };
    }
    if (event.actionType === 'email.send') {
      const count = ctx.emailDayCount.get(dayKey(event.agentId, event.ts)) ?? 0;
      if (count > maxEmailsPerDay) {
        return { checkType: 'spend', score: null, verdict: 'fail', rationale: `${count} emails from ${event.agentLabel} on ${day(event.ts)} — limit is ${maxEmailsPerDay}/day`, offendingSpans: [`${count} emails/day`] };
      }
      return { checkType: 'spend', score: null, verdict: 'pass', rationale: 'send volume within daily limit', offendingSpans: [] };
    }
    return null;
  }

  const HOUR_MS = 3600e3;
  function conflictCheck(event, ctx) {
    if (!event.subjectRef) return null;
    const windowMs = ctx.policy.conflict.windowHours * HOUR_MS;
    const other = ctx.sameOrgEvents.find((e) => e.agentId !== event.agentId && e.subjectRef === event.subjectRef && Math.abs(e.ts - event.ts) <= windowMs);
    if (!other) return null;
    return { checkType: 'conflict', score: null, verdict: 'warn', rationale: `${other.agentLabel} also acted on "${event.subjectRef}" (${other.actionType}) within ${ctx.policy.conflict.windowHours}h`, offendingSpans: [event.subjectRef] };
  }

  // src/checks/runner.ts — same order as ALL_CHECKS
  const ALL_CHECKS = [tovCheck, claimsCheck, competitorCheck, regulatedCheck, spendCheck, conflictCheck];

  function emailDayCounts(rows) {
    const m = new Map();
    for (const e of rows) {
      if (e.actionType !== 'email.send') continue;
      const k = dayKey(e.agentId, e.ts);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }

  const scoreAction = (action, ctx) => ALL_CHECKS.map((fn) => fn(action, ctx)).filter(Boolean);

  // runChecks: one check row per applicable (event, check type), one finding per warn/fail.
  function runChecks(rows, policy) {
    const ctx = { policy, emailDayCount: emailDayCounts(rows), sameOrgEvents: rows };
    const checks = [], findings = [];
    for (const event of rows) {
      for (const o of scoreAction(event, ctx)) {
        const check = { checkId: `${event.eventId}:${o.checkType}`, eventId: event.eventId, ...o, policyVersion: policy.version };
        checks.push(check);
        if (o.verdict !== 'pass') {
          findings.push({ eventId: event.eventId, checkId: check.checkId, severity: o.verdict === 'fail' ? 'high' : 'medium', summary: `${o.checkType}: ${o.rationale}`.slice(0, 200) });
        }
      }
    }
    return { checks, findings };
  }

  /* ---------- gate (src/gate.ts) ---------- */
  // decide(): first matching rule per check; worst decision across the event's checks wins.
  // `decidedBy` is added for this page (which check and rule set the final decision); the decision logic is unchanged.
  function decide(policy, checkRows) {
    const { rules, tiers } = policy.approval;
    let decision = policy.approval.default;
    let decidedBy = null;
    const reasons = [];
    for (const c of checkRows) {
      if (c.verdict === 'pass') continue;
      const ruleIndex = rules.findIndex((r) => (r.checkType === undefined || r.checkType === c.checkType) && (r.verdict === undefined || r.verdict === c.verdict));
      const rule = rules[ruleIndex];
      const d = rule?.decision ?? policy.approval.default;
      if (tiers[d] > tiers[decision] || (!decidedBy && d === decision)) decidedBy = { checkType: c.checkType, verdict: c.verdict, ruleIndex, decision: d };
      if (tiers[d] > tiers[decision]) decision = d;
      if (d !== 'auto') reasons.push(`${checkTypeLabel(c.checkType)}${c.rationale ? `: ${c.rationale}` : ''}`);
    }
    return { decision, tier: tiers[decision], reasons, decidedBy };
  }

  function runGate(rows, checks, policy) {
    const byEvent = new Map();
    for (const c of checks) { const l = byEvent.get(c.eventId) || []; l.push(c); byEvent.set(c.eventId, l); }
    return rows.map((e) => ({ eventId: e.eventId, ...decide(policy, byEvent.get(e.eventId) || []) }));
  }

  // getEffectiveDecisions: latest human override if one exists, else the system decision. Overrides are append-only.
  function getEffectiveDecisions(approvals, overrides) {
    const latest = new Map();
    for (const o of overrides) latest.set(o.eventId, o); // ascending → last write wins
    const out = new Map();
    for (const s of approvals) {
      const ov = latest.get(s.eventId);
      out.set(s.eventId, { decision: ov ? ov.decision : s.decision, systemDecision: s.decision, reasons: s.reasons, overridden: Boolean(ov), overrideActorRole: ov?.actorRole, overrideNote: ov?.note ?? null });
    }
    return out;
  }

  // buildGate. Objections (Phase 5 "disputed" flag) are not modelled on this page, so disputed is always false.
  function buildGate(rows, approvals, overrides) {
    const effective = getEffectiveDecisions(approvals, overrides);
    const evById = new Map(rows.map((e) => [e.eventId, e]));
    const summary = { block: 0, review: 0, auto: 0, pending: [], history: [] };
    for (const a of approvals) {
      const r = evById.get(a.eventId);
      const eff = effective.get(a.eventId);
      const decision = eff?.decision ?? 'auto';
      summary[decision] += 1;
      if (decision !== 'auto') {
        summary.pending.push({ eventId: r.eventId, agentId: r.agentId, agentLabel: r.agentLabel, actionType: r.actionType, subjectRef: r.subjectRef, decision, systemDecision: eff.systemDecision, overridden: eff.overridden, overrideActorRole: eff.overrideActorRole, overrideNote: eff.overrideNote, disputed: false, reasons: a.reasons, ts: r.ts.toISOString() });
      }
    }
    summary.pending.sort((a, b) => (b.decision === 'block' ? 1 : 0) - (a.decision === 'block' ? 1 : 0) || a.ts.localeCompare(b.ts));
    const sysById = new Map(approvals.map((a) => [a.eventId, a.decision]));
    summary.history = overrides
      .filter((o) => evById.has(o.eventId))
      .map((o) => { const e = evById.get(o.eventId); return { eventId: o.eventId, agentLabel: e.agentLabel, actionType: e.actionType, subjectRef: e.subjectRef, systemDecision: sysById.get(o.eventId), overrideDecision: o.decision, actorRole: o.actorRole, note: o.note, createdAt: o.createdAt }; })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return summary;
  }

  /* ---------- drift (src/drift.ts) ---------- */
  function dailyMeansByStream(rows, checks) {
    const evById = new Map(rows.map((e) => [e.eventId, e]));
    const buckets = new Map();
    for (const c of checks) {
      if (c.checkType !== 'tov' || c.score == null) continue;
      const r = evById.get(c.eventId);
      const key = `${r.agentId}|${r.channel}|${day(r.ts)}`;
      const b = buckets.get(key) || { label: r.agentLabel, sum: 0, n: 0 };
      b.sum += c.score; b.n += 1;
      buckets.set(key, b);
    }
    const byStream = new Map();
    for (const [key, b] of buckets) {
      const [agentId, channel, date] = key.split('|');
      const sk = `${agentId}|${channel}`;
      const list = byStream.get(sk) || [];
      list.push({ agentId, agentLabel: b.label, channel, date, mean: b.sum / b.n, n: b.n });
      byStream.set(sk, list);
    }
    for (const list of byStream.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return byStream;
  }

  // buildDrift. The source persists each stream's baseline on first read (bootstrapped as the mean of its daily
  // means) and only a scheduled job rolls it forward. This page has no persistence, so every read is a first read.
  function buildDrift(rows, checks, policy) {
    const byStream = dailyMeansByStream(rows, checks);
    const points = [...byStream.values()].flat();
    const alarms = [], baselines = {};
    for (const [sk, sp] of byStream) {
      const baseline = { mean: sp.reduce((s, p) => s + p.mean, 0) / sp.length, n: sp.length };
      baselines[sk] = baseline;
      for (const p of sp) {
        if (p.n < policy.drift.minSamples) continue;
        const drop = baseline.mean - p.mean;
        const belowThreshold = p.mean < policy.tov.warnBelow;
        const bigDrop = drop > policy.drift.dropThreshold;
        if (!belowThreshold && !bigDrop) continue;
        alarms.push({ agentId: p.agentId, agentLabel: p.agentLabel, channel: p.channel, date: p.date, mean: Number(p.mean.toFixed(3)), baseline: Number(baseline.mean.toFixed(3)), drop: Number(drop.toFixed(3)), reason: belowThreshold ? 'below_threshold' : 'drop_vs_baseline' });
      }
    }
    points.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.date.localeCompare(b.date));
    return { points, alarms, baselines };
  }

  /* ---------- outcomes (src/outcomes.ts) ---------- */
  const QUALITY_CHECK_TYPES = ['tov', 'claims', 'competitor', 'regulated'];
  function buildOutcomeImpact(rows, checks, outcomeRows, effective, policy) {
    const outcomeByRef = new Map(outcomeRows.map((o) => [o.subject_ref, o]));
    const withOutcome = rows.filter((e) => e.subjectRef && outcomeByRef.has(e.subjectRef));
    const coverage = rows.length ? withOutcome.length / rows.length : 0;
    const flaggedByType = new Map(QUALITY_CHECK_TYPES.map((t) => [t, new Set()]));
    const anyFinding = new Set();
    for (const c of checks) {
      if (c.verdict === 'pass') continue;
      anyFinding.add(c.eventId);
      if (QUALITY_CHECK_TYPES.includes(c.checkType)) flaggedByType.get(c.checkType).add(c.eventId);
    }
    const anyQuality = new Set([...flaggedByType.values()].flatMap((s) => [...s]));
    const clean = new Set(rows.map((e) => e.eventId).filter((id) => !anyFinding.has(id)));
    const group = (ids) => {
      let sessions = 0, conversions = 0, n = 0;
      for (const e of withOutcome) {
        if (!ids.has(e.eventId)) continue;
        const o = outcomeByRef.get(e.subjectRef);
        sessions += o.sessions; conversions += o.conversions; n += 1;
      }
      return { rate: sessions > 0 ? conversions / sessions : 0, n };
    };
    const compare = (scope, ids) => {
      const c = group(clean), f = group(ids);
      const material = c.n >= policy.outcomes.minSamples && f.n >= policy.outcomes.minSamples;
      return { scope, cleanRate: c.rate, cleanN: c.n, flaggedRate: f.rate, flaggedN: f.n, deltaPct: material && c.rate > 0 ? (c.rate - f.rate) / c.rate : null, material };
    };
    const comparisons = [compare('aggregate', anyQuality), ...QUALITY_CHECK_TYPES.map((t) => compare(t, flaggedByType.get(t)))];
    const refByEvent = new Map(rows.map((e) => [e.eventId, e.subjectRef]));
    const byDecision = new Map();
    for (const [eventId, eff] of effective) {
      const ref = refByEvent.get(eventId);
      const o = ref ? outcomeByRef.get(ref) : undefined;
      const cur = byDecision.get(eff.decision) || { revenue: 0, n: 0 };
      cur.revenue += o?.revenue ?? 0; cur.n += 1;
      byDecision.set(eff.decision, cur);
    }
    const gateExposure = ['block', 'review', 'auto'].filter((d) => byDecision.has(d)).map((d) => ({ decision: d, ...byDecision.get(d) }));
    const totalGateExposureRevenue = gateExposure.filter((g) => g.decision !== 'auto').reduce((a, g) => a + g.revenue, 0);
    return { coverage, comparisons, gateExposure, totalGateExposureRevenue };
  }

  /* ---------- report model (src/report.ts) ---------- */
  const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
  function buildReportModel(st, policy) {
    const { rows, checks, findings } = st;
    const checkById = new Map(checks.map((c) => [c.checkId, c]));
    const evById = new Map(rows.map((e) => [e.eventId, e]));
    const findingViews = findings.map((f) => {
      const c = checkById.get(f.checkId), e = evById.get(f.eventId);
      return { eventId: e.eventId, agentId: e.agentId, ts: e.ts.toISOString(), agentLabel: e.agentLabel, actionType: e.actionType, channel: e.channel, subjectRef: e.subjectRef, checkType: c.checkType, verdict: c.verdict, severity: f.severity, rationale: c.rationale, span: c.offendingSpans.length ? c.offendingSpans[0] : null };
    }).sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.ts.localeCompare(b.ts));

    const tov = new Map();
    for (const c of checks) {
      if (c.checkType !== 'tov' || c.score == null) continue;
      const e = evById.get(c.eventId);
      const k = `${e.agentId}|${day(e.ts)}`;
      const cur = tov.get(k) || { sum: 0, n: 0 };
      cur.sum += c.score; cur.n += 1;
      tov.set(k, cur);
    }

    const agentIds = [...new Set(rows.map((e) => e.agentId))].sort();
    const agents = agentIds.map((agentId) => {
      const mine = rows.filter((e) => e.agentId === agentId);
      const first = mine[0];
      const byAction = {};
      for (const e of mine) byAction[e.actionType] = (byAction[e.actionType] ?? 0) + 1;
      const tovDaily = [...tov.entries()].filter(([k]) => k.startsWith(`${agentId}|`)).map(([k, v]) => ({ date: k.split('|')[1], mean: v.sum / v.n, n: v.n })).sort((a, b) => a.date.localeCompare(b.date));
      const ceiling = policy.spend.ceilingsByAgent[agentId] ?? null;
      const adBudgets = mine.filter((e) => e.actionType === 'ad.budget_change' || e.actionType === 'ad.create').map((e) => {
        const amount = e.money?.budgetNew ?? e.money?.spendDelta ?? 0;
        return { campaign: e.subjectRef ?? '?', amount, currency: e.money?.currency ?? policy.spend.currency, over: ceiling != null && amount > ceiling };
      });
      return { agentId, label: first.agentLabel, source: first.source, eventCount: mine.length, byAction, tovDaily, adBudgets, ceiling, findingCount: findingViews.filter((f) => f.agentLabel === first.agentLabel).length };
    });

    const tsList = rows.map((e) => e.ts.toISOString()).sort();
    return {
      org: policy.org,
      policyVersion: policy.version,
      range: { from: tsList[0] ?? '', to: tsList[tsList.length - 1] ?? '' },
      totals: { events: rows.length, agents: agents.length, checks: checks.length, findings: findingViews.length, fails: findingViews.filter((f) => f.verdict === 'fail').length, warns: findingViews.filter((f) => f.verdict === 'warn').length },
      agents,
      findings: findingViews,
      topThree: findingViews.slice(0, 3).map((f) => `${f.agentLabel} — ${checkTypeLabel(f.checkType)}: ${f.rationale}`),
      drift: { points: st.drift.points, alarms: st.drift.alarms },
      gate: st.gate,
      outcomes: st.outcomes,
    };
  }

  /* ---------- digest (src/deliver.ts) ---------- */
  const plural = (n, label, pl = label + 's') => `${n} ${n === 1 ? label : pl}`;
  function headline(m) {
    const lines = [
      `${plural(m.totals.events, 'agent action')} across ${plural(m.totals.agents, 'agent')}.`,
      `${plural(m.totals.findings, 'finding')} (${m.totals.fails} fail, ${m.totals.warns} warn). Approval gate: ${m.gate.block} blocked, ${m.gate.review} flagged for review.`,
      `${plural(m.drift.alarms.length, 'agent sounds', 'agents sound')} off from their usual tone.`,
    ];
    const agg = m.outcomes.comparisons.find((c) => c.scope === 'aggregate');
    if (agg && agg.material) {
      const worse = (agg.deltaPct ?? 0) > 0;
      lines.push(`Flagged content converts ${Math.abs((agg.deltaPct ?? 0) * 100).toFixed(0)}% ${worse ? 'worse' : 'better'} than clean (fixture data, illustrative — see HANDOFF.md). Gate exposure: $${m.outcomes.totalGateExposureRevenue.toLocaleString('en-US')} touched by block/review.`);
    }
    return lines;
  }

  function renderDigestText(m) {
    const out = [`${m.org} — agent governance weekly digest`, `${m.range.from.slice(0, 10)} -> ${m.range.to.slice(0, 10)} · policy ${m.policyVersion}`, '', ...headline(m), '', 'TOP 3'];
    m.topThree.forEach((s, i) => out.push(`${i + 1}. ${s}`));
    out.push('', 'FINDINGS');
    for (const f of m.findings) out.push(`[${f.severity}] ${checkTypeLabel(f.checkType)} · ${f.agentLabel} · ${actionTypeLabel(f.actionType)} — ${f.rationale}` + (f.span ? `  («${f.span}»)` : ''));
    if (m.drift.alarms.length) {
      out.push('', 'AGENTS OFF THEIR USUAL TONE');
      for (const a of m.drift.alarms) out.push(`${a.agentLabel} / ${channelLabel(a.channel)} · ${a.date} · tone score ${a.mean.toFixed(2)} vs its usual ${a.baseline.toFixed(2)} (${a.reason})`);
    }
    if (m.gate.pending.length) {
      out.push('', 'BLOCKED / FLAGGED FOR REVIEW');
      for (const p of m.gate.pending) {
        out.push(`[${p.decision}] ${p.agentLabel} · ${actionTypeLabel(p.actionType)} · ${p.subjectRef ?? '—'}`);
        for (const r of p.reasons) out.push(`    - ${r}`);
      }
    }
    return out.join('\n') + '\n';
  }

  function renderDigestMarkdown(m) {
    const out = [`# ${m.org} — agent governance weekly digest`, `_${m.range.from.slice(0, 10)} → ${m.range.to.slice(0, 10)} · policy ${m.policyVersion}_`, ''];
    for (const h of headline(m)) out.push(`- ${h}`);
    out.push('', '## Top 3');
    m.topThree.forEach((s, i) => out.push(`${i + 1}. ${s}`));
    out.push('', '## Findings', '', '| Severity | Check | Agent | Action | Why |', '|---|---|---|---|---|');
    for (const f of m.findings) out.push(`| ${f.severity} | ${checkTypeLabel(f.checkType)} | ${f.agentLabel} | ${actionTypeLabel(f.actionType)} | ${f.rationale.replace(/\|/g, '\\|')} |`);
    if (m.drift.alarms.length) {
      out.push('', '## Agents off their usual tone');
      for (const a of m.drift.alarms) out.push(`- **${a.agentLabel} / ${channelLabel(a.channel)}** ${a.date}: tone score ${a.mean.toFixed(2)} vs its usual ${a.baseline.toFixed(2)} (${a.reason})`);
    }
    if (m.gate.pending.length) {
      out.push('', '## Blocked / flagged for review');
      for (const p of m.gate.pending) {
        out.push(`- **[${p.decision}]** ${p.agentLabel} · ${actionTypeLabel(p.actionType)} · ${p.subjectRef ?? '—'}`);
        for (const r of p.reasons) out.push(`  - ${r}`);
      }
    }
    return out.join('\n') + '\n';
  }

  /* ---------- policy validation (src/policy.ts validatePolicyShape, abridged to the fields this page edits) ---------- */
  function validatePolicy(p) {
    const errors = [];
    const need = (c, m) => { if (!c) errors.push(m); };
    need(p.tov.failBelow <= p.tov.warnBelow, 'tov.failBelow must be <= tov.warnBelow');
    need(Number.isFinite(p.spend.maxEmailsPerDay), 'spend.maxEmailsPerDay must be a number');
    need(Number.isFinite(p.conflict.windowHours), 'conflict.windowHours must be a number');
    need(Number.isFinite(p.drift.dropThreshold) && Number.isFinite(p.drift.minSamples), 'drift settings must be numbers');
    for (const [k, v] of Object.entries(p.spend.ceilingsByAgent)) need(Number.isFinite(v), `spend.ceilingsByAgent.${k} must be a number`);
    p.approval.rules.forEach((r, i) => need(['auto', 'review', 'block'].includes(r.decision), `approval.rules[${i}].decision must be one of auto|review|block`));
    return errors;
  }

  /* ---------- the whole pipeline (src/pipeline.ts seedInto + buildReportModel) ---------- */
  // rawEvents: what the connector delivered so far. overrides: the append-only human decisions.
  function run({ rawEvents, policy, outcomes, overrides = [] }) {
    const rows = rawEvents.map((r) => normalize(r, policy.orgId));
    const { checks, findings } = runChecks(rows, policy);
    const approvals = runGate(rows, checks, policy);
    const effective = getEffectiveDecisions(approvals, overrides);
    const gate = buildGate(rows, approvals, overrides);
    const drift = buildDrift(rows, checks, policy);
    const outcomeImpact = buildOutcomeImpact(rows, checks, outcomes, effective, policy);
    const st = { rows, checks, findings, approvals, effective, gate, drift, outcomes: outcomeImpact };
    st.model = buildReportModel(st, policy);
    return st;
  }

  const api = {
    normalize, scoreToV, verdictFromScore, emailDayCounts, scoreAction, runChecks, decide, runGate, getEffectiveDecisions, buildGate,
    buildDrift, buildOutcomeImpact, buildReportModel, renderDigestText, renderDigestMarkdown, validatePolicy, run,
    checkTypeLabel, channelLabel, actionTypeLabel, sourceLabel, TEXT_ACTIONS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AGEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
