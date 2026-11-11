# Contributing to Transparent Earth

Thanks for helping. New layers, better data, bug fixes, and reports from real phones and
headsets are all welcome.

## Ways to help

- **Test on a device.** Frame rates, compass alignment and the gyro on real phones, Cardboard
  viewers and the Quest 3S haven't been measured yet. A [bug report](../../issues/new/choose)
  that names the device and browser is valuable.
- **Suggest a dataset.** Open a *data source* issue with a link to the data and its licence.
- **Fix or build something.** For anything bigger than a small fix, open an issue first so
  we can agree on the approach.

## The data rules

These rules are what make the app trustworthy, so pull requests that break them can't be
merged.

1. **Real data only.** Never invent, interpolate or "fill in" data points. If the data
   isn't there, the layer says so instead.
2. **Free, public and keyless.** No API keys, sign-ups or paid sources.
3. **Licence checked and recorded.** The licence must allow the data to be redistributed in
   this repository and shown in the app. Every layer declares `credits` in its `layer.ts`.
   Add a row and a section to the matching file in `docs/data-sources/`, then run
   `npm run docs:sources` to regenerate [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).
4. **Reproducible.** Static data is baked by a script in `tools/pipeline/` from its
   original URL. Raw downloads go to the git-ignored cache, never into the repository.
5. **Checked.** Each bake comes with a `test_<name>.py` that checks the output against its
   source and against at least one independently published value. Cite the value you
   check against, and verify it rather than quoting it from memory. If the data
   disagrees with a check, drop the check and say why. Don't bend the check to fit.
6. **Live data degrades gracefully.** Fetch from CORS-safe endpoints, cache the result,
   and fall back to a baked snapshot when the fetch fails.
7. **Light enough for a phone.** Keep textures to 2048×1024 unless a layer really needs
   more, and keep JSON small.

## Development

```bash
npm ci
npm run dev                    # http://localhost:5173
```

Before you push, the full gate must pass. CI runs the same steps:

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run docs:sources -- --check
```

To look at a layer without a browser window, take a headless screenshot. See the header
of [tools/screenshot/shot.mjs](tools/screenshot/shot.mjs) for the options.

```bash
node tools/screenshot/shot.mjs out.png --only gravity-anomaly --lat 15 --lon -70 --pitch -35
```

To rebuild a dataset, see [tools/pipeline/README.md](tools/pipeline/README.md).

### Adding a layer

A layer is a folder `app/src/layers/<id>/` with a `layer.ts` that exports a
`LayerDefinition`. It gives the id, label, menu section, order, legend, caption, credits and
a `load` function. Layers are found automatically. Look at a recent one, such as
`app/src/layers/permafrost/`, for the pattern. Pure logic (decoding, colours, geometry)
goes in its own file with a Vitest test beside it.

## Style

- TypeScript in strict mode. Use single quotes and lines up to about 150 columns, as in the
  existing code. **Don't run Prettier or another formatter on the tree:** there's no
  formatter config, and a reformat would rewrite every file.
- Comments say *why*, and cite sources for numbers.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`,
  with a subject of 72 characters or fewer. For example,
  `feat(app): northern permafrost zones` or `fix(pipeline): keep rays with one residual`.
- Make each commit one logical change that builds and passes the gate by itself. The body
  says why.
- Stage specific files. Don't commit secrets, build output, debug logging or large raw
  downloads.
- In the pull request, describe what changed and how you checked it. Attach a screenshot
  for anything visual.

By contributing, you agree that your code is released under the [MIT licence](LICENSE).
Any data you add keeps its own licence, and you must record that licence.

Please follow the [code of conduct](CODE_OF_CONDUCT.md).
