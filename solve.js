// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// answer {columns, rows, errors} for {text, header}, but reads the text with
// indexOf/slice instead of one character at a time.
//
// Two paths. A record whose whole line holds no quote and no stray CR is
// sliced field by field (slices are views, nothing is copied), which covers
// the overwhelming majority of records in the drawn sets. Anything else (a
// quote, a CR, a quoted field spanning lines) falls back to a field-by-field
// reader that follows the reference's policy step for step. Every search in
// the slow path is bounded to the field or segment being read (a search is
// run on a slice of it), so no call ever scans past the end of its field:
// an unbounded indexOf for a rare character would rescan the rest of the
// file on every field. The slow path is a line-for-line port of the
// reference's rules, so the two paths agree on every input:
//
//   - U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next non-doubled quote, ""
//     inside it is one quote, CRLF/lone CR inside it read as LF; what follows
//     its closing quote, up to the next comma or line break, is appended as
//     it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character and the text after it is read again as unquoted
//     (unterminated_quote); a quote inside an unquoted field is literal;
//   - columns is the first record when header is true, else null; rows are
//     padded with "" (short_row, fields: its count) or cut (long_row, extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met; line is the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR inside
//     quotes; row is its record's index in rows, null for the header.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). The slow-path readers below report errors
  // against these.
  let recLine = 1;
  let recRow = null;

  // Drops every stray CR in `seg` (a slice of one field), reporting one
  // stray_cr each, and appends what is kept onto `value`. Returns [value, added].
  function dropStrayCrs(value, seg, added) {
    let p = 0;
    while (true) {
      const r = seg.indexOf('\r', p);
      if (r === -1) {
        if (p < seg.length) { value += seg.slice(p); added += seg.length - p; }
        return [value, added];
      }
      if (r > p) { value += seg.slice(p, r); added += r - p; }
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      p = r + 1;
    }
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break. Returns the field and how it ended; `added` counts the
  // characters kept.
  function readUnquoted(value) {
    let added = 0;
    if (pos >= n) return { value, ended: END, added };
    const ci = text.indexOf(',', pos);
    const ni = text.indexOf('\n', pos);
    let m = -1;
    let isComma = false;
    if (ci !== -1) { m = ci; isComma = true; }
    if (ni !== -1 && (m === -1 || ni < m)) { m = ni; isComma = false; }
    if (m === -1) {
      // No comma and no LF to the end of the text: any CR left is stray.
      const seg = text.slice(pos, n);
      if (seg.indexOf('\r') === -1) {
        value += seg;
        added += n - pos;
      } else {
        [value, added] = dropStrayCrs(value, seg, added);
      }
      pos = n;
      return { value, ended: END, added };
    }
    // The field's own characters are text[pos..m), except a CR that is the
    // CRLF half of a line break, which is not a character of the field.
    let segEnd = m;
    if (!isComma && m > pos && text.charCodeAt(m - 1) === 13) segEnd = m - 1;
    if (segEnd > pos) {
      const seg = text.slice(pos, segEnd);
      if (seg.indexOf('\r') === -1) {
        value += seg;
        added += segEnd - pos;
      } else {
        [value, added] = dropStrayCrs(value, seg, added);
      }
    }
    if (isComma) {
      pos = m + 1;
      return { value, ended: COMMA, added };
    }
    pos = m + 1;
    line += 1;
    return { value, ended: LINE_BREAK, added };
  }

  // Appends text[a..b) to `value`, reading each CRLF or lone CR inside it
  // as one LF and counting the line. The common case (no CR or LF in the
  // slice) is a single concatenation.
  function appendSegment(value, a, b) {
    const seg = text.slice(a, b);
    if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) return value + seg;
    let out = value;
    let p = 0;
    const len = seg.length;
    while (p < len) {
      const ri = seg.indexOf('\r', p);
      const ni = seg.indexOf('\n', p);
      let m = -1;
      if (ri !== -1) m = ri;
      if (ni !== -1 && (m === -1 || ni < m)) m = ni;
      if (m === -1) {
        out += seg.slice(p);
        break;
      }
      if (m > p) out += seg.slice(p, m);
      out += '\n';
      line += 1;
      p = seg.charCodeAt(m) === 13 && seg.charCodeAt(m + 1) === 10 ? m + 2 : m + 1;
    }
    return out;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let segStart = pos;
    while (true) {
      const qi = text.indexOf('"', pos);
      if (qi === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
        return readUnquoted('"');
      }
      value = appendSegment(value, segStart, qi);
      if (text.charCodeAt(qi + 1) === 34) {
        value += '"';
        pos = qi + 2;
        segStart = pos;
        continue;
      }
      pos = qi + 1;
      if (pos >= n) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
      return junk;
    }
  }

  // Finishes a record: the header is kept as columns, every other record is
  // padded or cut to the first record's width.
  function finish(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    // Fast path: the record ends at the next LF (or the end of the text)
    // and its line holds no quote and no stray CR. A trailing CR before
    // the LF is the CRLF line break and is stripped. Fields are sliced out
    // one by one (slices are views, nothing is copied).
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    let end = lineEnd;
    if (nl !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) end = lineEnd - 1;
    const seg = text.slice(pos, end);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      const fields = [];
      let p = pos;
      while (true) {
        const ci = text.indexOf(',', p);
        if (ci === -1 || ci >= end) { fields.push(text.slice(p, end)); break; }
        fields.push(text.slice(p, ci));
        p = ci + 1;
      }
      pos = nl === -1 ? n : nl + 1;
      line += 1;
      // A line that held only stray CRs is left with no characters: no
      // record (unreachable here, the segment is never empty, but kept so
      // the fast path matches the reference on every input).
      if (fields.length === 1 && fields[0] === '') continue;
      if (width < 0) width = fields.length;
      if (header && columns === null) { columns = fields; continue; }
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
      }
      rows.push(fields);
      continue;
    }

    // Slow path: the record holds a quote, a stray CR, or a quoted field
    // spanning lines.
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finish(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
