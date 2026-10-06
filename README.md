# jailbreaked

system prompt forge. one button. random every roll.

static site — no build step, no api, no deps. pure html/css/js.

## files

- `index.html` — markup
- `styles.css` — monochrome theme
- `blocks.js` — persona / framing / block registry
- `app.js` — rng + composer + ui
- `vercel.json` — static hosting config

## deploy

push to `main`. vercel auto-detects static, skips build, serves root.

first-time setup on termux:

    git init
    git add .
    git commit -m "init"
    git remote add origin https://github.com/krislowk/jailbreaked.git
    git branch -M main
    git push -u origin main

then in vercel: import the repo, framework preset = **Other**,
build command = blank, output directory = blank (root).

## local preview

    python -m http.server 3000

open http://localhost:3000
