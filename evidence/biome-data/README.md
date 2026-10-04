# Biome profile refactor: identical output against main

The refactor in `fm/soaring-biome-data` makes the existing biome set data-driven. It must not change any output. I compared it with main at `4dc0610` (#130, moon and stars) on 2026-10-04.

## Biome data

`tests/biomes.smoke.ts` writes `biome-parity.json`. It holds world samples, ground RGB at three slopes, shared-mesh hashes, and tree placement and tints at five poses. It excludes timing and animation state.

| Build | File | SHA-256 |
| --- | --- | --- |
| main | `main-biome-parity.json` | `851b1d2ff46bad379899c83c410430dc39fecd3a25a82f5c6b4ea345c467fa3a` |
| refactor | `refactor-biome-parity.json` | `851b1d2ff46bad379899c83c410430dc39fecd3a25a82f5c6b4ea345c467fa3a` |

The two files are byte-identical. The main file comes from the refactor's test run against main's `src/`. The swap leaves the branch's new `src/biomes/` files in place, but main's `src/` does not import them.

## Pictures

`npm run parity` with `PARITY_FIXED_CLOCK=1` pins page time, so animation does not change between captures. All runs used seed 5, DPR 1, two repeats, and one vantage per Chrome invocation. Each run started a fresh dev server.

1. `mainA`: main's `src/`, no reference.
2. `mainB`: main's `src/`, reference `mainA`. This is the cross-session control.
3. `refactor`: refactor `src/`, reference `mainA`.

First 16 hex digits of the SHA-256 of each decompressed RGBA capture:

| Vantage | All six captures (mainA, mainB, refactor; two repeats each) |
| --- | --- |
| lake-noon | `f11633de5c847b73` |
| coast-noon | `0fe620dab1564eb8` |
| basin-golden-hour | `3c53196ac0d1e0f2` |
| islands-noon | `f45917f22542e527` |
| origin-night | `b303f78e8b54c948` |

Every refactor capture equals main byte for byte. All 30 captures logged the same `cloudTime`, 0.002560.

`fixed-clock/*.parity.json` holds each run's measurements and environment. `fixed-*.log` holds the logged clock state for each capture. The `commit` field names the branch commit for every run, because only `src/` was swapped. The RGBA captures stay under the ignored `artifacts/look-parity/biome-data-fixed-m4*` directories.

## Earlier runs

Against the earlier mains `c7ffdb8` (#127) and `d80b813`, the refactor also matched byte for byte. Main's sky changes since `c7ffdb8` changed the lake-noon and origin-night captures for both builds. One cold first load there shifted `cloudTime` by three frames, and a rerun matched. Wall-clock captures without the fixed clock were not repeatable even main against main, so they cannot prove identity.

## Speed

The first version of this refactor made `WorldModel.sample` about 20% slower, and a CI navigation test timed out. Per-call `Object.fromEntries`, arrays, and `reduce` callbacks caused it. The refactor now copies a weights template, reuses scratch storage, and uses plain loops. In a 600,000-call Node benchmark on `c7ffdb8`, sampling took 2,116–2,211 ms on the branch and 2,176–2,191 ms on main. Main has not changed terrain or world code since then. `tests/navigation.test.ts` took 10.7 s and 12.5 s on the branch, against 10.4 s and 13.8 s on main.

## Checks

`check.log` and `smoke.log` hold `npm run check` and `npm run test:smoke -- --workers=1` on the refactor.
