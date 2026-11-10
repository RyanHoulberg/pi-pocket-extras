# Set up Draw

Give this file to your agent (Pi, Claude, ChatGPT, or whatever you use) with the message:

> Set up Draw for me with my GPU or image API.

It is written for the agent, not for you. The agent reads `draw.ts` too, then fills in `~/.pi-pocket/draw.json`.

## What Draw supports

Draw talks to one backend at a time, chosen in `~/.pi-pocket/draw.json`:

| `backend.kind` | What it is | Use it when |
|---|---|---|
| `comfyui` | A ComfyUI server, with your own workflow JSON | You run ComfyUI locally or on another machine |
| `openai` | Any OpenAI-compatible image API | You have an API key (OpenAI, a proxy, a hosted model) |
| `stink` | The sample local image server in this repo's `EXAMPLE-SERVER.md` | You run that server, or one with the same routes |

The file is read on every request, so a change takes effect at once. It holds API keys: keep it at mode `600`, and never put it in git.

## 1. Ask the person what they have

- A ComfyUI address, such as `http://127.0.0.1:8188` or `http://192.168.1.20:8188`.
- The checkpoint files they want, and whether they want photo editing (img2img) as well as new pictures.
- Or an image API's base URL, key, and model names.

Test that the Pi Pocket machine can reach it. A browser on your laptop reaching ComfyUI does not mean the server running Pi Pocket can.

## 2. ComfyUI

### Find the checkpoints and nodes

```bash
curl -s http://127.0.0.1:8188/system_stats
curl -s http://127.0.0.1:8188/object_info > /tmp/comfy-objects.json
```

In `/tmp/comfy-objects.json`, the checkpoint names are the enum of `CheckpointLoaderSimple.inputs.ckpt_name.required.ckpt_name[0]`. Use one exact name as a model's `id` (or put it in the workflow's `{{model}}` placeholder).

### Make an API workflow

In ComfyUI's own page, build a workflow that draws one picture. Then use **Save (API Format)**, not the normal Save. That JSON is the graph Draw sends to `POST /prompt`.

Put these placeholders exactly where the values go:

| Placeholder | Becomes |
|---|---|
| `{{prompt}}` | The positive prompt |
| `{{negative}}` | The negative prompt (empty string if none) |
| `{{width}}`, `{{height}}` | Integers, 512 to 1024 |
| `{{steps}}` | Integer |
| `{{guidance}}` | Number (called `cfg` in most ComfyUI samplers) |
| `{{seed}}` | Integer |
| `{{model}}` | The model id from `draw.json`, usually the checkpoint filename |
| `{{image}}` | The uploaded input image's filename, for img2img |
| `{{strength}}` | Number, 0.15 to 0.95, for img2img denoise |

A placeholder alone (`"{{seed}}"`) is replaced by a number. Inside a sentence it is replaced as text.

Save the graph as `draw/workflows/<name>.json` beside `draw.ts`. `draw/workflows/example.json` is a minimal SDXL text-to-image graph you can copy.

For photo editing, make a second graph with `LoadImage` (image `{{image}}`), `VAEEncode`, and a `KSampler` whose `denoise` is `{{strength}}`. Give it its own model entry with `"edit": true`.

### Write the config

```json
{
  "backend": {
    "kind": "comfyui",
    "server": "http://127.0.0.1:8188",
    "label": "My ComfyUI"
  },
  "models": [
    {
      "id": "sd_xl_base_1.0.safetensors",
      "label": "SDXL",
      "workflow": "workflows/example.json",
      "steps": 25,
      "guidance": 7,
      "width": 1024,
      "height": 1024,
      "seconds": 30
    },
    {
      "id": "my-edit-workflow",
      "label": "SDXL edit",
      "workflow": "workflows/edit.json",
      "edit": true,
      "strength": 0.65,
      "steps": 25,
      "guidance": 7,
      "seconds": 35
    }
  ]
}
```

`seconds` is only the first estimate for the progress bar; a wrong value costs nothing.

Save it as `~/.pi-pocket/draw.json` with:

```bash
umask 077
# write the file, then:
chmod 600 ~/.pi-pocket/draw.json
```

Test with a cheap prompt at 512×512. If ComfyUI answers `prompt_no_outputs` or a node error, the graph is not in API format or a placeholder is in the wrong input.

## 3. An OpenAI-compatible API

```json
{
  "backend": {
    "kind": "openai",
    "server": "https://api.openai.com/v1",
    "key": "sk-…",
    "label": "OpenAI images"
  },
  "models": [
    { "id": "gpt-image-1", "label": "GPT Image", "edit": true, "width": 1024, "height": 1024, "seconds": 30 }
  ]
}
```

- `server` is the base URL; Draw adds `/images/generations` and `/images/edits`.
- The key is optional for a local server. It can also come from `DRAW_API_KEY` in Pi Pocket's environment.
- `response_format` is `b64_json`. A server that returns a URL instead still works.
- Negative prompts are appended to the prompt as `Avoid: …`; steps, guidance, and seed are not sent.

Test the endpoint without drawing first:

```bash
curl -s -H "Authorization: Bearer $KEY" https://api.openai.com/v1/models
```

## 4. The sample local server (`stink`)

`EXAMPLE-SERVER.md` describes the small HTTP server used by the author's RTX 4090. It has these routes:

- `GET /health` → `{ "busy": false, "edit": ["model-id"] }`
- `GET /files` → `{ "items": [{ "name": "…", "at": 0 }] }`
- `GET /file/<name>` → PNG bytes
- `POST /generate` → starts a text-to-image job
- `POST /edit` → starts an img2img job
- `GET /job` (optional) → what is running

The server writes `<stamp>-<model>-<seed>.png` into its folder; Draw finds the new file by the seed. A user with their own server can implement these routes, or use a `comfyui` or `openai` backend instead.

## 5. Check it

1. Open **Draw** in Pi Pocket.
2. The model list should show what you wrote.
3. Draw a 512×512 test picture.
4. Open **Saved** and check it is there.
5. Ask Pi: `Use draw_picture to draw a red circle on white.` It should return a path and an image.

If the page says Draw is not set up, `~/.pi-pocket/draw.json` is missing or has no models. If it says the backend is offline, test the URL from the Pi Pocket machine. If the draw fails with a node error, check the graph and the checkpoint name.

## Rules

- Never commit `draw.json` or an API key. It is not part of the extension.
- Do not put secrets in a workflow JSON; it is served by Pi Pocket.
- Keep pictures where the person wants them: `saveDir` defaults to `~/.pi-pocket/draw`. The author's config points at `~/pi-durable/data/edits`.
