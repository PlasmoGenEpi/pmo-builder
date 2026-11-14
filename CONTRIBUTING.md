# Contributing

Thank you for helping. The conventions for code, words on screen, layout and
privacy are in [AGENTS.md](AGENTS.md). They apply to people as well as coding
agents, so read it first.

## Before you open a pull request

```bash
pnpm install
pnpm check      # format check, lint, typecheck, unit tests, build
pnpm e2e        # end-to-end tests against the build
```

CI runs the same steps on every pull request.

## Ground rules

- Keep user data in the browser. No third-party scripts, fonts or images, and
  no new network requests. Usage counts go through `src/analytics` only. See
  [docs/analytics.md](docs/analytics.md).
- Do not add, remove or upgrade dependencies without agreeing it in an issue
  first. Dependabot proposes updates weekly.
- Put a test beside the code it tests.
- Do not edit `vendor/`. Update pmotools-ts with `pnpm lib:update`.

## Licence

By contributing you agree that your work is released under GPL-3.0-only.
