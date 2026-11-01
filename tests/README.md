# Regression checks

`core.test.cjs` uses Node's built-in test runner and evaluates only the inline pure-domain scripts. It verifies the original 12-week plans and 17 exercise records against the pre-cooking snapshot, existing nutrition/training calculations, validated migration of old backups, full-state preservation, cooking validation, recipe selection and serving arithmetic. Saved favorites must also be reproducible from their ingredient and equipment settings.

`browser.test.cjs` requires Playwright and its Chromium browser. It starts its own ephemeral server bound to `127.0.0.1` and uses isolated browser contexts. It tests real UI interactions, automatic save before blur, backup download/import confirmation, legacy migration, rejected imports, original malformed-storage protection, cooking favorites, meal recording, and 320/375/390 px mobile layouts. Simulated storage quota failures verify that favorite/meal edits and backup imports preserve old data and remain retryable, including recovery from a previously malformed local store.

```sh
node --test tests/core.test.cjs
node --test tests/browser.test.cjs
```

If Playwright is installed outside this project, set `NODE_PATH` to the directory that contains the `playwright` package. Set `LIANJI_TEST_OUTPUT` to choose the output directory for screenshots; it defaults to an operating-system temporary directory. Test outputs are not part of the app source.

The teaching checks verify preserved independent URLs and reachable app links. They do not claim playback verification on Bilibili or on a physical phone. Mobile coverage uses Chromium emulation.
