# Draw

Make and change pictures with your own GPU or image API, and keep every result in Pi Pocket.

- **Three backends** — a ComfyUI server with your own workflow, any OpenAI-compatible image API, or the small local server used by the author.
- **No hardcoded models** — `~/.pi-pocket/draw.json` lists the models and their settings.
- **Open-ended setup** — [SETUP.md](draw/SETUP.md) is written for your agent: give it the file and say "set up Draw with my GPU or API".
- **Saved** — every picture is kept, searchable, and starrable. Paint from a phone and find it later.

## Quick start with ComfyUI

1. Export a workflow from ComfyUI as **API Format**.
2. Replace the prompt, size, steps, seed, and checkpoint values with placeholders (`{{prompt}}`, `{{width}}`, …). See [SETUP.md](draw/SETUP.md).
3. Save it as `draw/workflows/<name>.json` beside `draw.ts`.
4. Write `~/.pi-pocket/draw.json` (mode 600):

```json
{
  "backend": { "kind": "comfyui", "server": "http://127.0.0.1:8188", "label": "My ComfyUI" },
  "models": [
    {
      "id": "sd_xl_base_1.0.safetensors",
      "label": "SDXL",
      "workflow": "workflows/example.json",
      "steps": 25,
      "guidance": 7,
      "width": 1024,
      "height": 1024
    }
  ]
}
```

5. Open **Draw**, or ask Pi: `Use draw_picture to draw a red circle on white.`

[SETUP.md](draw/SETUP.md) has the full guide, the placeholder table, an OpenAI-compatible example, and the sample server's routes. [EXAMPLE-SERVER.md](draw/EXAMPLE-SERVER.md) documents the local server contract.

## Install

Copy `draw.ts` and `draw/` into `~/.pi-pocket/extensions/`, then turn Draw on in **Menu → Extensions**. Or install it from the gallery once its entry is merged.

Requires Pi Pocket 0.14.0 or newer.

## Files and data

- Pictures: `saveDir` in `draw.json`, default `~/.pi-pocket/draw`.
- Index: `.draw-index.json` beside them, mode 600.
- Config: `~/.pi-pocket/draw.json`, mode 600. It may hold an API key; it is never read by the page or sent to Pi.
- Tool: `draw_picture`.
- Routes: `GET status`, `POST make`, `GET job`, `POST sync`, `GET saved`, `GET file/:name`, `POST star`.

The page and routes are for the owner only. No analytics, no telemetry, no network call except the backend in `draw.json`.

## License

MIT.
