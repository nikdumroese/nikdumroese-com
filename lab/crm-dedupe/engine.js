// CRM dedupe engine: standardise → block → score → cluster → survive.
// Ports the normalisers and survivorship of crm-refine (github.com/nikdumroese/crm-refine) and adds
// person-level matching (Jaro-Winkler, nicknames, Cologne phonetics). No DOM; runs in Node for tests.
(() => {
  const WS = /\s+/g;
  const trim = (s) => String(s == null ? '' : s).replace(WS, ' ').trim();

  // ---------------------------------------------------------------- tables (from crm-refine/transforms.py)
  const DIAL = {
    US: '1', CA: '1', GB: '44', IE: '353', DE: '49', FR: '33', ES: '34', IT: '39', NL: '31', BE: '32',
    PT: '351', SE: '46', NO: '47', DK: '45', FI: '358', PL: '48', AT: '43', CH: '41', CZ: '420', AU: '61',
    NZ: '64', IN: '91', SG: '65', JP: '81', BR: '55', MX: '52', ZA: '27', AE: '971',
  };
  const NAME2ISO = {
    'united states': 'US', 'united states of america': 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', us: 'US', america: 'US',
    'united kingdom': 'GB', uk: 'GB', 'u.k.': 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', gb: 'GB', gbr: 'GB',
    germany: 'DE', deutschland: 'DE', de: 'DE', ger: 'DE', deu: 'DE', 'federal republic of germany': 'DE',
    france: 'FR', spain: 'ES', 'españa': 'ES', italy: 'IT', italia: 'IT', ireland: 'IE', netherlands: 'NL',
    holland: 'NL', 'the netherlands': 'NL', belgium: 'BE', portugal: 'PT', sweden: 'SE', norway: 'NO', denmark: 'DK',
    finland: 'FI', poland: 'PL', austria: 'AT', 'österreich': 'AT', switzerland: 'CH', schweiz: 'CH',
    australia: 'AU', 'new zealand': 'NZ', india: 'IN', singapore: 'SG', japan: 'JP', canada: 'CA',
  };
  const FREE_EMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
    'icloud.com', 'gmx.com', 'gmx.de', 'web.de', 'aol.com', 'proton.me', 'protonmail.com', 'yandex.com', 'mail.com', 't-online.de']);
  // crm-refine's _SUFFIXES plus German forms (kg, se, ug, mbh) seen in DACH exports.
  const SUFFIX = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
    'gmbh', 'ag', 'sa', 'sas', 'srl', 'bv', 'plc', 'lp', 'llp', 'group', 'holding', 'holdings', 'the',
    'kg', 'se', 'ug', 'mbh', 'kgaa', 'ohg', 'gbr']);
  const ACRONYMS = new Set(['llc', 'plc', 'gmbh', 'ag', 'srl', 'bv', 'nv', 'sa', 'sas', 'uk', 'usa', 'eu', 'uae', 'kg', 'se', 'ug', 'ai', 'it', 'hr', 'b2b', 'saas', 'iot']);
  const PARTICLES = new Set(['van', 'von', 'de', 'del', 'della', 'di', 'da', 'der', 'den', 'la', 'le', 'du', 'dos', 'das', 'bin', 'al', 'zu']);
  const HONORIFICS = /^(dr|prof|mr|mrs|ms|miss|herr|frau|dipl|ing)\.?$/i;

  // Partial nickname table: maps variants to one canonical first name. Extend for your market.
  const NICK_GROUPS = [
    ['robert', 'bob', 'bobby', 'rob', 'robbie', 'bert'], ['william', 'bill', 'billy', 'will', 'willy', 'liam'],
    ['richard', 'rick', 'ricky', 'dick', 'rich'], ['james', 'jim', 'jimmy', 'jamie'], ['john', 'johnny', 'jack'],
    ['michael', 'mike', 'mick', 'micky'], ['christopher', 'chris', 'kit'], ['thomas', 'tom', 'tommy'],
    ['daniel', 'dan', 'danny'], ['matthew', 'matt'], ['andrew', 'andy', 'drew'], ['anthony', 'tony'],
    ['joseph', 'joe', 'joey'], ['edward', 'ed', 'eddie', 'ted'], ['benjamin', 'ben', 'benny'],
    ['alexander', 'alex', 'sasha', 'xander'], ['nicholas', 'nick', 'nicky'], ['jonathan', 'jon'],
    ['samuel', 'sam', 'sammy'], ['steven', 'stephen', 'steve'], ['timothy', 'tim'], ['charles', 'charlie', 'chuck'],
    ['elizabeth', 'liz', 'lizzie', 'beth', 'betty', 'eliza', 'elisabeth', 'lisa'], ['katharina', 'katherine', 'catherine', 'kathrin', 'katrin', 'kate', 'katie', 'kathy', 'cathy', 'kat', 'kati'],
    ['margaret', 'maggie', 'meg', 'peggy'], ['jennifer', 'jen', 'jenny'], ['rebecca', 'becky', 'becca'],
    ['victoria', 'vicky', 'tori'], ['alexandra', 'alex', 'sandra'], ['susan', 'sue', 'susie'],
    ['patricia', 'pat', 'patty', 'trish'], ['deborah', 'deb', 'debbie'], ['christina', 'christine', 'tina', 'chrissy'],
    ['johannes', 'hannes', 'jo'], ['wolfgang', 'wolf'], ['friedrich', 'fritz'], ['maximilian', 'max'],
    ['sebastian', 'basti'], ['matthias', 'matze', 'mathias'], ['stefan', 'steffen'], ['tobias', 'tobi'],
    ['florian', 'flo'], ['dominik', 'dom'], ['jürgen', 'juergen', 'jurgen'], ['franziska', 'franzi'],
    ['susanne', 'susi', 'sanne'], ['johanna', 'hanna', 'hannah'], ['gabriele', 'gabi', 'gaby'], ['annika', 'anni'],
    ['julia', 'jule', 'julie'], ['charlotte', 'lotte', 'charlie'],
  ];
  const NICK = {};
  NICK_GROUPS.forEach((g) => g.forEach((n) => { const k = foldAscii(n); if (!(k in NICK)) NICK[k] = foldAscii(g[0]); }));

  // ---------------------------------------------------------------- string helpers
  function foldAscii(s) {
    return String(s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '');
  }
  const lettersOnly = (s) => foldAscii(s).replace(/[^a-z]/g, '');

  // crm-refine fingerprint(): lowercase, strip accents + punctuation, drop legal suffixes, sort unique tokens.
  function fingerprintTokens(s) {
    const toks = foldAscii(s).replace(/&/g, ' ').replace(/[^\w\s]/g, ' ').split(WS).filter(Boolean);
    const kept = toks.filter((t) => !SUFFIX.has(t));
    return [...new Set(kept.length ? kept : toks)].sort();
  }

  function jaroWinkler(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const la = a.length, lb = b.length, win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
    const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
    let m = 0;
    for (let i = 0; i < la; i++) {
      const lo = Math.max(0, i - win), hi = Math.min(lb - 1, i + win);
      for (let j = lo; j <= hi; j++) if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
    if (!m) return 0;
    let t = 0, k = 0;
    for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
    const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
    let p = 0;
    while (p < 4 && p < la && p < lb && a[p] === b[p]) p++;
    return jaro + p * 0.1 * (1 - jaro);
  }

  // Kölner Phonetik (Postel, 1969). Works on German spelling; weaker on English names.
  function cologne(s) {
    const w = foldAscii(s).toUpperCase().replace(/[^A-Z]/g, '');
    if (!w) return '';
    const out = [];
    for (let i = 0; i < w.length; i++) {
      const c = w[i], prev = w[i - 1] || '', next = w[i + 1] || '';
      let d = '';
      if ('AEIJOUY'.includes(c)) d = '0';
      else if (c === 'H') d = '';
      else if (c === 'B') d = '1';
      else if (c === 'P') d = next === 'H' ? '3' : '1';
      else if (c === 'D' || c === 'T') d = 'CSZ'.includes(next) && next ? '8' : '2';
      else if ('FVW'.includes(c)) d = '3';
      else if ('GKQ'.includes(c)) d = '4';
      else if (c === 'C') {
        if (i === 0) d = 'AHKLOQRUX'.includes(next) && next ? '4' : '8';
        else d = 'SZ'.includes(prev) ? '8' : ('AHKOQUX'.includes(next) && next ? '4' : '8');
      } else if (c === 'X') d = 'CKQ'.includes(prev) && prev ? '8' : '48';
      else if (c === 'L') d = '5';
      else if (c === 'M' || c === 'N') d = '6';
      else if (c === 'R') d = '7';
      else if (c === 'S' || c === 'Z') d = '8';
      out.push(d);
    }
    let code = '', last = '';
    out.join('').split('').forEach((d, i) => { if (d !== last) code += d; last = d; });
    return code ? code[0] + code.slice(1).replace(/0/g, '') : '';
  }

  // ---------------------------------------------------------------- column detection
  const FIELDS = ['id', 'first', 'last', 'full', 'email', 'phone', 'company', 'country', 'title', 'lifecycle', 'last_activity'];
  const FIELD_LABEL = {
    id: 'Record ID', first: 'First name', last: 'Last name', full: 'Full name', email: 'Email', phone: 'Phone',
    company: 'Company', country: 'Country', title: 'Job title', lifecycle: 'Lifecycle stage', last_activity: 'Last activity',
  };
  const DETECT = [
    ['id', /^(record|contact|row|hs_object|crm)?[\s_-]*id$/],
    ['first', /^(first|given|fore|vor)[\s_-]*name$|^first$|^vorname$/],
    ['last', /^(last|sur|family|nach)[\s_-]*name$|^surname$|^last$|^nachname$/],
    ['full', /^(full|contact|display)?[\s_-]*name$/],
    ['email', /e-?mail/],
    ['phone', /phone|mobile|tel|telefon|handy/],
    ['company', /company|organi[sz]ation|account|firma|employer/],
    ['country', /country|^land$|nation/],
    ['title', /title|job|position|role/],
    ['lifecycle', /lifecycle|stage|status/],
    ['last_activity', /last[\s_-]*(activity|contact|engagement|touch|modified|seen)|updated|modified/],
  ];
  function detectColumns(headers) {
    const map = {}, used = new Set();
    DETECT.forEach(([f, re]) => {
      const h = headers.find((x) => !used.has(x) && re.test(x.toLowerCase().trim()));
      if (h) { map[f] = h; used.add(h); }
    });
    return map;
  }

  // ---------------------------------------------------------------- standardisers
  function fixNameWord(w) {
    const lw = w.toLowerCase();
    if (w.includes('-')) return w.split('-').map(fixNameWord).join('-');
    if (lw.startsWith("o'") && w.length > 2) return "O'" + fixNameWord(w.slice(2));
    if (lw.startsWith('mc') && w.length > 2) return 'Mc' + w[2].toUpperCase() + w.slice(3).toLowerCase();
    if (lw.startsWith('mac') && w.length > 4 && !/^mac(h|k|e|i|o|y)/.test(lw)) return 'Mac' + w[3].toUpperCase() + w.slice(4).toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }
  // crm-refine op_namecase: Mc/Mac/O'/hyphen handling; particles (von, van, de) stay lower-case when a word follows.
  function namecase(v) {
    const ws = trim(v).split(' ').filter(Boolean);
    return ws.map((w, i) => (i < ws.length - 1 && PARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : fixNameWord(w))).join(' ');
  }
  function splitFull(full) {
    let s = trim(full);
    if (!s) return ['', ''];
    if (s.includes(',')) {
      const [l, f] = s.split(',');
      return [trim(f), trim(l)];
    }
    const toks = s.split(' ').filter((t) => !HONORIFICS.test(t));
    if (toks.length === 1) return ['', toks[0]];
    let k = toks.length - 1;
    while (k > 1 && PARTICLES.has(toks[k - 1].toLowerCase())) k--;
    return [toks.slice(0, k).join(' '), toks.slice(k).join(' ')];
  }

  function normEmail(v) {
    const e = trim(v).toLowerCase().replace(/\s/g, '').replace(/^mailto:/, '');
    if (!e) return { value: '', key: '', valid: true };
    const at = e.lastIndexOf('@');
    if (at < 1) return { value: e, key: e, valid: false };
    let local = e.slice(0, at), dom = e.slice(at + 1);
    local = local.split('+')[0];
    if (dom === 'googlemail.com') dom = 'gmail.com';
    const key = (dom === 'gmail.com' ? local.replace(/\./g, '') : local) + '@' + dom;
    const value = local + '@' + dom;
    return { value, key, valid: /^[a-z0-9._%\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(value) };
  }

  // crm-refine op_phone, extended: 00-prefix → +, "(0)" trunk marker dropped, default country fallback.
  function normPhone(v, iso) {
    const raw = trim(v);
    if (!raw) return { value: '', ok: true };
    let s = raw.replace(/\(0\)/g, '').replace(/(ext|x|durchwahl)\.?\s*\d+$/i, '');
    let digits = s.replace(/\D/g, '');
    if (digits.length < 6) return { value: raw, ok: false };
    if (/^\s*\+/.test(s)) return { value: '+' + digits, ok: true };
    if (digits.startsWith('00')) return { value: '+' + digits.slice(2), ok: true };
    const cc = DIAL[iso];
    if (!cc) return { value: raw, ok: false };
    if (cc === '1' && digits.length === 11 && digits[0] === '1') return { value: '+' + digits, ok: true };
    const national = digits.replace(/^0+/, '');
    return { value: '+' + cc + national, ok: true };
  }

  function companyCase(v) {
    return trim(v).split(' ').map((w) => {
      const core = w.replace(/[^\w]/g, '').toLowerCase();
      if (ACRONYMS.has(core)) return w.toUpperCase();
      if (w.length > 1 && w === w.toUpperCase() && w.length <= 4 && !/[aeiouäöü]/i.test(w)) return w; // keep short all-caps brands like "KPMG"
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }
  // Strip trailing legal forms ("GmbH & Co. KG", "Inc.", "Ltd") then fix casing.
  function normCompany(v) {
    let s = trim(v).replace(/\s*,\s*$/, '');
    if (!s) return '';
    const re = /[\s,]+(gmbh\s*&\s*co\.?\s*kg(aa)?|&\s*co\.?\s*kg|gmbh|ag|kg|se|ug(\s*\(haftungsbeschränkt\))?|ohg|inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|plc|corp\.?|corporation|co\.?|company|bv|b\.v\.|nv|sa|sas|srl)\s*$/i;
    let prev;
    do { prev = s; s = s.replace(re, '').replace(/[\s,]+$/, ''); } while (s !== prev && s);
    return companyCase(s || prev);
  }

  function normCountry(v) {
    const s = trim(v);
    if (!s) return '';
    const u = s.toUpperCase();
    if (u.length === 2 && (DIAL[u] || u === 'UK')) return u === 'UK' ? 'GB' : u;
    return NAME2ISO[s.toLowerCase().replace(/\s+/g, ' ')] || '';
  }

  const TITLE_CASE_KEEP = new Set(['vp', 'svp', 'evp', 'ceo', 'cfo', 'cmo', 'cro', 'coo', 'cto', 'cpo', 'seo', 'sem', 'b2b', 'b2c', 'hr', 'it', 'crm', 'abm', 'sdr', 'bdr', 'emea', 'dach', 'uk', 'us', 'ops', 'gtm']);
  const SMALL = new Set(['of', 'and', 'for', 'the', 'in', 'und', 'für', 'de', '&']);
  function normTitle(v) {
    const s = trim(v);
    if (!s) return '';
    return s.split(' ').map((w, i) => {
      const lw = w.toLowerCase();
      if (TITLE_CASE_KEEP.has(lw.replace(/[^\w]/g, ''))) return w.toUpperCase() === w || lw.length <= 4 ? w.replace(/[a-z]+/gi, (m) => (TITLE_CASE_KEEP.has(m.toLowerCase()) ? m.toUpperCase() : m)) : w;
      if (i > 0 && SMALL.has(lw)) return lw;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }
  // Rules, first match wins. An LLM classifier can replace this for long-tail titles.
  const SENIORITY = [
    ['C-level', /\b(ceo|cfo|cmo|cro|coo|cto|cpo|chief)\b|geschäftsführ|managing director|\bfounder|gründer|\bowner\b|inhaber/],
    ['VP', /\b(vp|svp|evp|vice[\s-]president)\b/],
    ['Head', /\bhead\b|\bleiter|\bleitung\b|\blead\b/],
    ['Director', /director|direktor/],
    ['Manager', /manager|teamlead/],
  ];
  const FUNCTION = [
    ['RevOps', /rev(enue)?\s*ops|revenue operations|marketing operations|marketing ops|sales operations|sales ops|crm/],
    ['Marketing', /marketing|growth|demand|brand|content|\bcmo\b|seo|performance|campaign|communications|\bpr\b|\babm\b/],
    ['Sales', /sales|vertrieb|account exec|\bae\b|business development|\bbdr\b|\bsdr\b|\bcro\b|revenue|partnership|key account/],
    ['Customer success', /customer success|account manag|support|onboarding|\bcs\b/],
    ['Product', /product|\bcpo\b/],
    ['Engineering', /engineer|developer|\bcto\b|\bit\b|software|data|technology/],
    ['Finance', /\bcfo\b|finance|financial|controll|accounting|buchhalt/],
    ['People', /\bhr\b|people|talent|recruit|personal/],
    ['General mgmt', /\bceo\b|\bcoo\b|founder|gründer|geschäftsführ|managing director|owner|inhaber|general manager/],
  ];
  function classifyTitle(t) {
    const s = t.toLowerCase();
    if (!s) return { seniority: '', fn: '' };
    const sen = (SENIORITY.find(([, re]) => re.test(s)) || ['Individual contributor'])[0];
    const fn = (FUNCTION.find(([, re]) => re.test(s)) || ['Other'])[0];
    return { seniority: sen, fn };
  }

  const STAGES = ['Subscriber', 'Lead', 'MQL', 'SQL', 'Opportunity', 'Customer', 'Evangelist'];
  const STAGE_RE = [
    [0, /subscriber|newsletter/], [6, /evangelist|advocate/], [5, /customer|kunde|closed.?won/],
    [4, /opportunit|opp\b|deal/], [3, /\bsql\b|sales.?qualified/], [2, /\bmql\b|marketing.?qualified/], [1, /lead/],
  ];
  function normStage(v) {
    const s = trim(v).toLowerCase();
    if (!s) return -1;
    const hit = STAGE_RE.find(([, re]) => re.test(s));
    return hit ? hit[0] : -1;
  }

  // Dates → YYYY-MM-DD. Ambiguous a/b/yyyy uses the row's country: US = month first, else day first.
  function normDate(v, iso) {
    const s = trim(v);
    if (!s) return '';
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    let y, mo, d;
    if (m) [, y, mo, d] = m;
    else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) [, d, mo, y] = m;
    else if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
      let a = +m[1], b = +m[2];
      y = m[3];
      if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else if (iso === 'US') { mo = a; d = b; } else { d = a; mo = b; }
    } else return '';
    mo = +mo; d = +d;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /*
    standardise(rows, map, opts) → { recs, fixes }
    opts: { defaultCountry: 'DE', on: { names, email, phone, company, country, title, stage } }
    recs[i]: cleaned fields + match keys. fixes: [{ row, id, field, before, after }]
  */
  function standardise(rows, map, opts = {}) {
    const on = Object.assign({ names: true, email: true, phone: true, company: true, country: true, title: true, stage: true }, opts.on);
    const defIso = opts.defaultCountry || 'DE';
    const fixes = [];
    const get = (r, f) => (map[f] ? String(r[map[f]] == null ? '' : r[map[f]]) : '');
    const recs = rows.map((r, i) => {
      const id = trim(get(r, 'id')) || 'row-' + (i + 1);
      const fix = (field, before, after) => { if (after !== before) fixes.push({ row: i, id, field, before, after }); };

      // country first: phone and date parsing depend on it
      const rawCountry = get(r, 'country');
      const iso = on.country ? normCountry(rawCountry) : '';
      const country = on.country ? (iso || trim(rawCountry)) : rawCountry;
      if (map.country) fix('Country', rawCountry, country);
      const ctx = iso || defIso;

      let first = get(r, 'first'), last = get(r, 'last');
      const full = get(r, 'full');
      const rawFirst = first, rawLast = last;
      if (on.names) {
        if (!trim(first) && !trim(last) && trim(full)) [first, last] = splitFull(full);
        first = namecase(first.split(' ').filter((t) => !HONORIFICS.test(t)).join(' '));
        last = namecase(last);
        if (map.first || map.last) { fix('First name', rawFirst, first); fix('Last name', rawLast, last); }
        else if (map.full) fix('Name', full, trim(first + ' ' + last));
      } else if (!map.first && !map.last) {
        first = ''; last = full;
      }

      const rawEmail = get(r, 'email');
      const em = on.email ? normEmail(rawEmail) : { value: rawEmail, key: trim(rawEmail), valid: true };
      if (map.email) fix('Email', rawEmail, em.value);

      const rawPhone = get(r, 'phone');
      const ph = on.phone ? normPhone(rawPhone, ctx) : { value: rawPhone, ok: true };
      if (map.phone) fix('Phone', rawPhone, ph.value);

      const rawCo = get(r, 'company');
      const company = on.company ? normCompany(rawCo) : rawCo;
      if (map.company) fix('Company', rawCo, company);

      const rawTitle = get(r, 'title');
      const title = on.title ? normTitle(rawTitle) : rawTitle;
      const cls = on.title ? classifyTitle(title) : { seniority: '', fn: '' };
      if (map.title) fix('Job title', rawTitle, title);

      const rawStage = get(r, 'lifecycle');
      const stageIdx = on.stage ? normStage(rawStage) : -1;
      const stage = on.stage ? (stageIdx >= 0 ? STAGES[stageIdx] : trim(rawStage)) : rawStage;
      if (map.lifecycle) fix('Lifecycle', rawStage, stage);

      const rawDate = get(r, 'last_activity');
      const date = on.stage ? (normDate(rawDate, ctx) || trim(rawDate)) : rawDate;
      if (map.last_activity) fix('Last activity', rawDate, date);

      // match keys
      const fN = on.names ? lettersOnly(first.split(' ')[0]) : trim(first);
      const lN = on.names ? lettersOnly(last) : trim(last);
      const fCanon = on.names ? (NICK[fN] || fN) : fN;
      const lCanon = on.names ? (NICK[lN] || lN) : lN;
      const phoneKey = on.phone ? (/^\+\d{8,}$/.test(ph.value) ? ph.value : '') : trim(rawPhone);
      const coTokens = on.company ? fingerprintTokens(company) : (trim(rawCo) ? [trim(rawCo)] : []);
      const emailDomain = em.key.includes('@') ? em.key.split('@')[1] : '';

      return {
        i, id, raw: r,
        first, last, email: em.value, emailValid: em.valid, phone: ph.value, phoneOk: ph.ok,
        company, country, title, seniority: cls.seniority, fn: cls.fn, stage, stageIdx, date,
        k: {
          email: em.key, emailFree: FREE_EMAIL.has(emailDomain), phone: phoneKey,
          first: fCanon, firstRaw: fN, last: lN, lastC: lCanon, co: coTokens.join(' '), coTokens,
          pf: on.names ? cologne(fCanon) : fCanon.toLowerCase(), pl: on.names ? cologne(lCanon) : lN.toLowerCase(),
        },
      };
    });
    return { recs, fixes };
  }

  // ---------------------------------------------------------------- blocking
  // Keys: normalised email; E.164 phone; company fingerprint + phonetic name pair; phonetic name pair
  // alone. The name pair is sorted so swapped first/last land in the same block. Oversized blocks
  // (common names, shared switchboards) are skipped to keep work bounded, as crm-refine does with windows.
  const MAX_BLOCK = 40;
  function block(recs) {
    const blocks = new Map();
    const add = (key, i) => {
      if (!key) return;
      let b = blocks.get(key);
      if (!b) blocks.set(key, (b = []));
      b.push(i);
    };
    recs.forEach((r, i) => {
      const k = r.k;
      add(k.email && 'e:' + k.email, i);
      add(k.phone && 'p:' + k.phone, i);
      const pair = [k.pf, k.pl].filter(Boolean).sort().join('|');
      if (pair && k.pf && k.pl) {
        if (k.co) add('c:' + k.co + '#' + pair, i);
        add('n:' + pair, i);
      }
    });
    const pairs = new Map();
    const reasons = { email: 0, phone: 0, company: 0, name: 0 };
    let skipped = 0;
    for (const [key, members] of blocks) {
      if (members.length < 2) continue;
      if (members.length > MAX_BLOCK) { skipped++; continue; }
      const kind = { e: 'email', p: 'phone', c: 'company', n: 'name' }[key[0]];
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          const i = members[a], j = members[b];
          const pk = i < j ? i + ',' + j : j + ',' + i;
          let p = pairs.get(pk);
          if (!p) { pairs.set(pk, (p = { a: Math.min(i, j), b: Math.max(i, j), via: [] })); reasons[kind]++; }
          if (!p.via.includes(kind)) p.via.push(kind);
        }
      }
    }
    return { pairs: [...pairs.values()], blocks: blocks.size, skipped, reasons };
  }

  // ---------------------------------------------------------------- scoring
  const WEIGHTS = { email: 0.30, phone: 0.20, first: 0.15, last: 0.20, company: 0.15 };
  const NAME_ONLY = 0.75, FIRST_CONFLICT = 0.8;
  function jaccard(a, b) {
    if (!a.length || !b.length) return null;
    const sb = new Set(b);
    let inter = 0;
    a.forEach((t) => { if (sb.has(t)) inter++; });
    return inter / (a.length + b.length - inter);
  }
  const nameSim = (x, y) => (x && y ? jaroWinkler(x, y) : null);
  // Score in [0,1] = Σ w·s / Σ w over the features both records have. A differing email counts at half
  // weight: people keep work and personal addresses, so a mismatch is weak evidence against a match.
  function score(A, B) {
    const a = A.k, b = B.k;
    const f = {};
    f.email = a.email && b.email ? (a.email === b.email ? 1 : 0) : null;
    f.phone = a.phone && b.phone ? (a.phone === b.phone ? 1 : 0) : null;
    const direct = [nameSim(a.first, b.first), nameSim(a.last, b.last)];
    const swapped = [nameSim(a.first, b.lastC), nameSim(a.lastC, b.first)];
    const tot = (p) => (p[0] || 0) * WEIGHTS.first + (p[1] || 0) * WEIGHTS.last;
    f.swapped = tot(swapped) > tot(direct) + 0.05;
    [f.first, f.last] = f.swapped ? swapped : direct;
    f.company = jaccard(a.coTokens, b.coTokens);
    let num = 0, den = 0;
    ['email', 'phone', 'first', 'last', 'company'].forEach((k) => {
      if (f[k] == null) return;
      const w = k === 'email' && f[k] === 0 ? WEIGHTS.email / 2 : WEIGHTS[k];
      num += w * f[k]; den += w;
    });
    let s = den ? num / den : 0;
    // Guards: name-only evidence and clearly different first names (a shared inbox like j.carter@)
    // are scaled down so they land in review instead of auto-merging.
    f.nameOnly = f.email == null && f.phone == null && f.company == null;
    f.firstConflict = f.first != null && f.first < 0.75;
    if (f.nameOnly) s *= NAME_ONLY;
    if (f.firstConflict) s *= FIRST_CONFLICT;
    return { s: Math.round(s * 1000) / 1000, f };
  }
  function signals(f) {
    const out = [];
    if (f.email === 1) out.push('email');
    if (f.phone === 1) out.push('phone');
    if (f.first != null && f.first >= 0.92 && f.last != null && f.last >= 0.92) out.push(f.swapped ? 'name (swapped)' : 'name');
    else if (f.last != null && f.last >= 0.92) out.push('last name');
    if (f.company != null && f.company >= 0.5) out.push('company');
    return out;
  }
  function scorePairs(recs, pairs) {
    pairs.forEach((p) => { const r = score(recs[p.a], recs[p.b]); p.s = r.s; p.f = r.f; p.sig = signals(r.f); });
    return pairs;
  }

  // ---------------------------------------------------------------- clustering (union-find, as crm-refine UF)
  function pairKey(A, B) { return A.id < B.id ? A.id + '|' + B.id : B.id + '|' + A.id; }
  function cluster(recs, pairs, { auto = 0.8, review = 0.6, decisions = {} } = {}) {
    const n = recs.length, p = Array.from({ length: n }, (_, i) => i);
    const find = (x) => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) p[ra] = rb; };
    const merged = [];
    pairs.forEach((q) => {
      const d = decisions[pairKey(recs[q.a], recs[q.b])];
      q.decision = d || '';
      if (d === 'separate') return;
      if (q.s >= auto || d === 'merge') { union(q.a, q.b); merged.push(q); }
    });
    const reviewQ = pairs.filter((q) => q.s >= review && q.s < auto).sort((x, y) => y.s - x.s);
    reviewQ.forEach((q) => { q.linked = !q.decision && find(q.a) === find(q.b); });
    const groups = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
    const clusters = [...groups.values()];
    const byRoot = new Map();
    merged.forEach((q) => { const r = find(q.a); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(q); });
    return { clusters, label: Array.from({ length: n }, (_, i) => find(i)), review: reviewQ, mergedPairs: byRoot };
  }

  // ---------------------------------------------------------------- survivorship
  const VOLATILE = ['email', 'phone', 'company', 'title', 'seniority', 'fn', 'country'];
  const STABLE = ['first', 'last'];
  const GOLDEN_FIELDS = ['first', 'last', 'email', 'phone', 'company', 'country', 'title', 'seniority', 'fn', 'stage', 'date'];
  const filled = (v) => String(v == null ? '' : v).trim() !== '';
  const completeness = (r) => GOLDEN_FIELDS.reduce((s, f) => s + (filled(r[f]) ? 1 : 0), 0) + Object.values(r.raw).filter(filled).length / 100;

  // Master = most complete, then most recent (crm-refine _pick_master). Fields then fill by rule.
  function survive(recs, members, passCols = []) {
    const rs = members.map((i) => recs[i]);
    const byRecent = [...rs].sort((x, y) => (y.date || '').localeCompare(x.date || '') || completeness(y) - completeness(x));
    const master = [...rs].sort((x, y) => completeness(y) - completeness(x) || (y.date || '').localeCompare(x.date || ''))[0];
    const g = { id: master.id }, prov = {};
    VOLATILE.forEach((f) => {
      const src = byRecent.find((r) => filled(r[f]));
      g[f] = src ? src[f] : ''; prov[f] = src ? { from: src.id, rule: 'most recent activity' } : null;
    });
    STABLE.forEach((f) => {
      const src = [...rs].sort((x, y) => String(y[f]).length - String(x[f]).length || (y.date || '').localeCompare(x.date || ''))[0];
      g[f] = src[f]; prov[f] = filled(src[f]) ? { from: src.id, rule: 'most complete value' } : null;
    });
    const top = [...rs].sort((x, y) => y.stageIdx - x.stageIdx)[0];
    g.stage = top.stage; prov.stage = filled(top.stage) ? { from: top.id, rule: 'highest lifecycle stage' } : null;
    g.date = byRecent[0].date; prov.date = filled(g.date) ? { from: byRecent[0].id, rule: 'latest date' } : null;
    g.extra = {};
    passCols.forEach((c) => {
      const mv = master.raw[c];
      const src = filled(mv) ? master : rs.find((r) => filled(r.raw[c]));
      g.extra[c] = src ? src.raw[c] : '';
      prov['x:' + c] = src ? { from: src.id, rule: src === master ? 'master record' : 'filled from duplicate' } : null;
    });
    return { g, prov, master: master.id, members: rs.map((r) => r.id) };
  }

  // ---------------------------------------------------------------- evaluation (crm-refine evaluate.py: pair counting)
  function evaluate(label, truth) {
    const c2 = (n) => (n * (n - 1)) / 2;
    const cont = new Map(), tr = new Map(), pc = new Map();
    label.forEach((p, i) => {
      const t = truth[i];
      cont.set(t + '\u0000' + p, (cont.get(t + '\u0000' + p) || 0) + 1);
      tr.set(t, (tr.get(t) || 0) + 1);
      pc.set(p, (pc.get(p) || 0) + 1);
    });
    let tp = 0, pp = 0, tt = 0;
    cont.forEach((n) => { tp += c2(n); });
    pc.forEach((n) => { pp += c2(n); });
    tr.forEach((n) => { tt += c2(n); });
    const precision = pp ? tp / pp : 1, recall = tt ? tp / tt : 1;
    return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, tp, fp: pp - tp, fn: tt - tp };
  }

  // ---------------------------------------------------------------- synthetic sample (fictional people + companies)
  // generate(rng, nPeople) → { rows, truth, headers }. truth[i] is the hidden person id of rows[i].
  const SAMPLE = {
    DE: {
      first: ['Jürgen', 'Katharina', 'Thomas', 'Stefan', 'Sabine', 'Michael', 'Andreas', 'Julia', 'Johannes', 'Franziska', 'Maximilian', 'Sebastian', 'Matthias', 'Susanne', 'Tobias', 'Florian', 'Annika', 'Lena', 'Jörg', 'Björn', 'Gabriele', 'Wolfgang', 'Friedrich', 'Charlotte', 'Dominik', 'Anja', 'Uwe', 'Birgit', 'Kerstin', 'Lars'],
      last: ['Müller', 'Schröder', 'Weiß', 'Groß', 'Köhler', 'Bäcker', 'Schäfer', 'Hoffmann', 'Krüger', 'Schmidt', 'Fischer', 'Wagner', 'Becker', 'Zimmermann', 'Braun', 'Hartmann', 'Lange', 'Werner', 'Krause', 'Lehmann', 'Schulze', 'Böhm', 'Jäger', 'Vogel', 'Günther', 'von Arnim', 'Meißner', 'Neumann', 'Dietrich', 'Förster'],
      co: ['Nordwind Logistik', 'Brennwerk Software', 'Hafenkontor', 'Lindgrün Energie', 'Fahrwerk Mobility', 'Kieselstein Analytics', 'Rheinblick Versicherung', 'Sonnfeld Solar', 'Taktgeber Systems', 'Weißdorn Pharma', 'Bergquell Getränke', 'Kranichflug Robotics'],
      suffix: ['GmbH', 'GmbH', 'GmbH & Co. KG', 'AG', 'gmbh', ''], tld: '.example',
      country: ['Germany', 'Deutschland', 'DE', 'GER', 'germany', 'Deutschland '],
      phone: [['30', '23125'], ['40', '66969'], ['89', '99998'], ['69', '90009'], ['221', '4710']], cc: '49',
    },
    GB: {
      first: ['William', 'Elizabeth', 'James', 'Catherine', 'Richard', 'Margaret', 'Edward', 'Victoria', 'Thomas', 'Rebecca', 'Christopher', 'Charlotte', 'Daniel', 'Samuel', 'Alexandra', 'Matthew', 'Oliver', 'Harriet', 'George', 'Amelia', 'Nicholas', 'Rachel', 'Andrew', 'Sophie'],
      last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Evans', 'Roberts', 'Walker', 'Wright', 'Robinson', 'Thompson', 'Hughes', 'McAllister', "O'Brien", 'MacLeod', 'Clarke', 'Patel', 'Harris', 'Lewis', 'Bennett', 'Fletcher', 'Hargreaves', 'Ashworth'],
      co: ['Thornbury Analytics', 'Blackfen Partners', 'Kestrel Bay Media', 'Ashgrove Health', 'Copperline Freight', 'Halden Moss', 'Pellow Labs', 'Greyfriars Capital', 'Marlowe Digital', 'Fenwick Row'],
      suffix: ['Ltd', 'Ltd.', 'Limited', 'PLC', 'ltd', ''], tld: '.example',
      country: ['United Kingdom', 'UK', 'GB', 'England', 'Great Britain', 'U.K.'],
      phone: [['20', '7946 0'], ['161', '496 0'], ['113', '496 0'], ['117', '496 0'], ['121', '496 0'], ['7700', '900']], cc: '44',
    },
    US: {
      first: ['Robert', 'Jennifer', 'Michael', 'Patricia', 'William', 'Susan', 'Joseph', 'Deborah', 'Anthony', 'Christina', 'Steven', 'Timothy', 'Jonathan', 'Benjamin', 'Megan', 'Tyler', 'Ashley', 'Brandon', 'Jessica', 'Kevin', 'Lauren', 'Richard'],
      last: ['Johnson', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Martinez', 'Anderson', 'Jackson', 'White', 'Lopez', 'Lee', 'Gonzalez', 'Carter', 'Mitchell', 'Perez', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Collins', 'Nguyen', 'Kim'],
      co: ['Bluepine Software', 'Cedar Ridge Health', 'Ironleaf Labs', 'Northgate Freight', 'Quarry Point Capital', 'Redwater Media', 'Tallgrass Robotics', 'Brightmoor Analytics', 'Saltmarsh Retail', 'Juniper Hollow'],
      suffix: ['Inc.', 'Inc', 'LLC', 'Corp.', 'Corporation', ''], tld: '.example',
      country: ['United States', 'USA', 'US', 'U.S.', 'United States of America', 'usa'],
      phone: ['212', '415', '312', '617', '512', '206', '303', '404', '646', '718', '213', '305', '702', '503', '614', '919'].map((a) => [a, '555 01']), cc: '1',
    },
  };
  const ROLES = [
    ['VP Marketing', 'Vice President of Marketing', 'VP, Marketing', 'vp marketing'],
    ['Head of Growth', 'head of growth', 'Growth Lead'],
    ['CMO', 'Chief Marketing Officer'],
    ['Marketing Manager', 'marketing manager', 'Manager, Marketing'],
    ['Sales Director', 'Director of Sales', 'Director, Sales'],
    ['SDR', 'Sales Development Rep', 'sales development representative'],
    ['RevOps Manager', 'Revenue Operations Manager', 'Rev Ops Manager'],
    ['Demand Generation Manager', 'Demand Gen Manager'],
    ['CEO', 'Founder & CEO', 'Chief Executive Officer'],
    ['Head of Content', 'Content Marketing Lead'],
    ['CFO', 'Chief Financial Officer'],
    ['Account Executive', 'Senior Account Executive', 'AE'],
  ];
  const STAGE_LABELS = [['Subscriber', 'subscriber'], ['Lead', 'lead', 'Lead '], ['MQL', 'Marketing Qualified Lead'], ['SQL', 'Sales qualified lead'], ['Opportunity', 'opportunity'], ['Customer', 'customer', 'CUSTOMER'], ['Evangelist']];
  const SAMPLE_HEADERS = ['Record ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Company', 'Country', 'Job Title', 'Lifecycle Stage', 'Last Activity Date'];

  function generate(rng, nPeople = 190) {
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const chance = (p) => rng() < p;
    const slug = (s) => foldAscii(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const nickOf = (name) => {
      const k = foldAscii(name), g = NICK_GROUPS.find((x) => foldAscii(x[0]) === k);
      const opts = g ? g.slice(1).filter((n) => n.length < name.length) : [];
      return opts.length ? (([n]) => n.charAt(0).toUpperCase() + n.slice(1))([pick(opts)]) : '';
    };
    const usedName = new Set(), usedPhone = new Set(), usedEmail = new Set();
    const people = [];
    for (let p = 0; p < nPeople; p++) {
      const r = rng(), cc = r < 0.45 ? 'DE' : r < 0.75 ? 'GB' : 'US', S = SAMPLE[cc];
      let first, last, tries = 0;
      do { first = pick(S.first); last = pick(S.last); } while (usedName.has(first + ' ' + last) && ++tries < 30);
      usedName.add(first + ' ' + last);
      const co = pick(S.co);
      let phone, ptries = 0;
      do {
        const [area, pre] = pick(S.phone);
        const us = cc === 'US', tail = String(Math.floor(rng() * (us ? 100 : 1000))).padStart(us ? 2 : 3, '0');
        phone = { area, sub: (pre + tail).replace(/\s/g, ''), cc: S.cc };
      } while (usedPhone.has(phone.area + phone.sub) && ++ptries < 50);
      usedPhone.add(phone.area + phone.sub);
      const fl = foldAscii(first).replace(/[^a-z]/g, ''), ll = foldAscii(last).replace(/[^a-z]/g, '');
      let local = chance(0.6) ? fl + '.' + ll : fl[0] + '.' + ll, n2 = 1;
      if (usedEmail.has(local + '@' + co)) local = fl + '.' + ll;
      while (usedEmail.has(local + '@' + co)) local = fl + '.' + ll + ++n2;
      usedEmail.add(local + '@' + co);
      const work = local + '@' + slug(co) + S.tld;
      people.push({
        pid: 'P' + String(p + 1).padStart(4, '0'), cc, first, last, co, phone: chance(0.85) ? phone : null, work,
        personal: chance(0.35) ? fl + '.' + ll + (chance(0.4) ? String(rng.int ? rng.int(1, 99) : 7) : '') + '@gmail.com' : '',
        role: Math.floor(rng() * ROLES.length), stage: Math.floor(rng() * 7), day: Math.floor(rng() * 420),
      });
    }
    // Namesakes: same name, different person and company. These must stay apart.
    const ns = Math.max(2, Math.round(nPeople * 0.03));
    for (let k = 0; k < ns; k++) {
      const src = people[Math.floor(rng() * people.length)], S = SAMPLE[src.cc];
      const co = pick(S.co.filter((c) => c !== src.co));
      const fl = foldAscii(src.first).replace(/[^a-z]/g, ''), ll = foldAscii(src.last).replace(/[^a-z]/g, '');
      people.push({ ...src, pid: 'P' + String(people.length + 1).padStart(4, '0'), co, phone: null, work: fl + '.' + ll + '@' + slug(co) + S.tld, personal: '', role: Math.floor(rng() * ROLES.length) });
    }

    const fmtPhone = (ph, cc) => {
      const { area, sub } = ph, nat = (cc === 'US' ? '' : '0') + area;
      const f = cc === 'US'
        ? ['+1 ' + area + ' ' + sub.slice(0, 3) + ' ' + sub.slice(3), '(' + area + ') ' + sub.slice(0, 3) + '-' + sub.slice(3), area + '-' + sub.slice(0, 3) + '-' + sub.slice(3), '1-' + area + '-' + sub.slice(0, 3) + '-' + sub.slice(3), area + '.' + sub.slice(0, 3) + '.' + sub.slice(3)]
        : cc === 'GB'
          ? ['+44 ' + area + ' ' + sub, nat + ' ' + sub, '0044 ' + area + ' ' + sub, '(' + nat + ') ' + sub, '+44 (0)' + area + ' ' + sub]
          : ['+49 ' + area + ' ' + sub, nat + '/' + sub, '0049 ' + area + ' ' + sub, '+49 (0)' + area + ' ' + sub, nat + ' ' + sub.slice(0, 3) + ' ' + sub.slice(3), nat + '-' + sub];
      return pick(f);
    };
    const umlautVariant = (s) => (/[äöüß]/i.test(s) ? (chance(0.75) ? s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue') : s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')) : s);
    const caseNoise = (s) => { const r = rng(); return r < 0.12 ? s.toUpperCase() : r < 0.24 ? s.toLowerCase() : r < 0.32 ? '  ' + s + ' ' : s; };
    const typo = (s) => { if (s.length < 5) return s; const i = 1 + Math.floor(rng() * (s.length - 2)); return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); };
    const fmtDate = (d, cc) => {
      const dt = new Date(Date.UTC(2026, 8, 30) - d * 864e5);
      const Y = dt.getUTCFullYear(), M = String(dt.getUTCMonth() + 1).padStart(2, '0'), D = String(dt.getUTCDate()).padStart(2, '0');
      if (chance(0.4)) return `${Y}-${M}-${D}`;
      return cc === 'DE' ? `${D}.${M}.${Y}` : cc === 'GB' ? `${D}/${M}/${Y}` : `${M}/${D}/${Y}`;
    };

    const out = [];
    people.forEach((P) => {
      const r = rng(), copies = 1 + (r < 0.6 ? 0 : r < 0.85 ? 1 : r < 0.96 ? 2 : 3);
      for (let c = 0; c < copies; c++) {
        const dup = c > 0, S = SAMPLE[P.cc];
        let first = P.first, last = P.last;
        if (chance(dup ? 0.35 : 0.15)) first = nickOf(first) || first;
        if (chance(0.5)) first = umlautVariant(first);
        if (chance(0.5)) last = umlautVariant(last);
        if (dup && chance(0.08)) last = typo(last);
        first = caseNoise(first); last = caseNoise(last);
        if (dup && chance(0.07)) [first, last] = [last, first];

        let email = '';
        const er = rng();
        if (er < 0.68) email = P.work;
        else if (er < 0.9 && P.personal) {
          email = P.personal;
          if (chance(0.4)) email = email.replace('.', '');
          if (chance(0.25)) email = email.replace('@gmail.com', '@googlemail.com');
        } else if (er < 0.9) email = P.work;
        if (email) {
          if (chance(0.15)) email = email.replace('@', '+' + pick(['crm', 'webinar', 'news', 'events']) + '@');
          if (chance(0.25)) email = email.replace(/^./, (x) => x.toUpperCase()).replace(/@(.)/, (m, x) => '@' + x.toUpperCase());
          if (chance(0.1)) email = ' ' + email + ' ';
        }
        const phone = P.phone && chance(0.75) ? fmtPhone(P.phone, P.cc) : '';
        let company = chance(0.05) ? '' : P.co + (S.suffix.length ? ' ' + pick(S.suffix) : '');
        const cr = rng();
        company = cr < 0.1 ? company.toUpperCase() : cr < 0.2 ? company.toLowerCase() : company;
        const country = chance(0.08) ? '' : pick(S.country);
        const role = dup && chance(0.1) ? Math.floor(rng() * ROLES.length) : P.role;
        const title = chance(0.06) ? '' : pick(ROLES[role]);
        const st = Math.max(0, P.stage - (dup ? Math.floor(rng() * 3) : 0));
        const day = P.day + (dup ? Math.floor(rng() * 200) : 0);
        out.push({ pid: P.pid, row: [first, last, email, phone, company.trim(), country, title, pick(STAGE_LABELS[st]), fmtDate(day, P.cc)] });
      }
    });
    // shuffle so duplicates are not adjacent
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    const rows = out.map((o, i) => Object.fromEntries(SAMPLE_HEADERS.map((h, k) => [h, k === 0 ? 'C-' + (10001 + i) : o.row[k - 1]])));
    return { rows, truth: out.map((o) => o.pid), headers: SAMPLE_HEADERS, people: people.length };
  }

  // ---------------------------------------------------------------- full run
  function run(rows, map, opts = {}) {
    const t0 = Date.now();
    const st = standardise(rows, map, opts);
    const bl = block(st.recs);
    scorePairs(st.recs, bl.pairs);
    return { ...st, ...bl, ms: Date.now() - t0 };
  }

  const api = {
    FIELDS, FIELD_LABEL, WEIGHTS, NAME_ONLY, FIRST_CONFLICT, STAGES, GOLDEN_FIELDS, MAX_BLOCK,
    detectColumns, generate, standardise, block, score, scorePairs, cluster, survive, evaluate, run, pairKey,
    util: { jaroWinkler, cologne, foldAscii, fingerprintTokens, normEmail, normPhone, normCompany, normCountry, normTitle, classifyTitle, normDate, normStage, namecase, splitFull, NICK },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CRMDedupe = api;
})();
