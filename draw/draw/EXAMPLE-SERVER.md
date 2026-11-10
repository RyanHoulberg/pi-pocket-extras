# The sample local image server

The author's `stink` backend is a small HTTP server in front of a local GPU. Draw only needs these routes. A user with another server can implement them, or use the `comfyui` or `openai` backend instead.

## Routes

| Method | Path | Answer |
|---|---|---|
| `GET` | `/health` | `{ "busy": false, "edit": ["model-id"] }` — `edit` lists the models that can change a photo |
| `GET` | `/files` | `{ "items": [{ "name": "…", "at": 0 }] }` — newest first; `at` is seconds |
| `GET` | `/file/<name>` | PNG bytes |
| `POST` | `/generate` | Starts a text-to-image job |
| `POST` | `/edit` | Starts an image-to-image job |
| `GET` | `/job` | Optional: what is running now |

`POST /generate` takes:

```json
{
  "model": "z-image-turbo",
  "prompt": "a red circle on white",
  "negative": "",
  "width": 1024,
  "height": 1024,
  "steps": 9,
  "guidance": 0,
  "seed": 1234
}
```

`POST /edit` takes the same fields plus `"image"` (base64 PNG or JPEG) and `"strength"` (0.15 to 0.95).

Both answer at once with the job accepted. Draw finds the result by listing `/files` and looking for a new name that contains the seed. The server must name its files so the seed appears in the name, for example `2026-01-01-120000-z-image-turbo-1234.png`.

## Why this shape

- The long draw is not tied to the phone's connection: the server can finish a job after the request is gone.
- `busy` makes a second tap a `409` instead of a second job on the GPU.
- `edit` tells the page which models can take a photo.

The author's server unloads a chat model from the GPU before drawing and frees the weights afterwards. That is a property of that server, not of Draw.
