# Pi Pocket extras

Two drop-ins for [Pi Pocket](https://github.com/TannerMidd/pi-pocket):

- **[Portfolio](portfolio/README.md)** — one page with every project's status, next action, and last activity, linked to its session. Pi keeps it current with `portfolio_update`.
- **[Draw](draw/README.md)** — make and change pictures with your own ComfyUI, any OpenAI-compatible image API, or a local image server, and keep every result. [Setup guide for your agent](draw/draw/SETUP.md).

Both are owner-only pages: they show in the rail, and their routes are for the owner. They hold no keys themselves. Draw's API key, if any, is in `~/.pi-pocket/draw.json`, which is not in this repository.

## Install

Once the gallery entries are merged: **Menu → Extensions → Find extensions**, search for **Portfolio** or **Draw**.

Before that, copy the files into `~/.pi-pocket/extensions/`:

```bash
# Portfolio
cp portfolio/portfolio.ts ~/.pi-pocket/extensions/
cp -r portfolio/portfolio ~/.pi-pocket/extensions/

# Draw
cp draw/draw.ts ~/.pi-pocket/extensions/
cp -r draw/draw ~/.pi-pocket/extensions/
```

Then turn each one on in **Menu → Extensions**. A new drop-in starts off.

## Requirements

- Pi Pocket 0.28 or newer for Portfolio (it uses the session list that routes get).
- Pi Pocket 0.14 or newer for Draw.
- Draw's photo orientation uses ImageMagick (`magick`); without it the photo is sent as it is.
- ComfyUI, or an OpenAI-compatible image API, for Draw. Nothing is downloaded by this repository.

## License

MIT. See [LICENSE](LICENSE).
