# csv-reader-speed-01 — faster drop-in for csv-reader 1.0.0

`run(input)` in `solve.js` returns exactly what make.fun's csv-reader 1.0.0
returns for `{text, header}`: `{columns, rows, errors}`, including its
broken-row policy (stray CRs, quote junk, unterminated quotes, short/long
rows). `main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

Speed comes from two paths: a record whose whole line holds no quote and no
stray CR is split in one go (`String.split(',')`); anything else goes
through a field-by-field reader that follows the reference's rules step for
step, using `indexOf` to skip runs of ordinary characters instead of reading
one character at a time.
