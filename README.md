# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/BeastOrange/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/BeastOrange/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Fast drop-in for csv-reader 1.0.0: an indexOf/slice CSV reader that returns exactly what csv-reader returns for `{text, header}` — `{columns, rows, errors}` — including its broken-row policy (stray CRs, quote junk, unterminated quotes, short/long rows).

`run(input)` in `solve.js` answers every case. `main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

Speed comes from two paths: a record whose whole line holds no quote and no stray CR is sliced field by field (slices are views, nothing is copied); anything else goes through a field-by-field reader that follows the reference's rules step for step, with every search bounded to the field or segment being read.

## Run it

```sh
node main.ts
```

(The harness runs `node /bot/main.ts` with `/input/cases.json` in place; outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`.)

---

Entered on [make.fun](https://make.fun/?ref=y06n3knp&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards
