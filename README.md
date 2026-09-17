# Next Ball

A local-first golf practice PWA. Live at **[nextballgolf.com](https://nextballgolf.com)**.

Zero build system, zero dependencies, native ES modules. Open the folder and it runs;
`git push` deploys it.

```bash
node --test "test/*.test.js"
```

## Deploying

Bump `BUILD_VERSION` in `js/version.js` and `CACHE_NAME` in `service-worker.js`
together, then push. The service worker is cache-first, so the version bump is what
releases the change to installed apps.

## Documentation

**Product strategy and specifications live in a separate private repository.** They were
moved out of this one so that unreleased plans are not published alongside the app —
GitHub Pages serves every tracked file here, and `_config.yml` now excludes the rest.
