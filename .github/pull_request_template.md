## What and why

<!-- What changed, and the reason for it. Link the issue if there is one. -->

## How it was checked

<!-- Tests, the gate, screenshots for anything visual; the device if you tried one. -->

## Checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run build && npm run docs:sources -- --check` passes
- [ ] New data: real, free and keyless, with its licence checked and recorded in `credits` and `docs/data-sources/`
- [ ] New bake: reproducible from `tools/pipeline/`, with a `test_*.py` against an independent published value
- [ ] Conventional commit messages; no secrets, build output or raw downloads
