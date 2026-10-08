// Brand & claims gate: config (RULES, REGISTER, MARKETS) + a deterministic engine.
// Runs in the browser (window.ClaimsGate) and in Node (module.exports) so it can be tested headless.
// Brand, competitors, claims and evidence IDs are fictional. Illustrative rule set, not legal advice.
(function (root) {
  'use strict';

  const RULESET = 'fernway-2026-10-01';
  const BRAND = 'Fernway';
  const WEIGHT = { info: 0, warn: 10, block: 40 };

  const CHANNELS = {
    rsa: {
      name: 'Google Responsive Search Ad',
      prefixes: { h: 'headline', headline: 'headline', d: 'description', description: 'description' },
      fallback: 'headline', multi: [],
      hint: 'One asset per line. Start headlines with H: (max 30 characters) and descriptions with D: (max 90).',
    },
    meta: {
      name: 'Meta ad',
      prefixes: { p: 'primary', primary: 'primary', h: 'headline', headline: 'headline' },
      fallback: 'primary', multi: ['primary'],
      hint: 'Primary: text (125 characters before "See more"), Headline: (40 recommended). Unlabelled lines count as primary text.',
    },
    linkedin: {
      name: 'LinkedIn post',
      prefixes: {},
      fallback: 'body', multi: ['body'],
      hint: 'Plain post text. Max 3,000 characters. About 150 show before "see more", so the first line is the hook.',
    },
    email: {
      name: 'Email',
      prefixes: { subject: 'subject', s: 'subject', preheader: 'preheader', pre: 'preheader', body: 'body' },
      fallback: 'body', multi: ['body'],
      hint: 'Subject: (max 60), Preheader: (max 110), then the body. Unlabelled lines count as body.',
    },
  };

  const MARKETS = {
    UK: {
      name: 'United Kingdom',
      basis: {
        superlative: 'CAP Code 3.7: objective claims need documentary evidence held before the ad runs.',
        comparative: 'CAP Code 3.33 and the CPRs: comparisons must be verifiable and not misleading.',
      },
    },
    DE: {
      name: 'Germany',
      basis: {
        superlative: 'UWG §5: a sole-position claim (Alleinstellung) such as "#1" or "Marktführer" must be provable.',
        comparative: 'UWG §6: comparative ads must compare objective, verifiable features and must not disparage.',
      },
    },
    US: {
      name: 'United States',
      basis: {
        superlative: 'FTC Act §5: objective claims need a reasonable basis before they run.',
        comparative: 'FTC policy allows comparative ads only when they are truthful and substantiated.',
      },
    },
  };

  const COMPETITORS = ['Ledgerly', 'SpendHive', 'Pennant Pay', 'Clearbook'];

  // Approved-claims register. Every numeric or superlative claim in copy must trace to a row here.
  const REGISTER = [
    { id: 'EV-002', claim: 'Used by 40,000+ companies across Europe', numbers: [40000], markets: ['UK', 'DE', 'US'], source: 'Billing export, active paying accounts, 2026-09-01' },
    { id: 'EV-009', claim: 'Trusted by 25,000 companies', numbers: [25000], markets: ['UK', 'DE', 'US'], retired: 'superseded by EV-002', source: 'Billing export, 2025-03-01' },
    { id: 'EV-014', claim: 'Save up to 10 hours a month on expense reports', numbers: [10], qualifier: 'up to', markets: ['UK', 'DE', 'US'], source: 'Customer time study, n=212, 2026' },
    { id: 'EV-021', claim: 'Cards issued in under 2 minutes', numbers: [2], qualifier: 'under', markets: ['UK', 'DE', 'US'], source: 'Product telemetry, p90 issue time, Q3 2026' },
    { id: 'EV-027', claim: 'Receipts matched automatically in 92% of cases', numbers: [92], markets: ['UK', 'DE', 'US'], source: 'Product telemetry, Q3 2026' },
    { id: 'EV-033', claim: 'Spend in 30+ currencies with no FX markup', numbers: [30], markets: ['UK', 'DE', 'US'], source: 'Pricing page + card scheme terms' },
    { id: 'EV-038', claim: 'Finance teams close the month 3 days faster on average', numbers: [3], qualifier: 'on average', markets: ['UK', 'DE', 'US'], source: 'Customer survey, n=480, 2026' },
    { id: 'EV-045', claim: '1% cashback on card spend', numbers: [1], markets: ['UK'], source: 'UK card programme terms' },
    { id: 'EV-052', claim: 'Cheaper than Ledgerly on list price for teams of 50 or more', numbers: [50], competitor: 'Ledgerly', markets: ['UK', 'US'], source: 'Public price lists, checked 2026-09-15' },
    { id: 'EV-060', claim: 'ISO/IEC 27001 certified', numbers: [], markets: ['UK', 'DE', 'US'], source: 'Certificate no. FW-27001-0042 (fictional)' },
  ];

  const RULES = [
    // ---- 1. Length & format ----
    { id: 'LEN-RSA-HEAD', category: 'length', severity: 'block', scope: { channels: ['rsa'] }, type: 'length', params: { field: 'headline', max: 30 },
      message: 'Headline is {len} characters. Google allows {max}.', fix: 'Cut to {max} or fewer. Move detail into a description.' },
    { id: 'LEN-RSA-DESC', category: 'length', severity: 'block', scope: { channels: ['rsa'] }, type: 'length', params: { field: 'description', max: 90 },
      message: 'Description is {len} characters. Google allows {max}.', fix: 'Cut to {max} or fewer.' },
    { id: 'FMT-RSA-COUNT', category: 'length', severity: 'warn', scope: { channels: ['rsa'] }, type: 'count', params: { headline: 3, description: 2 },
      message: 'Found {have}. A responsive search ad needs at least 3 headlines and 2 descriptions.', fix: 'Add assets. 8 to 10 headlines give Google room to test.' },
    { id: 'FMT-RSA-LABEL', category: 'length', severity: 'warn', weight: 5, scope: { channels: ['rsa'] }, type: 'unlabelled', params: {},
      message: '{n} line(s) had no H: or D: prefix and were read as headlines.', fix: 'Start each line with H: or D:.' },
    { id: 'FMT-RSA-EXCLAIM', category: 'length', severity: 'block', scope: { channels: ['rsa'] }, type: 'field-regex', params: { field: 'headline', pattern: '!' },
      message: 'Exclamation mark in a headline. Google Ads editorial policy disapproves these.', fix: 'Remove it. One is allowed in a description.' },
    { id: 'LEN-META-PRIMARY', category: 'length', severity: 'warn', scope: { channels: ['meta'] }, type: 'length', params: { field: 'primary', max: 125 },
      message: 'Primary text is {len} characters. Meta truncates after about {max} on most placements.', fix: 'Put the point in the first {max} characters.' },
    { id: 'LEN-META-HEAD', category: 'length', severity: 'warn', scope: { channels: ['meta'] }, type: 'length', params: { field: 'headline', max: 40 },
      message: 'Headline is {len} characters. Meta recommends {max}.', fix: 'Cut to {max} or fewer.' },
    { id: 'LEN-LI-MAX', category: 'length', severity: 'block', scope: { channels: ['linkedin'] }, type: 'length', params: { field: 'body', max: 3000 },
      message: 'Post is {len} characters. LinkedIn rejects posts over {max}.', fix: 'Cut it, or split it into two posts.' },
    { id: 'LEN-LI-HOOK', category: 'length', severity: 'warn', scope: { channels: ['linkedin'] }, type: 'hook', params: { max: 150 },
      message: 'First line is {len} characters. LinkedIn shows about {max} before "see more".', fix: 'Land the hook in the first line, then break.' },
    { id: 'FMT-EMAIL-SUBJ', category: 'length', severity: 'warn', scope: { channels: ['email'] }, type: 'required', params: { field: 'subject' },
      message: 'No subject line found.', fix: 'Add a line that starts with Subject:.' },
    { id: 'LEN-EMAIL-SUBJ', category: 'length', severity: 'warn', scope: { channels: ['email'] }, type: 'length', params: { field: 'subject', max: 60 },
      message: 'Subject is {len} characters. Most inboxes cut it around {max}.', fix: 'Cut to {max} or fewer. Lead with the benefit.' },
    { id: 'FMT-EMAIL-PRE', category: 'length', severity: 'info', scope: { channels: ['email'] }, type: 'required', params: { field: 'preheader' },
      message: 'No preheader. Inboxes will show the first body line instead.', fix: 'Add a line that starts with Preheader:.' },
    { id: 'LEN-EMAIL-PRE', category: 'length', severity: 'warn', weight: 5, scope: { channels: ['email'] }, type: 'length', params: { field: 'preheader', max: 110 },
      message: 'Preheader is {len} characters. Inboxes rarely show more than {max}.', fix: 'Cut to {max} or fewer.' },

    // ---- 2. Tone of voice ----
    { id: 'TOV-HYPE', category: 'tone', severity: 'warn', weight: 8, type: 'phrase',
      params: { terms: ['revolution*', 'game-chang*', 'game chang*', 'seamless*', 'unlock*', 'supercharg*', 'best-in-class', 'cutting-edge', 'world-class', 'next-gen*', 'disrupt*', 'effortless*', 'synerg*', 'leverag*', 'empower*', 'robust', 'innovative', 'powerful', 'magic*', 'skyrocket*'] },
      message: 'Hype words the brand voice bans: {terms}.', fix: 'Say what the product does. "Seamless setup" becomes "Set up in a day".' },
    { id: 'TOV-PUSHY', category: 'tone', severity: 'warn', weight: 8, type: 'phrase',
      params: { terms: ['act now', 'buy now', 'limited time', "don't miss out", 'don’t miss out', 'hurry', 'last chance', "you won't believe", 'click here'] },
      message: 'Pressure phrasing: {terms}.', fix: 'Give a reason to act, not a deadline.' },
    { id: 'TOV-CUSTOM', category: 'tone', severity: 'warn', weight: 8, type: 'phrase', params: { terms: [] },
      message: 'Custom banned words: {terms}.', fix: 'Remove or rephrase.' },
    { id: 'TOV-EXCLAIM', category: 'tone', severity: 'warn', weight: 6, type: 'exclaim', params: { max: 1 },
      message: '{n} exclamation marks. The brand voice allows {max}.', fix: 'Keep one at most. Let the claim do the work.' },
    { id: 'TOV-CAPS', category: 'tone', severity: 'warn', weight: 6, type: 'caps',
      params: { minLen: 3, allow: ['GDPR', 'SEPA', 'IBAN', 'HMRC', 'FSCS', 'FDIC', 'DATEV', 'CFO', 'CFOS', 'CEO', 'VAT', 'API', 'ERP', 'FCA', 'FTC', 'APR', 'USD', 'EUR', 'GBP', 'SOC', 'PCI', 'DSS', 'ISO', 'IEC', 'SME', 'SMES', 'UWG', 'AGB', 'FAQ', 'CSV', 'SAAS', 'B2B', 'ATM', 'AML', 'KYC', 'POS'] },
      message: 'Words in capitals: {terms}.', fix: 'Use sentence case. Capitals read as shouting and Google flags them.' },
    { id: 'TOV-EMOJI', category: 'tone', severity: 'warn', weight: 6, type: 'regex', params: { pattern: '\\p{Extended_Pictographic}', flags: 'gu' },
      message: 'Emoji in copy. The brand voice does not use them.', fix: 'Remove them.' },
    { id: 'TOV-LONG-SENT', category: 'tone', severity: 'warn', weight: 6, type: 'sentence-length', params: { max: 25 },
      message: '{n} sentence(s) over {max} words.', fix: 'Split it. One idea per sentence.' },
    { id: 'TOV-PASSIVE', category: 'tone', severity: 'info', type: 'regex',
      params: { pattern: "\\b(?:is|are|was|were|be|been|being|gets?|got)\\s+(?:\\w+ly\\s+)?(?:\\w+ed|known|done|made|given|taken|seen|built|paid|sent|spent|kept|held|shown|chosen)\\b", flags: 'gi' },
      message: 'Possible passive voice: {terms}.', fix: 'Name who acts: "Fernway matches receipts", not "receipts are matched".' },
    { id: 'TOV-READABILITY', category: 'tone', severity: 'warn', weight: 8, type: 'flesch', params: { min: 50, minWords: 30 },
      message: 'Flesch reading ease is {score}. Target is {min} or higher.', fix: 'Shorter sentences, shorter words.' },
    { id: 'TOV-PERSON', category: 'tone', severity: 'warn', weight: 6, type: 'person', params: { minPronouns: 3 },
      message: 'Says we/our {we} times and you/your {you} times.', fix: 'Write to the reader. "We offer" becomes "You get".' },

    // ---- 3. Claims register ----
    { id: 'CLM-OK', category: 'claims', severity: 'info', type: 'claim-outcome', params: { outcome: 'ok' },
      message: 'Matches approved claim {ev}: "{claim}".', fix: 'Keep the evidence ID with the asset.' },
    { id: 'CLM-UNSUB', category: 'claims', severity: 'block', type: 'claim-outcome', params: { outcome: 'unsub' },
      message: 'Unsubstantiated claim: "{snippet}" matches nothing in the claims register.', fix: 'Use an approved claim word for word, or file evidence and get it added.' },
    { id: 'CLM-ALTERED', category: 'claims', severity: 'block', type: 'claim-outcome', params: { outcome: 'altered' },
      message: 'Altered claim: close to {ev} ("{claim}") but the copy says {got}, the register says {want}.', fix: 'Use the approved number: {want}.' },
    { id: 'CLM-QUALIFIER', category: 'claims', severity: 'warn', weight: 12, type: 'claim-outcome', params: { outcome: 'qualifier' },
      message: '{ev} is approved only with "{q}". The copy drops it.', fix: 'Put "{q}" back: "{claim}".' },
    { id: 'CLM-RETIRED', category: 'claims', severity: 'block', type: 'claim-outcome', params: { outcome: 'retired' },
      message: 'Retired claim {ev} ("{claim}"): {why}.', fix: 'Use the current claim instead.' },
    { id: 'CLM-MARKET', category: 'claims', severity: 'block', type: 'claim-outcome', params: { outcome: 'market' },
      message: '{ev} ("{claim}") is approved for {markets} only, not {market}.', fix: 'Drop the claim for this market.' },
    { id: 'CLM-SUPERLATIVE', category: 'claims', severity: 'block', type: 'superlative',
      params: { terms: ['#1', 'no. 1', 'no 1', 'nr. 1', 'number one', 'number 1', 'market leader', 'market-leading', 'marktführer', 'industry-leading', 'leading', 'the best', 'the fastest', 'the cheapest', 'the only', 'the easiest', 'most trusted', 'most popular'] },
      message: '"{term}" is a superlative or sole-position claim with no register entry. {basis}', fix: 'Remove it, or file the evidence and add it to the register first.' },

    // ---- 4. Competitors ----
    { id: 'CMP-MENTION', category: 'competitor', severity: 'warn', weight: 15, type: 'competitor', params: {},
      message: 'Names a competitor: {terms}. Competitor mentions go to a human.', fix: 'Remove the name unless the brief calls for it.' },
    { id: 'CMP-COMPARE', category: 'competitor', severity: 'block', type: 'comparative',
      params: { terms: ['cheaper than', 'better than', 'faster than', 'easier than', 'simpler than', 'unlike', 'beats?', 'outperform*', 'vs', 'vs.', 'versus', 'compared to', 'compared with', 'instead of', 'günstiger als', 'besser als', 'schneller als'] },
      message: 'Compares directly with {comp} ("{term}"). {basis}', fix: 'Drop the comparison, or use an approved comparative claim from the register.' },
    { id: 'CMP-DISPARAGE', category: 'competitor', severity: 'block', type: 'disparage',
      params: { terms: ['clunky', 'outdated', 'terrible', 'awful', 'overpriced', 'useless', 'broken', 'rip-off', 'ripoff', 'scam', 'slow'] },
      message: 'Disparages {comp} ("{term}"). Not allowed in any market.', fix: 'Talk about what Fernway does, not what they do badly.' },

    // ---- 5. Regulated language ----
    { id: 'UK-FCA-ABSOLUTE', category: 'regulated', severity: 'block', scope: { markets: ['UK'] }, type: 'phrase',
      params: { terms: ['risk-free', 'risk free', 'no risk', 'guarantee*', "can't lose", 'completely safe'] },
      message: 'FCA: communications must be fair, clear and not misleading. "{terms}" overstates certainty.', fix: 'Say what is actually protected, e.g. "funds are safeguarded in a segregated account".' },
    { id: 'UK-CREDIT-REP', category: 'regulated', severity: 'block', scope: { markets: ['UK'] }, type: 'phrase',
      params: { terms: ['interest', 'interest-free', 'apr'], unless: 'representative (?:example|apr)', unlessScope: 'text' },
      message: 'Mentions {terms} with no representative example. Credit promotions that quote a rate need one (FCA CONC 3.5).', fix: 'Add the representative example, or remove the rate.' },
    { id: 'UK-FSCS', category: 'regulated', severity: 'block', scope: { markets: ['UK'] }, type: 'phrase',
      params: { terms: ['fscs*', 'deposit protection', 'protected up to'] },
      message: 'Fernway (fictional) issues e-money. E-money is safeguarded, not covered by the FSCS.', fix: 'Say "funds are safeguarded", never "FSCS protected".' },
    { id: 'DE-ABSOLUTE', category: 'regulated', severity: 'block', scope: { markets: ['DE'] }, type: 'phrase',
      params: { terms: ['risikofrei', 'risk-free', 'risk free', 'ohne risiko', 'garantiert', 'guarantee*'] },
      message: 'UWG §5: misleading statements are unfair. "{terms}" promises a certainty you cannot prove.', fix: 'State the concrete term instead, e.g. "cancel monthly".' },
    { id: 'DE-FREE', category: 'regulated', severity: 'warn', weight: 12, scope: { markets: ['DE'] }, type: 'phrase',
      params: { terms: ['kostenlos', 'gratis', 'umsonst', 'free'], unless: '\\*|zzgl|nur |für die ersten|for the first|then |after |danach|terms apply|agb|conditions', unlessScope: 'sentence' },
      message: '"{terms}" without its conditions next to it. UWG §5a and Annex no. 21 treat hidden costs on free offers as misleading.', fix: 'Name the condition in the same sentence, e.g. "free for the first 3 cards".' },
    { id: 'US-FREE', category: 'regulated', severity: 'warn', weight: 12, scope: { markets: ['US'] }, type: 'phrase',
      params: { terms: ['free'], unless: '\\*|no credit card|terms apply|for the first|then \\$|conditions|no strings', unlessScope: 'sentence' },
      message: '"free" without stated terms. If any condition applies, the FTC guide on "free" (16 CFR 251) wants it disclosed up front.', fix: 'State the terms next to the offer, e.g. "free for the first 5 cards".' },
    { id: 'US-SUBSTANTIATION', category: 'regulated', severity: 'block', scope: { markets: ['US'] }, type: 'phrase',
      params: { terms: ['proven', 'clinically', 'scientifically', 'studies show', 'research shows', 'guaranteed results'] },
      message: 'FTC: objective claims need a reasonable basis before they run. "{terms}" implies evidence the register does not hold.', fix: 'Remove it, or cite a register claim.' },
    { id: 'US-GUARANTEE', category: 'regulated', severity: 'warn', weight: 12, scope: { markets: ['US'] }, type: 'phrase',
      params: { terms: ['guarantee*'] },
      message: '"{terms}": a guarantee needs its terms disclosed (16 CFR 239).', fix: 'Link the guarantee terms, or drop the word.' },
    { id: 'US-FDIC', category: 'regulated', severity: 'block', scope: { markets: ['US'] }, type: 'phrase',
      params: { terms: ['fdic*', 'federally insured'] },
      message: 'Misrepresenting FDIC insurance is prohibited (12 CFR 328, subpart B). Fernway (fictional) is not a bank.', fix: 'Remove it. Only a partner bank disclosure, approved by legal, can mention FDIC.' },
    { id: 'SEC-VAGUE', category: 'regulated', severity: 'warn', weight: 12, type: 'phrase',
      params: { terms: ['bank-grade', 'bank grade', 'bank-level', 'military-grade', 'enterprise-grade', 'gdpr compliant', 'gdpr-compliant', 'fully compliant'] },
      message: '"{terms}" is a security or compliance claim with no evidence attached.', fix: 'GDPR has no certificate. Say what you do: "EU data residency, DPA on request". Cite EV-060 for ISO 27001.' },
    { id: 'SEC-ABSOLUTE', category: 'regulated', severity: 'block', type: 'phrase',
      params: { terms: ['100% secure', 'unhackable', 'completely secure', 'fully secure', 'totally secure', 'never be hacked'] },
      message: '"{terms}" is an absolute security claim. No evidence can support it.', fix: 'Name the control instead: "ISO/IEC 27001 certified (EV-060)".' },
    { id: 'SEC-CERT', category: 'regulated', severity: 'block', type: 'cert',
      params: { certs: { 'iso/iec 27001': 'EV-060', 'iso 27001': 'EV-060', 'soc 2': null, 'soc2': null, 'pci dss': null, 'pci-dss': null } },
      message: 'Names certification "{term}" with no evidence in the register.', fix: 'Remove it until the certificate is filed.' },
  ];

  // ---------- text helpers ----------
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const termRe = (terms) => {
    const parts = terms.filter(Boolean).map((t) => reEsc(String(t).toLowerCase()).replace(/\\\*/g, '[\\w-]*').replace(/\\\?$/, '?').replace(/s\\\?/g, 's?'));
    if (!parts.length) return null;
    parts.sort((a, b) => b.length - a.length);
    return new RegExp('(?<![\\w#])(?:' + parts.join('|') + ')(?![\\w])', 'gi');
  };
  const fill = (tpl, v) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
  const WORD_RE = /[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’-]*/g;
  const STOP = new Set('a an the of on in by to for and or with your you our we us is are up under no across per every it its at as from than more that this be get can out all one each just'.split(' '));
  const stem = (w) => {
    w = w.toLowerCase().replace(/['’]s$/, '');
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  };
  // Words every Fernway line uses carry no signal for matching a claim, so they don't count as overlap.
  const GENERIC = new Set(['card', 'spend', 'team', 'finance', 'expense', 'fernway']);
  const tokens = (s) => (s.match(WORD_RE) || []).filter((w) => !/^\d/.test(w)).map(stem).filter((w) => !STOP.has(w) && !GENERIC.has(w));
  const syllables = (w) => {
    w = w.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const m = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
  };
  const fnv1a = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };

  // ---------- parsing ----------
  // Fields keep absolute offsets into the original text. `masked` blanks out "H:"-style prefixes
  // (same length), so every matcher can scan one string and report spans the UI can highlight.
  const parse = (text, channel) => {
    const ch = CHANNELS[channel];
    const groups = [];
    const chars = text.split('');
    let unlabelled = 0;
    let pos = 0;
    for (const line of text.split('\n')) {
      const start = pos;
      pos += line.length + 1;
      if (!line.trim()) continue;
      const m = line.match(/^\s*([A-Za-z]+)\s*:\s*/);
      const kind = m && ch.prefixes[m[1].toLowerCase()];
      let cs = start;
      if (kind) {
        for (let i = start; i < start + m[0].length; i++) chars[i] = ' ';
        cs = start + m[0].length;
      } else {
        while (cs < start + line.length && /\s/.test(text[cs])) cs++;
      }
      const ce = start + line.replace(/\s+$/, '').length;
      const prev = groups[groups.length - 1];
      if (!kind && prev && ch.multi.includes(prev.kind)) { prev.end = ce; continue; }
      if (!kind && channel === 'rsa') unlabelled++;
      groups.push({ kind: kind || ch.fallback, start: cs, end: Math.max(cs, ce) });
    }
    groups.forEach((g) => { g.text = text.slice(g.start, g.end); });
    return { groups, masked: chars.join(''), unlabelled };
  };

  const sentences = (masked) => {
    const out = [];
    let s = 0;
    const push = (a, b) => {
      while (a < b && /\s/.test(masked[a])) a++;
      while (b > a && /\s/.test(masked[b - 1])) b--;
      if (b > a) out.push({ start: a, end: b, text: masked.slice(a, b) });
    };
    for (let i = 0; i < masked.length; i++) {
      const c = masked[i];
      if (c === '\n') { push(s, i); s = i + 1; }
      else if ('.!?'.includes(c) && (i + 1 >= masked.length || /\s/.test(masked[i + 1]))) { push(s, i + 1); s = i + 1; }
    }
    push(s, masked.length);
    return out;
  };
  const sentenceAt = (sents, idx) => sents.find((x) => idx >= x.start && idx < x.end) || { start: 0, end: 0, text: '' };

  // ---------- claims ----------
  const CLAIM_NOUN = /^(?:hours?|minutes?|seconds?|compan(?:y|ies)|customers?|businesses|teams?|users?|countries|currencies|reviews?|reviewers|faster|quicker|cheaper|less|fewer|more|saved?|savings|times|cashback|markup)$/i;
  const NUM_RE = /([€£$]\s?)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(\s?%|\s?x(?![a-z])|k(?![a-z])|m(?![a-z]))?(\+)?/gi;
  const numValue = (raw, suffix) => {
    let v = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? +raw.replace(/[.,]/g, '') : +raw.replace(',', '.');
    const s = (suffix || '').trim().toLowerCase();
    if (s === 'k') v *= 1e3;
    if (s === 'm') v *= 1e6;
    return v;
  };
  const claimNumbers = (masked) => {
    const out = [];
    NUM_RE.lastIndex = 0;
    let m;
    while ((m = NUM_RE.exec(masked))) {
      const s = m.index, e = s + m[0].length;
      const before = masked.slice(Math.max(0, s - 9), s);
      if (/[A-Za-z#/:]$/.test(before) || /^[/:]/.test(masked.slice(e, e + 1))) continue;
      if (/(?:no\.?|nr\.?|number|iso|iec|level)\s?$/i.test(before)) continue;
      const v = numValue(m[2], m[3]);
      if (!m[1] && !m[3] && !m[4] && /^(19|20)\d\d$/.test(m[2])) continue;
      const next = (masked.slice(e, e + 40).match(WORD_RE) || []).slice(0, 3);
      const marked = !!(m[1] || m[3] || m[4]);
      if (!marked && !next.some((w) => CLAIM_NOUN.test(w))) continue;
      out.push({ start: s, end: e, raw: m[0].trim(), value: v });
    }
    return out;
  };
  const matchRegister = (sentence, numbers) => {
    const toks = new Set(tokens(sentence));
    let best = null;
    for (const r of REGISTER) {
      const rt = [...new Set(tokens(r.claim))];
      const shared = rt.filter((t) => toks.has(t)).length;
      const ratio = rt.length ? shared / rt.length : 0;
      const numMatch = numbers.length > 0 && numbers.every((n) => r.numbers.includes(n));
      const topical = shared >= 2 && ratio >= 0.4;
      if (!(topical || (numMatch && shared >= 1))) continue;
      const score = shared + ratio + (numMatch ? 2 : 0);
      if (!best || score > best.score) best = { entry: r, score, ratio, numMatch };
    }
    return best;
  };

  // ---------- engine ----------
  const inScope = (rule, channel, market) => {
    const s = rule.scope || {};
    return (!s.channels || s.channels.includes(channel)) && (!s.markets || s.markets.includes(market));
  };
  const activeRules = (channel, market) => RULES.filter((r) => inScope(r, channel, market));

  const run = (input) => {
    const text = String(input.text || '').replace(/\r\n?/g, '\n');
    const channel = CHANNELS[input.channel] ? input.channel : 'rsa';
    const market = MARKETS[input.market] ? input.market : 'UK';
    const threshold = Number.isFinite(+input.threshold) ? +input.threshold : 20;
    const custom = (input.customBanned || []).map((w) => String(w).trim()).filter(Boolean);
    const { groups, masked, unlabelled } = parse(text, channel);
    const sents = sentences(masked);
    const words = masked.match(WORD_RE) || [];
    const findings = [];
    const add = (rule, spans, vars, extra) => {
      const severity = (extra && extra.severity) || rule.severity;
      findings.push({
        rule: rule.id, category: rule.category, severity,
        message: fill(rule.message, vars || {}), fix: fill(rule.fix, vars || {}),
        spans: spans || [], count: (vars && vars.count) || 1,
        weight: severity === 'info' ? 0 : severity === rule.severity && rule.weight != null ? rule.weight : WEIGHT[severity],
        evidence: (extra && extra.evidence) || null,
      });
    };
    const phraseHits = (re, unless, unlessScope) => {
      if (!re) return [];
      const hits = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(masked))) {
        if (!m[0]) { re.lastIndex++; continue; }
        if (unless) {
          const hay = unlessScope === 'text' ? masked : sentenceAt(sents, m.index).text;
          if (new RegExp(unless, 'i').test(hay)) continue;
        }
        hits.push({ start: m.index, end: m.index + m[0].length, term: m[0] });
      }
      return hits;
    };
    const aggregate = (rule, hits, vars) => {
      if (!hits.length) return;
      const seen = new Map();
      hits.forEach((h) => { if (!seen.has(h.term.toLowerCase())) seen.set(h.term.toLowerCase(), h.term); });
      const terms = [...seen.values()].join(', ');
      add(rule, hits.map((h) => [h.start, h.end]), Object.assign({ terms, n: hits.length, count: hits.length }, vars));
    };
    const compSpans = [];
    if (text.trim()) {
      const compRe = termRe(COMPETITORS);
      compRe.lastIndex = 0;
      let m;
      while ((m = compRe.exec(masked))) compSpans.push({ start: m.index, end: m.index + m[0].length, term: m[0] });
    }
    const compName = (t) => COMPETITORS.find((c) => c.toLowerCase() === t.toLowerCase()) || t;
    const sentNums = (sent) => claimNumbers(masked).filter((n) => n.start >= sent.start && n.end <= sent.end).map((n) => n.value);
    const fieldsOf = (kind) => groups.filter((g) => g.kind === kind);

    for (const rule of activeRules(channel, market)) {
      if (!text.trim()) break;
      const p = rule.params || {};
      switch (rule.type) {
        case 'length':
          for (const g of fieldsOf(p.field)) {
            const len = Array.from(g.text).length;
            if (len > p.max) add(rule, [[g.start + p.max, g.end]], { len, max: p.max });
          }
          break;
        case 'count': {
          const h = fieldsOf('headline').length, d = fieldsOf('description').length;
          if (h < p.headline || d < p.description) add(rule, [], { have: `${h} headline(s) and ${d} description(s)` });
          break;
        }
        case 'unlabelled':
          if (unlabelled) add(rule, [], { n: unlabelled });
          break;
        case 'field-regex': {
          const hits = [];
          for (const g of fieldsOf(p.field)) {
            const re = new RegExp(p.pattern, 'g');
            let m;
            while ((m = re.exec(g.text))) hits.push({ start: g.start + m.index, end: g.start + m.index + m[0].length, term: m[0] });
          }
          aggregate(rule, hits);
          break;
        }
        case 'hook': {
          const g = groups[0];
          if (!g) break;
          const nl = g.text.indexOf('\n');
          const first = nl < 0 ? g.text : g.text.slice(0, nl);
          const len = first.trim().length;
          if (len > p.max) add(rule, [[g.start + p.max, g.start + first.length]], { len, max: p.max });
          break;
        }
        case 'required':
          if (!fieldsOf(p.field).length) add(rule, [], {});
          break;
        case 'phrase': {
          const terms = rule.id === 'TOV-CUSTOM' ? custom : p.terms;
          aggregate(rule, phraseHits(termRe(terms), p.unless, p.unlessScope));
          break;
        }
        case 'regex': {
          const re = new RegExp(p.pattern, p.flags);
          aggregate(rule, phraseHits(re));
          break;
        }
        case 'exclaim': {
          const hits = phraseHits(/!/g);
          if (hits.length > p.max) add(rule, hits.map((h) => [h.start, h.end]), { n: hits.length, max: p.max, count: hits.length - p.max });
          break;
        }
        case 'caps': {
          const allow = new Set(p.allow);
          const re = new RegExp(`\\b[A-ZÄÖÜ]{${p.minLen},}\\b`, 'g');
          aggregate(rule, phraseHits(re).filter((h) => !allow.has(h.term) && h.term !== BRAND.toUpperCase()));
          break;
        }
        case 'sentence-length': {
          const long = sents.filter((s) => (s.text.match(WORD_RE) || []).length > p.max);
          if (long.length) add(rule, long.map((s) => [s.start, s.end]), { n: long.length, max: p.max, count: long.length });
          break;
        }
        case 'flesch': {
          if (words.length < p.minWords) break;
          const score = flesch(words, sents.length);
          if (score < p.min) add(rule, [], { score: Math.round(score), min: p.min });
          break;
        }
        case 'person': {
          const { you, we } = person(words);
          if (you + we >= p.minPronouns && we > you) add(rule, [], { you, we });
          break;
        }
        case 'claim-outcome':
          break; // handled once below, after the loop
        case 'superlative': {
          for (const h of phraseHits(termRe(p.terms))) {
            const sent = sentenceAt(sents, h.start).text;
            const hit = matchRegister(sent, []);
            if (hit && hit.ratio >= 0.6 && !hit.entry.retired && hit.entry.markets.includes(market)) continue;
            add(rule, [[h.start, h.end]], { term: h.term, basis: MARKETS[market].basis.superlative });
          }
          break;
        }
        case 'competitor':
          aggregate(rule, compSpans.map((c) => Object.assign({}, c, { term: compName(c.term) })));
          break;
        case 'comparative':
        case 'disparage': {
          const re = termRe(p.terms);
          for (const c of compSpans) {
            const sent = sentenceAt(sents, c.start);
            const local = phraseHits(re).filter((h) => h.start >= sent.start && h.end <= sent.end);
            if (!local.length) continue;
            const comp = compName(c.term);
            const h = local[0];
            if (rule.type === 'comparative') {
              const backed = REGISTER.find((r) => r.competitor === comp && !r.retired && r.markets.includes(market) && strong(matchRegister(sent.text, sentNums(sent)), r));
              if (backed) {
                add(Object.assign({}, rule, { message: 'Comparative claim against {comp} is backed by {ev}. Legal still signs off comparative ads.', fix: 'Send to legal with {ev} attached.' }),
                  [[h.start, h.end]], { comp, ev: backed.id }, { severity: 'warn', evidence: backed.id });
                continue;
              }
              add(rule, [[h.start, h.end], [c.start, c.end]], { comp, term: h.term, basis: MARKETS[market].basis.comparative });
            } else {
              add(rule, [[h.start, h.end]], { comp, term: h.term });
            }
          }
          break;
        }
        case 'cert': {
          const re = termRe(Object.keys(p.certs));
          for (const h of phraseHits(re)) {
            const ev = p.certs[h.term.toLowerCase()];
            if (ev) {
              const r = REGISTER.find((x) => x.id === ev);
              add(ruleById('CLM-OK'), [[h.start, h.end]], { ev, claim: r.claim }, { evidence: ev });
            } else add(rule, [[h.start, h.end]], { term: h.term });
          }
          break;
        }
      }
    }

    if (text.trim()) claimsPass(masked, sents, market, add);

    const blocks = findings.filter((f) => f.severity === 'block');
    const warns = findings.filter((f) => f.severity === 'warn');
    const score = Math.min(100, findings.reduce((a, f) => a + f.weight * Math.min(f.count || 1, 3), 0));
    let verdict, reason;
    if (!text.trim()) { verdict = 'empty'; reason = 'Paste or write copy to run the gate.'; }
    else if (blocks.length) {
      verdict = 'block';
      reason = blocks[0].message + (blocks.length > 1 ? ` Plus ${blocks.length - 1} more blocking finding${blocks.length > 2 ? 's' : ''}.` : '');
    } else if (score >= threshold) {
      verdict = 'review';
      const top = warns.slice().sort((a, b) => b.weight - a.weight).slice(0, 2).map((f) => f.rule).join(', ');
      reason = `Risk score ${score} is at or above the auto-approve threshold of ${threshold}. Biggest contributors: ${top}.`;
    } else {
      verdict = 'approve';
      reason = warns.length
        ? `Risk score ${score} is under the threshold of ${threshold}. ${warns.length} warning${warns.length > 1 ? 's' : ''} logged, none blocking.`
        : `No blocking or warning findings. Risk score ${score}, threshold ${threshold}.`;
    }
    const { you, we } = person(words);
    const order = { block: 0, warn: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.spans[0] ? a.spans[0][0] : 1e9) - (b.spans[0] ? b.spans[0][0] : 1e9));
    findings.forEach((f, i) => { f.id = 'f' + i; });
    return {
      verdict, reason, score, threshold, channel, market, findings, groups,
      stats: { words: words.length, sentences: sents.length, flesch: words.length ? Math.round(flesch(words, sents.length)) : null, you, we },
      ledger: {
        ruleset: RULESET, draft_hash: 'fnv1a:' + fnv1a(text), channel, market,
        decision: verdict, risk_score: score, threshold,
        findings: findings.map((f) => f.rule + (f.evidence ? ':' + f.evidence : '') + ':' + f.severity),
      },
    };
  };

  const strong = (hit, r) => !!hit && hit.entry === r && hit.ratio >= 0.6 && (!r.numbers.length || hit.numMatch);
  const ruleById = (id) => RULES.find((r) => r.id === id);
  const flesch = (words, nSent) => {
    const syl = words.reduce((a, w) => a + syllables(w), 0);
    return 206.835 - 1.015 * (words.length / Math.max(1, nSent)) - 84.6 * (syl / words.length);
  };
  const person = (words) => {
    let you = 0, we = 0;
    for (const w of words) {
      const l = w.toLowerCase();
      if (/^(you|your|yours|you're|you’re|you'll|you’ll)$/.test(l)) you++;
      else if (/^(we|our|ours|us|we're|we’re|we'll|we’ll)$/.test(l)) we++;
    }
    return { you, we };
  };

  // A sentence can carry several claims ("save 15 hours, and 0% interest"), so each number is
  // matched against its own clause, not the whole sentence.
  const clauseAt = (masked, s, idx) => {
    const rel = idx - s.start;
    const parts = s.text.split(/(,|;|:| and | but | - | – | — )/);
    let pos = 0;
    for (const part of parts) {
      if (rel >= pos && rel < pos + part.length) return part.trim();
      pos += part.length;
    }
    return s.text;
  };
  const claimsPass = (masked, sents, market, add) => {
    const nums = claimNumbers(masked);
    for (const s of sents) {
      const inS = nums.filter((n) => n.start >= s.start && n.end <= s.end);
      if (!inS.length) continue;
      for (const n of inS) {
        const cl = clauseAt(masked, s, n.start);
        const hit = matchRegister(cl, inS.filter((x) => clauseAt(masked, s, x.start) === cl).map((x) => x.value));
        const span = [[n.start, n.end]];
        const snippet = cl.length > 70 ? cl.slice(0, 67) + '…' : cl;
        if (!hit) { add(ruleById('CLM-UNSUB'), span, { snippet }); continue; }
        const r = hit.entry;
        const v = { ev: r.id, claim: r.claim };
        if (!r.numbers.includes(n.value)) {
          add(ruleById('CLM-ALTERED'), span, Object.assign(v, { got: n.raw, want: r.numbers.map((x) => x.toLocaleString('en-GB')).join(', ') }), { evidence: r.id });
        } else if (r.retired) add(ruleById('CLM-RETIRED'), span, Object.assign(v, { why: r.retired }), { evidence: r.id });
        else if (!r.markets.includes(market)) add(ruleById('CLM-MARKET'), span, Object.assign(v, { markets: r.markets.join(', '), market }), { evidence: r.id });
        else if (r.qualifier && !new RegExp('\\b' + reEsc(r.qualifier) + '\\b', 'i').test(cl)) add(ruleById('CLM-QUALIFIER'), span, Object.assign(v, { q: r.qualifier }), { evidence: r.id });
        else add(ruleById('CLM-OK'), span, v, { evidence: r.id });
      }
    }
  };

  const SAMPLES = [
    {
      id: 'pass', label: 'Passes', channel: 'rsa', market: 'UK',
      text: [
        'H: Expense cards for every team',
        'H: Used by 40,000+ companies',
        'H: Receipts matched for you',
        'H: Set card limits in two clicks',
        'D: Save up to 10 hours a month on expense reports. Give each team its own card.',
        'D: Issue cards in minutes and see every payment as it happens.',
      ].join('\n'),
    },
    {
      id: 'review', label: 'Needs review', channel: 'meta', market: 'US',
      text: [
        'Primary: Switching from SpendHive? Move your cards and policies over in a day, with seamless setup and a free onboarding call.',
        'Headline: Expense cards your team will use',
      ].join('\n'),
    },
    {
      id: 'block', label: 'Blocks', channel: 'email', market: 'UK',
      text: [
        'Subject: The #1 expense card for finance teams. Guaranteed.',
        'Preheader: Cheaper than Ledgerly and risk-free!',
        'We built a revolutionary platform. Our customers save 15 hours a month on expense reports, and we offer 0% interest on card spend for 60 days.',
        'Our bank-grade security keeps every payment safe. ACT NOW!!',
      ].join('\n'),
    },
  ];

  const BATCH_SAMPLE = [
    'Give every team a card and see spend as it happens.',
    'Save up to 10 hours a month on expense reports.',
    'Save 20 hours a month on expense reports.',
    'Used by 40,000+ companies across Europe.',
    'Trusted by 25,000 companies.',
    'Unlock seamless spend control with our revolutionary cards!',
    'Fernway is cheaper than Ledgerly on list price for teams of 50 or more.',
    'Clearbook is clunky. Fernway is not.',
    'Receipts matched automatically in 92% of cases.',
    'The #1 expense card in Europe.',
    'Spend in 30+ currencies with no FX markup.',
    '1% cashback on card spend, risk-free.',
  ].join('\n');

  const api = { RULESET, BRAND, CHANNELS, MARKETS, COMPETITORS, REGISTER, RULES, SAMPLES, BATCH_SAMPLE, run, activeRules, parse, tokens, claimNumbers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClaimsGate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
