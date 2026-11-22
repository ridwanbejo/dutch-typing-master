(function (global) {
  'use strict';

  const TERM_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[\s-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
  const MAX_TERM_LENGTH = 24;

  // Dutch orthography & syllabification tables (Groene Boekje inspired)
  const NL_VOWEL_CHARS = new Set([
    'a', 'e', 'i', 'o', 'u', 'y',
    'á', 'é', 'í', 'ó', 'ú', 'à', 'è', 'ì', 'ò', 'ù', 'ë', 'ï', 'ö', 'ü',
  ]);
  const NL_TREMA_VOWELS = new Set(['ë', 'ï', 'ö', 'ü']);
  const NL_VOWEL_TRIGRAPHS = new Set(['aai', 'ooi', 'oei', 'eeu', 'ieu', 'eau']);
  const NL_VOWEL_DIGRAPHS = new Set([
    'aa', 'ee', 'éé', 'oo', 'uu', 'ei', 'ij', 'eu', 'ie', 'oe', 'ou', 'au', 'ui',
  ]);
  // Obstruent + liquid & Greek digraph clusters that stay together as a syllable onset in Dutch
  const NL_ONSET_PAIRS = new Set([
    'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr',
    'kl', 'kr', 'ph', 'pl', 'pr', 'th', 'tr', 'vr',
  ]);
  const NL_ONSET_TRIPLES = new Set(['sch', 'str', 'spr', 'spl', 'scr']);
  // Common Dutch prefixes (sorted longest-first) used to preserve morphological syllable boundaries
  const NL_PREFIXES = [
    'onder', 'terug', 'over', 'voor', 'door', 'aan', 'her', 'ont', 'uit', 'ver',
    'toe', 'af', 'be', 'ge', 'in', 'om', 'op', 'na',
  ];

  // English orthography & syllabification tables
  const EN_VOWEL_CHARS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
  const EN_VOWEL_TEAMS = new Set([
    'ai', 'ay', 'au', 'aw', 'ea', 'ee', 'ei', 'ey', 'eu',
    'ie', 'oa', 'oe', 'oi', 'oo', 'ou', 'ow', 'oy', 'ue', 'ui',
  ]);
  const EN_DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'ng', 'qu']);
  const EN_ONSET_CLUSTERS = new Set([
    'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr',
    'pl', 'pr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st',
    'sw', 'tr', 'tw', 'wr', 'ch', 'sh', 'th', 'ph', 'wh', 'qu',
  ]);

  const EASINESS_RANGES = {
    'nl-to-en': {
      easy: { min: 1, max: 5, label: '1 – 5 chars' },
      medium: { min: 6, max: 8, label: '6 – 8 chars' },
      hard: { min: 9, max: MAX_TERM_LENGTH, label: '9+ chars' },
      all: { min: 1, max: MAX_TERM_LENGTH, label: 'All lengths' },
    },
    'en-to-nl': {
      easy: { min: 1, max: 6, label: '1 – 6 chars' },
      medium: { min: 7, max: 10, label: '7 – 10 chars' },
      hard: { min: 11, max: MAX_TERM_LENGTH, label: '11+ chars' },
      all: { min: 1, max: MAX_TERM_LENGTH, label: 'All lengths' },
    },
  };

  /**
   * RFC 4180 compliant CSV parser (handles quoted fields, escaped quotes, embedded commas, CRLF/LF).
   */
  function parseCSV(text) {
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];

      if (inQuotes) {
        if (ch === '"') {
          if (clean[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        if (clean[i + 1] === '\n') i++;
        row.push(field);
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  /**
   * Extract clean candidate terms from a semicolon-separated vocabulary cell.
   */
  function extractCleanTerms(rawCell) {
    if (!rawCell) return [];
    const parts = rawCell.split(';');
    const clean = [];
    for (let i = 0; i < parts.length; i++) {
      const candidate = parts[i].trim().replace(/\s+/g, ' ');
      if (candidate.length > 0 && candidate.length <= MAX_TERM_LENGTH && TERM_RE.test(candidate)) {
        clean.push(candidate);
      }
    }
    return clean;
  }

  function isDutchVowelChar(ch) {
    return NL_VOWEL_CHARS.has(ch);
  }

  function countDutchVowelNuclei(str) {
    const lower = str.toLowerCase();
    let count = 0;
    let i = 0;
    while (i < lower.length) {
      const tri = lower.slice(i, i + 3);
      const di = lower.slice(i, i + 2);
      if (NL_VOWEL_TRIGRAPHS.has(tri)) {
        count += 1;
        i += 3;
      } else if (NL_VOWEL_DIGRAPHS.has(di)) {
        count += 1;
        i += 2;
      } else if (isDutchVowelChar(lower[i])) {
        count += 1;
        i += 1;
      } else {
        i += 1;
      }
    }
    return count;
  }

  /**
   * Core Dutch phonological syllabifier for a stem without leading prefix splits.
   */
  function syllabifyDutchCore(word) {
    if (!word || word.length <= 2) return [word];

    const lower = word.toLowerCase();
    const len = lower.length;
    const nuclei = [];

    let i = 0;
    while (i < len) {
      const ch = lower[i];
      if (NL_TREMA_VOWELS.has(ch)) {
        nuclei.push({ start: i, end: i + 1 });
        i += 1;
        continue;
      }

      const tri = lower.slice(i, i + 3);
      if (NL_VOWEL_TRIGRAPHS.has(tri)) {
        nuclei.push({ start: i, end: i + 3 });
        i += 3;
        continue;
      }

      const di = lower.slice(i, i + 2);
      if (NL_VOWEL_DIGRAPHS.has(di)) {
        // Avoid merging 'ij' or 'ei' into a vowel if the 2nd char carries a trema
        nuclei.push({ start: i, end: i + 2 });
        i += 2;
        continue;
      }

      if (isDutchVowelChar(ch)) {
        // Treat initial 'y' before a vowel as consonant (e.g. yoga)
        if (ch === 'y' && i === 0 && i + 1 < len && isDutchVowelChar(lower[i + 1])) {
          i += 1;
          continue;
        }
        nuclei.push({ start: i, end: i + 1 });
        i += 1;
        continue;
      }

      i += 1;
    }

    if (nuclei.length <= 1) return [word];

    const boundaries = [];
    for (let k = 0; k < nuclei.length - 1; k++) {
      const cStart = nuclei[k].end;
      const cEnd = nuclei[k + 1].start;
      const cLen = cEnd - cStart;
      const cluster = lower.slice(cStart, cEnd);

      if (cLen === 0) {
        // V | V hiatus (e.g. o-ce-aan, pi-a-no, i-dee)
        boundaries.push(cEnd);
      } else if (cLen === 1) {
        // V | C V (e.g. lo-pen, e-ten, wa-ter)
        boundaries.push(cStart);
      } else if (cLen === 2) {
        if (cluster === 'ch' || NL_ONSET_PAIRS.has(cluster)) {
          // Keep inseparable 'ch' and obstruent+liquid onsets together (e.g. la-chen, pro-bleem)
          boundaries.push(cStart);
        } else {
          // VC | CV (e.g. ap-pel, bak-ken, zin-gen, kos-ten, wes-ten)
          boundaries.push(cStart + 1);
        }
      } else {
        // 3+ consonants between vowels
        const rightThree = lower.slice(cEnd - 3, cEnd);
        const rightTwo = lower.slice(cEnd - 2, cEnd);
        const leftTwo = lower.slice(cStart, cStart + 2);

        if (NL_ONSET_TRIPLES.has(rightThree) && cEnd - 3 > cStart) {
          boundaries.push(cEnd - 3);
        } else if (leftTwo === 'ch') {
          // Never split 'ch' (e.g. och-tend, ach-ter, doch-ter, wach-ten)
          boundaries.push(cStart + 2);
        } else if (NL_ONSET_PAIRS.has(rightTwo)) {
          // e.g. om-draai-en, com-pleet, in-stru-ment
          boundaries.push(cEnd - 2);
        } else if (cLen >= 4 && lower.slice(cStart, cStart + 3) === 'sch') {
          boundaries.push(cStart + 3);
        } else {
          boundaries.push(cStart + 1);
        }
      }
    }

    const syllables = [];
    let prev = 0;
    for (let b = 0; b < boundaries.length; b++) {
      const pos = boundaries[b];
      if (pos > prev && pos < len) {
        syllables.push(word.slice(prev, pos));
        prev = pos;
      }
    }
    if (prev < len) {
      syllables.push(word.slice(prev));
    }
    return syllables.length > 0 ? syllables : [word];
  }

  /**
   * Syllabify a single Dutch word using morphological prefix awareness + Dutch phonological rules.
   */
  function syllabifyDutchSingleWord(word) {
    if (!word || word.length <= 2) return [word];

    const lower = word.toLowerCase();

    // Check clear Dutch morphological prefixes (e.g. ver-an-de-ren, ont-dek-ken, aan-ko-men, uit-leg-gen)
    for (let i = 0; i < NL_PREFIXES.length; i++) {
      const pfx = NL_PREFIXES[i];
      if (!lower.startsWith(pfx)) continue;

      const rest = word.slice(pfx.length);
      const restLower = rest.toLowerCase();
      if (rest.length < 3 || countDutchVowelNuclei(rest) < 1) continue;

      // Avoid false splits where the prefix merges into a double consonant or short stem (e.g. bel-len, ber-gen, op-en, in-k, na-am, ge-el, be-er)
      const lastPfx = pfx[pfx.length - 1];
      const firstRest = restLower[0];

      // If prefix ends in a vowel (be, ge, na, toe): only split if rest starts with a consonant
      // (and not followed immediately by an invalid cluster or doubled vowel like na-am / ge-el)
      if (isDutchVowelChar(lastPfx)) {
        if (isDutchVowelChar(firstRest)) continue;
        // Skip monosyllabic-looking stems or words where prefix+first consonant is actually the root (e.g. bergen, beter, beker, gebed? no, ge-bed is fine, but ge-el/be-er already skipped above)
        // Guard against common roots starting with be-/ge-/na- like beter, beker, berg, beer, bed, been, geel, geit, geld, naam, nacht, naald
        if (pfx === 'be' || pfx === 'ge' || pfx === 'na') {
          // Only force prefix split for longer derived words (length >= 6) where rest has >= 2 vowels or starts with a clear onset
          if (word.length < 6) continue;
          // Avoid splitting single-root words like "beneden" -> be-ne-den (works naturally anyway), "begrijpen" -> be-grij-pen
          // Actually core syllabifier already handles V|CV and V|obstruent+liquid! Only force for VC prefixes or awkward clusters.
          continue;
        }
      } else {
        // Consonant-final prefix (aan, af, door, her, in, om, onder, ont, op, over, terug, uit, ver, voor):
        // Avoid false split on words like "appel", "open", "overal" (over-al is right!), "ouder", "auto", "oefening", "olie"
        if (pfx === 'op' && (restLower.startsWith('en') || restLower.startsWith('eens'))) {
          // open -> o-pen, opeens -> op-eens (keep op-eens!)
          if (restLower.startsWith('en') && !restLower.startsWith('eens')) continue;
        }
        if (pfx === 'in' && (restLower.startsWith('de') || restLower.startsWith('et'))) {
          continue;
        }
        if (pfx === 'af' && restLower.length < 4) continue;
        // Avoid splitting "verf", "vers", "verder" (ver-der works either way), "vork", "vrouw"
        if (pfx === 'ver' && countDutchVowelNuclei(rest) < 1) continue;
        if (pfx === 'om' && restLower === 'a') continue;
        // Ensure rest doesn't start with a doubled consonant of the prefix end that breaks a single root (e.g. "offeren")
        if (pfx === 'of') continue;
      }

      const prefixSyls = syllabifyDutchCore(word.slice(0, pfx.length));
      const restSyls = syllabifyDutchSingleWord(rest);
      return prefixSyls.concat(restSyls);
    }

    return syllabifyDutchCore(word);
  }

  /**
   * Segment a Dutch word or phrase into syllable descriptors.
   */
  function segmentDutchSyllables(phrase) {
    const words = phrase.split(/[\s-]+/).filter(Boolean);
    const result = [];
    words.forEach((w, wordIndex) => {
      const syls = syllabifyDutchSingleWord(w);
      syls.forEach((s) => {
        result.push({ text: s, wordIndex });
      });
    });
    return result;
  }

  /**
   * Determine whether character at index i in an English word acts as a vowel.
   */
  function isEnglishVowelAt(lower, i) {
    const ch = lower[i];
    if (ch === 'y') {
      return !(i === 0 && i + 1 < lower.length && EN_VOWEL_CHARS.has(lower[i + 1]) && lower[i + 1] !== 'y');
    }
    return EN_VOWEL_CHARS.has(ch);
  }

  /**
   * Syllabify a single English word using orthographic vowel-nucleus + onset-cluster heuristics.
   */
  function syllabifyEnglishSingleWord(word) {
    if (!word || word.length <= 3) return [word];

    const lower = word.toLowerCase();
    const len = lower.length;

    const nuclei = [];
    let i = 0;
    while (i < len) {
      if (lower[i] === 'q' && lower[i + 1] === 'u' && i + 2 < len && isEnglishVowelAt(lower, i + 2)) {
        i += 2;
        continue;
      }
      if (isEnglishVowelAt(lower, i)) {
        const start = i;
        if (i + 1 < len && EN_VOWEL_TEAMS.has(lower.slice(i, i + 2))) {
          i += 2;
        } else {
          i += 1;
        }
        nuclei.push({ start, end: i });
      } else {
        i += 1;
      }
    }

    if (nuclei.length > 1) {
      const last = nuclei[nuclei.length - 1];
      if (last.start === len - 1 && lower[len - 1] === 'e') {
        const isConsonantLe =
          len >= 3 && lower[len - 2] === 'l' && !isEnglishVowelAt(lower, len - 3);
        if (!isConsonantLe) {
          nuclei.pop();
        }
      } else if (
        last.start === len - 2 &&
        lower.slice(len - 2) === 'es' &&
        len >= 4 &&
        !'sxz'.includes(lower[len - 3]) &&
        !['ch', 'sh'].includes(lower.slice(len - 4, len - 2))
      ) {
        nuclei.pop();
      } else if (
        last.start === len - 2 &&
        lower.slice(len - 2) === 'ed' &&
        len >= 4 &&
        lower[len - 3] !== 't' &&
        lower[len - 3] !== 'd' &&
        !(lower[len - 3] === 'l' && !isEnglishVowelAt(lower, len - 4))
      ) {
        nuclei.pop();
      }
    }

    if (nuclei.length <= 1) return [word];

    const boundaries = [];
    for (let k = 0; k < nuclei.length - 1; k++) {
      const cStart = nuclei[k].end;
      const cEnd = nuclei[k + 1].start;
      const cLen = cEnd - cStart;
      const cluster = lower.slice(cStart, cEnd);

      if (
        k === nuclei.length - 2 &&
        nuclei[k + 1].start === len - 1 &&
        lower.slice(len - 2) === 'le' &&
        cLen >= 2
      ) {
        boundaries.push(cEnd - 2);
        continue;
      }

      if (cLen === 0) {
        boundaries.push(cEnd);
      } else if (cLen === 1) {
        boundaries.push(cStart);
      } else if (cLen === 2) {
        if (EN_DIGRAPHS.has(cluster) || EN_ONSET_CLUSTERS.has(cluster)) {
          boundaries.push(cStart);
        } else {
          boundaries.push(cStart + 1);
        }
      } else {
        const leftTwo = lower.slice(cStart, cStart + 2);
        const rightTwo = lower.slice(cEnd - 2, cEnd);
        if (EN_DIGRAPHS.has(leftTwo)) {
          boundaries.push(cStart + 2);
        } else if (EN_ONSET_CLUSTERS.has(rightTwo) || EN_DIGRAPHS.has(rightTwo)) {
          boundaries.push(cEnd - 2);
        } else {
          boundaries.push(cStart + 1);
        }
      }
    }

    const syllables = [];
    let prev = 0;
    for (let b = 0; b < boundaries.length; b++) {
      const pos = boundaries[b];
      if (pos > prev && pos < len) {
        syllables.push(word.slice(prev, pos));
        prev = pos;
      }
    }
    if (prev < len) {
      syllables.push(word.slice(prev));
    }

    return syllables.length > 0 ? syllables : [word];
  }

  /**
   * Segment an English word or phrase into syllable descriptors.
   */
  function segmentEnglishSyllables(phrase) {
    const words = phrase.split(/[\s-]+/).filter(Boolean);
    const result = [];
    words.forEach((w, wordIndex) => {
      const syls = syllabifyEnglishSingleWord(w);
      syls.forEach((s) => {
        result.push({ text: s, wordIndex });
      });
    });
    return result;
  }

  function formatSyllableBreakdown(syllables) {
    if (!syllables || syllables.length === 0) return '';
    let out = '';
    for (let i = 0; i < syllables.length; i++) {
      if (i > 0) {
        out += syllables[i].wordIndex !== syllables[i - 1].wordIndex ? '  /  ' : ' · ';
      }
      out += syllables[i].text;
    }
    return out;
  }

  function buildBlocks(term) {
    return Array.from(term).map((ch) => ({
      text: ch,
      isSpace: ch === ' ',
      isHyphen: ch === '-',
    }));
  }

  /**
   * Lazily compute blocks and Dutch + English syllables for a vocabulary item.
   */
  function enrichVocabItem(item) {
    if (item._enriched) return item;

    item.nlBlocks = buildBlocks(item.dutch);
    item.enBlocks = buildBlocks(item.english);
    item.nlSyllables = segmentDutchSyllables(item.dutch);
    item.enSyllables = segmentEnglishSyllables(item.english);
    item.nlSyllableBreakdown = formatSyllableBreakdown(item.nlSyllables);
    item.enSyllableBreakdown = formatSyllableBreakdown(item.enSyllables);
    item.nlLetterBreakdown = item.nlBlocks
      .map((b) => (b.isSpace ? '␣' : b.text))
      .join(' · ');
    item.enLetterBreakdown = item.enBlocks
      .map((b) => (b.isSpace ? '␣' : b.text))
      .join(' · ');
    item._enriched = true;
    return item;
  }

  /**
   * Fold Latin diacritics (e.g. één -> een, privé -> prive) for keyboard-friendly matching.
   */
  function foldDiacritics(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  }

  /**
   * Canonicalise Dutch / English input for reliable typing comparison.
   */
  function normalizeInput(str) {
    return (str || '')
      .normalize('NFC')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function buildAcceptedDutch(terms) {
    const set = new Set();
    for (let i = 0; i < terms.length; i++) {
      const norm = normalizeInput(terms[i]);
      if (!norm) continue;
      set.add(norm);
      const folded = foldDiacritics(norm);
      if (folded && folded !== norm) {
        set.add(folded);
      }
    }
    return Array.from(set);
  }

  function buildAcceptedEnglish(terms) {
    const set = new Set();
    for (let i = 0; i < terms.length; i++) {
      const norm = normalizeInput(terms[i]);
      if (!norm) continue;
      set.add(norm);
      // Also accept bare English infinitive without leading "to " for smoother typing
      if (norm.startsWith('to ') && norm.length > 3) {
        set.add(norm.slice(3));
      }
    }
    return Array.from(set);
  }

  /**
   * Load and parse assets/data/commonly-spoken-Dutch-merged.csv (columns: dutch, english, indonesian).
   * @param {string} csvPath
   * @returns {Promise<{items: Array<object>, totalRows: number, skippedRows: number}>}
   */
  async function loadDataset(csvPath) {
    const resp = await fetch(csvPath);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const text = await resp.text();
    const rows = parseCSV(text);
    if (rows.length < 2) {
      throw new Error('CSV dataset is empty');
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idxDutch = header.indexOf('dutch');
    const idxEnglish = header.indexOf('english');
    const idxIndonesian = header.indexOf('indonesian');
    if (idxDutch === -1 || idxEnglish === -1) {
      throw new Error('Expected columns: dutch, english, indonesian');
    }

    const items = [];
    const seen = new Set();
    let skippedRows = 0;

    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      const rawDutch = (cols[idxDutch] || '').trim().normalize('NFC');
      const rawEnglish = (cols[idxEnglish] || '').trim().normalize('NFC');
      const rawIndonesian =
        idxIndonesian !== -1 ? (cols[idxIndonesian] || '').trim().normalize('NFC') : '';

      const nlTerms = extractCleanTerms(rawDutch);
      const enTerms = extractCleanTerms(rawEnglish);

      if (nlTerms.length === 0 || enTerms.length === 0) {
        skippedRows += 1;
        continue;
      }

      const dutch = nlTerms[0];
      const english = enTerms[0];
      const indonesian = rawIndonesian
        ? rawIndonesian.split(';')[0].trim().replace(/\s+/g, ' ')
        : '';

      const dedupKey = `${dutch.toLowerCase()}|${english.toLowerCase()}`;
      if (seen.has(dedupKey)) {
        skippedRows += 1;
        continue;
      }
      seen.add(dedupKey);

      items.push({
        dutch,
        english,
        englishDisplay: enTerms.slice(0, 2).join('; '),
        indonesian,
        nlLen: dutch.length,
        enLen: english.length,
        nlAccepted: buildAcceptedDutch(nlTerms),
        enAccepted: buildAcceptedEnglish(enTerms),
      });
    }

    return {
      items,
      totalRows: rows.length - 1,
      skippedRows,
    };
  }

  function getEasinessRanges(practiceMode) {
    return EASINESS_RANGES[practiceMode] || EASINESS_RANGES['nl-to-en'];
  }

  /**
   * Filter vocabulary entries by easiness (character count for active typing language).
   */
  function filterWords(items, config) {
    const practiceMode = config.practiceMode || 'nl-to-en';
    const ranges = getEasinessRanges(practiceMode);
    const range = ranges[config.easiness] || ranges.easy;

    const out = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const len = practiceMode === 'en-to-nl' ? item.enLen : item.nlLen;
      if (len < range.min || len > range.max) continue;
      out.push(item);
    }
    return out;
  }

  /**
   * Randomly sample up to `count` unique entries using partial Fisher-Yates shuffle
   * and lazily enrich the sampled entries with blocks & syllables.
   */
  function sampleWords(pool, count) {
    const n = pool.length;
    const take = Math.min(count, n);
    if (take <= 0) return [];

    const copy = pool.slice();
    const result = [];
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
      result.push(enrichVocabItem(copy[i]));
    }
    return result;
  }

  global.DutchVocabLoader = {
    EASINESS_RANGES,
    getEasinessRanges,
    loadDataset,
    filterWords,
    sampleWords,
    enrichVocabItem,
    segmentDutchSyllables,
    segmentEnglishSyllables,
    normalizeInput,
    foldDiacritics,
  };
})(window);
