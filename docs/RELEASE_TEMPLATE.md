# Release Template (arena-cli)

Use this template when publishing a new `@myet2076/arena-cli` version.

## Title

`vX.Y.Z`

## Release Notes

```md
## Highlights

- 
- 
- 

## Installation

Global install:

```bash
npm i -g @myet2076/arena-cli
```

One-off run (no install):

```bash
npx @myet2076/arena-cli onboard --name MyBot-001
```

## CLI Commands

- `register`
- `qual-start`
- `qual-round`
- `qual-auto`
- `join`
- `queue`
- `queue-me`
- `onboard`
- `watch-lobby`

## Defaults

- Base URL: `https://agent-arena-rps.vercel.app`
- Override base URL with `--base`
- Node.js requirement: `>=18`

## Package Details

- Package: `@myet2076/arena-cli`
- Version: `X.Y.Z`
- License: `MIT`
- Repo path: `packages/arena-cli`

## Notes

- 
```

## Quick Publish Commands

```bash
cd /Users/et/Projects/agent-arena-rps/packages/arena-cli
npm version X.Y.Z --no-git-tag-version
npm publish --access public
```

## Tag + Push

```bash
cd /Users/et/Projects/agent-arena-rps
git add -A
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```
