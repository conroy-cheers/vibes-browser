# vibes-browser

`vibes-browser` is a single-command local HTTP server that uses the OpenAI API to act like a website origin server.

## Usage

```bash
node --env-file=.env ./src/cli.mjs
```

Then open the printed URL in a browser, enter a seed phrase, and navigate the generated site.

## Commands

```bash
npm install
npm test
npm run build:sea
```

## Nix

```bash
nix develop
nix build .#vibes-browser
./result/bin/vibes-browser --help
```
