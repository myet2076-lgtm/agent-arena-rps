# Releasing `@myet2076/arena-cli`

This is the standard release flow for the CLI package in `packages/arena-cli`.

## 1) Preflight

```bash
cd /Users/et/Projects/agent-arena-rps
git pull --rebase
npm whoami
```

## 2) Update package version

```bash
cd /Users/et/Projects/agent-arena-rps/packages/arena-cli
npm version patch --no-git-tag-version
```

Use `minor` or `major` when needed.

## 3) Verify package metadata

```bash
npm pkg get name version
```

Expected package name:

`@myet2076/arena-cli`

## 4) Publish to npm

```bash
npm publish --access public
```

If npm asks browser auth, complete it and retry if needed.

## 5) Verify npm publication

```bash
npm view @myet2076/arena-cli version
```

## 6) Commit + tag

```bash
cd /Users/et/Projects/agent-arena-rps
git add -A
git commit -m "chore(release): arena-cli vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

## 7) Create GitHub Release

```bash
gh release create vX.Y.Z \
  --repo myet2076-lgtm/agent-arena-rps \
  --title "vX.Y.Z" \
  --notes-file /Users/et/Projects/agent-arena-rps/docs/RELEASE_TEMPLATE.md
```

Then edit release notes to keep only the filled changelog content.

## Common failures

- `E403 Package name too similar`
Use scoped name `@myet2076/arena-cli`.

- `EOTP`
Use a fresh OTP code or complete npm web auth flow.

- `E403 2FA required`
Use account 2FA flow or a token policy that allows publish.
