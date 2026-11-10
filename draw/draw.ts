/**
 * Draw: a page in Pi Pocket that makes and changes pictures with a ComfyUI server, any OpenAI-compatible image API,
 * or a local image server, and keeps every result. Which one it uses, and which models it offers, is in
 * ~/.pi-pocket/draw.json. Read SETUP.md to set it up with your own GPU or API.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
// A type import is gone when the module runs. In the drop-in folder, the types are "./_pocket.d.ts".
import type { Host, Web } from "./_pocket.d.ts";

/** The drop-in folder, so a workflow path in the config can be relative to it. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

type Kind = "comfyui" | "openai" | "stink";

type Model = {
    id: string;
    label: string;
    edit?: boolean;
    steps?: number;
    guidance?: number;
    width?: number;
    height?: number;
    strength?: number;
    /** A rough number of seconds a cold picture takes, for the progress bar. */
    seconds?: number;
    /** ComfyUI: an API-format workflow, or a .json file in draw/workflows/ beside this module. */
    workflow?: string | Record<string, unknown>;
};

type Config = {
    backend?: {
        kind?: Kind;
        server?: string;
        label?: string;
        key?: string;
    };
    models?: Model[];
    saveDir?: string;
    note?: string;
};

/** What every kept picture is called. Nothing else reaches the disk. */
const NAME = /^[0-9a-f]{16}\.png$/;
const LONGEST = 1_200_000;

type Kept = {
    prompt?: string;
    model?: string;
    seed?: number | null;
    star?: number;
    at?: number;
    name?: string;
    from?: string | null;
};

function text(value: unknown, max: number): string {
    return typeof value === "string" ? value.slice(0, max) : "";
}

function number(value: unknown, low: number, high: number, whole = true): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;

    const n = Number(value);

    if (!Number.isFinite(n) || n < low || n > high) return undefined;

    return whole ? Math.round(n) : n;
}

function expand(value: string): string {
    return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}

function trim(value: string): string {
    return value.replace(/\/+$/, "");
}

async function config(host: Host): Promise<Config> {
    try {
        const parsed = JSON.parse(await readFile(join(host.dataDir, "draw.json"), "utf8")) as Config;
        const kind = parsed.backend?.kind;

        if (kind !== "comfyui" && kind !== "openai" && kind !== "stink") return {};

        return {
            backend: {
                kind,
                server: typeof parsed.backend?.server === "string" ? parsed.backend.server : "",
                label: typeof parsed.backend?.label === "string" ? parsed.backend.label : kind,
                key: typeof parsed.backend?.key === "string" ? parsed.backend.key : process.env.DRAW_API_KEY,
            },
            models: (Array.isArray(parsed.models) ? parsed.models : []).filter(
                (each): each is Model => !!each && typeof each.id === "string" && typeof each.label === "string",
            ),
            saveDir: typeof parsed.saveDir === "string" ? parsed.saveDir : undefined,
            note: typeof parsed.note === "string" ? parsed.note : undefined,
        };
    } catch {
        return {};
    }
}

function folderFor(host: Host, cfg: Config): string {
    return cfg.saveDir ? expand(cfg.saveDir) : join(host.dataDir, "draw");
}

function indexFor(folder: string): string {
    return join(folder, ".draw-index.json");
}

async function readIndex(folder: string): Promise<Record<string, Kept>> {
    if (!existsSync(indexFor(folder))) return {};

    try {
        return JSON.parse(await readFile(indexFor(folder), "utf8")) as Record<string, Kept>;
    } catch {
        return {};
    }
}

async function keep(folder: string, name: string, record: Kept): Promise<void> {
    const index = await readIndex(folder);

    index[name] = { ...index[name], ...record, name };

    await mkdir(folder, { recursive: true });
    await writeFile(indexFor(folder), JSON.stringify(index, null, 1), { mode: 0o600 });
}

/**
 * The photo's pixels the way a phone shows them. Cameras store the picture sideways and keep the rotation in EXIF,
 * which the editors ignore: without this, a portrait photo comes back lying on its side. ImageMagick does the turn.
 */
async function upright(file: string, bytes: Buffer): Promise<Buffer> {
    const out = join(tmpdir(), `upright-${crypto.randomUUID().slice(0, 8)}.jpg`);

    try {
        await new Promise<void>((done, fail) => {
            execFile("magick", [file, "-auto-orient", "-strip", "-quality", "95", out], { timeout: 30_000 }, (error) =>
                error === null ? done() : fail(error),
            );
        });

        return await readFile(out);
    } catch {
        return bytes;
    } finally {
        await unlink(out).catch(() => {});
    }
}

type Health = {
    online: boolean;
    busy: boolean;
    canEdit: string[];
    reason?: string;
};

const OFFLINE: Health = { online: false, busy: false, canEdit: [] };

/** The picture being drawn now, for the progress bar. */
type Running = { label: string; seconds: number; started: number; steps: number | null };

let running: Running | null = null;

class BadRequest extends Error {
    readonly status = 400;
}

class Busy extends Error {
    readonly status = 409;
}

class BadGateway extends Error {
    readonly status = 502;
}

function secondsOf(model: Model): number {
    return Math.min(model.seconds ?? 90, LONGEST / 1000);
}

async function health(cfg: Config, signal?: AbortSignal): Promise<Health> {
    const backend = cfg.backend;

    if (!backend?.server) {
        return { ...OFFLINE, reason: "Draw is not set up yet. Open SETUP.md in the draw folder, or ask your agent to set it up." };
    }

    const canEdit = (cfg.models ?? []).filter((each) => each.edit).map((each) => each.id);
    const server = trim(backend.server);

    if (backend.kind === "openai") {
        try {
            const answer = await fetch(`${openaiBase(server)}/models`, {
                headers: auth(backend.key),
                signal: AbortSignal.timeout(5000),
            });

            if (answer.ok || answer.status === 401 || answer.status === 403) {
                return { online: answer.ok, busy: running !== null, canEdit, reason: answer.ok ? undefined : `The image API refused the key (${answer.status}).` };
            }
        } catch {
            // fall through to the reason below
        }

        return { ...OFFLINE, canEdit, reason: `No answer from ${server}. Is the image API reachable?` };
    }

    if (backend.kind === "stink") {
        try {
            const answer = await fetch(`${server}/health`, { signal: AbortSignal.timeout(15000) });

            if (!answer.ok) return { ...OFFLINE, canEdit, reason: `The image server answered ${answer.status}.` };

            const said = (await answer.json()) as { busy?: boolean; edit?: string[] };

            return { online: true, busy: said.busy === true || running !== null, canEdit: said.edit ?? canEdit };
        } catch {
            return { ...OFFLINE, canEdit, reason: `No answer from ${server}. Is the image server up?` };
        }
    }

    // ComfyUI
    try {
        const answer = await fetch(`${server}/system_stats`, { signal: AbortSignal.timeout(5000) });

        return answer.ok
            ? { online: true, busy: running !== null, canEdit }
            : { ...OFFLINE, canEdit, reason: `ComfyUI answered ${answer.status}.` };
    } catch {
        return { ...OFFLINE, canEdit, reason: `No answer from ${server}. Is ComfyUI running?` };
    }
}

function auth(key?: string): Record<string, string> {
    return key ? { authorization: `Bearer ${key}` } : {};
}

function openaiBase(server: string): string {
    return /\/v\d+$/.test(server) ? server : `${server}/v1`;
}

async function jsonOrError(answer: Response, what: string): Promise<any> {
    const body = await answer.json().catch(() => undefined);

    if (!answer.ok) {
        const said = body?.error?.message ?? body?.message ?? body?.error;

        throw new BadGateway(`${what} answered ${answer.status}${said ? `: ${String(said).slice(0, 300)}` : ""}.`);
    }

    return body;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((done) => setTimeout(done, ms));
    signal?.throwIfAborted();
}

/** The ComfyUI graph with the request's values in its placeholders. */
function fill(node: unknown, values: Record<string, string | number>): unknown {
    if (Array.isArray(node)) return node.map((each) => fill(each, values));

    if (node !== null && typeof node === "object") {
        const out: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(node as Record<string, unknown>)) out[key] = fill(value, values);

        return out;
    }

    if (typeof node !== "string") return node;

    const exact = node.match(/^\{\{(\w+)\}\}$/);

    if (exact && exact[1] in values) return values[exact[1]];

    return node.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
}

async function workflowOf(model: Model): Promise<Record<string, unknown>> {
    if (model.workflow === undefined) {
        throw new BadRequest(`Model ${model.id} has no workflow. Put one in draw.json, or read SETUP.md.`);
    }

    if (typeof model.workflow === "object") return structuredClone(model.workflow);

    const raw = model.workflow.trim();

    if (raw.startsWith("{")) return JSON.parse(raw);

    const file = isAbsolute(raw) ? raw : join(MODULE_DIR, "draw", raw);
    const parsed = JSON.parse(await readFile(file, "utf8"));

    return parsed.prompt ?? parsed;
}

async function makeComfy(
    backend: NonNullable<Config["backend"]>,
    model: Model,
    request: { prompt: string; negative: string; width: number; height: number; steps: number; guidance: number; seed: number; strength: number; image?: string },
    signal?: AbortSignal,
): Promise<{ png: Buffer; from?: string }> {
    const server = trim(backend.server ?? "");
    let imageName: string | undefined;

    if (request.image) {
        const form = new FormData();

        form.append("image", new Blob([new Uint8Array(Buffer.from(request.image, "base64"))], { type: "image/png" }), "draw-input.png");
        form.append("overwrite", "true");

        const answer = await fetch(`${server}/upload/image`, { method: "POST", body: form, signal });
        const said = await jsonOrError(answer, "ComfyUI's upload");

        imageName = said.subfolder ? `${said.subfolder}/${said.name}` : said.name;
    }

    const workflow = fill(await workflowOf(model), {
        prompt: request.prompt,
        negative: request.negative,
        width: request.width,
        height: request.height,
        steps: request.steps,
        guidance: request.guidance,
        seed: request.seed,
        strength: request.strength,
        model: model.id,
        image: imageName ?? "",
    });

    const answer = await fetch(`${server}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
        signal,
    });
    const queued = await jsonOrError(answer, "ComfyUI");

    if (!queued?.prompt_id) {
        throw new BadRequest(queued?.node_errors ? `ComfyUI refused the workflow: ${JSON.stringify(queued.node_errors).slice(0, 400)}` : "ComfyUI refused the workflow.");
    }

    const ends = Date.now() + LONGEST;
    const id = queued.prompt_id;

    for (;;) {
        if (Date.now() > ends) throw new BadGateway("ComfyUI did not finish in twenty minutes.");

        await sleep(1500, signal);

        const history = await fetch(`${server}/history/${encodeURIComponent(id)}`, { signal }).catch(() => undefined);

        if (!history?.ok) continue;

        const all = await history.json().catch(() => undefined);
        const entry = all?.[id];

        if (!entry) continue;

        if (entry.status?.status_str === "error") {
            throw new BadGateway(`ComfyUI could not draw it: ${JSON.stringify(entry.status).slice(0, 400)}`);
        }

        for (const output of Object.values(entry.outputs ?? {}) as any[]) {
            const image = output?.images?.[0];

            if (!image?.filename) continue;

            const query = new URLSearchParams({
                filename: image.filename,
                subfolder: image.subfolder ?? "",
                type: image.type ?? "output",
            });
            const png = await fetch(`${server}/view?${query}`, { signal });

            if (!png.ok) continue;

            return { png: Buffer.from(await png.arrayBuffer()), from: image.filename };
        }
    }
}

async function makeOpenAI(
    backend: NonNullable<Config["backend"]>,
    model: Model,
    request: { prompt: string; negative: string; width: number; height: number; image?: string },
    signal?: AbortSignal,
): Promise<{ png: Buffer; from?: string }> {
    const server = openaiBase(trim(backend.server ?? ""));
    const prompt = request.negative ? `${request.prompt}\n\nAvoid: ${request.negative}` : request.prompt;
    let answer: Response;

    if (request.image) {
        const form = new FormData();

        form.append("image", new Blob([new Uint8Array(Buffer.from(request.image, "base64"))], { type: "image/png" }), "draw-input.png");
        form.append("prompt", prompt);
        form.append("model", model.id);
        form.append("size", `${request.width}x${request.height}`);
        form.append("response_format", "b64_json");
        answer = await fetch(`${server}/images/edits`, { method: "POST", headers: auth(backend.key), body: form, signal });
    } else {
        answer = await fetch(`${server}/images/generations`, {
            method: "POST",
            headers: { "content-type": "application/json", ...auth(backend.key) },
            body: JSON.stringify({
                model: model.id,
                prompt,
                n: 1,
                size: `${request.width}x${request.height}`,
                response_format: "b64_json",
            }),
            signal,
        });
    }

    const said = await jsonOrError(answer, "The image API");
    const first = said?.data?.[0];

    if (first?.b64_json) return { png: Buffer.from(first.b64_json, "base64"), from: undefined };

    if (first?.url) {
        const png = await fetch(first.url, { signal });

        if (png.ok) return { png: Buffer.from(await png.arrayBuffer()), from: undefined };
    }

    throw new BadGateway("The image API returned no picture.");
}

async function makeStink(
    backend: NonNullable<Config["backend"]>,
    model: Model,
    request: { prompt: string; negative: string; width: number; height: number; steps: number; guidance: number; seed: number; strength: number; image?: string },
    signal?: AbortSignal,
): Promise<{ png: Buffer; from?: string }> {
    const server = trim(backend.server ?? "");
    const ask = async (path: string, init?: RequestInit): Promise<Response> => {
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), LONGEST);

        try {
            return await fetch(`${server}${path}`, { ...init, signal: stop.signal });
        } finally {
            clearTimeout(timer);
        }
    };
    const listed = await ask("/files").catch(() => undefined);

    if (!listed?.ok) throw new BadGateway(`No answer from ${server}. Is the image server up?`);

    const had = new Set(((await listed.json()) as { items?: { name: string }[] }).items?.map((each) => each.name) ?? []);
    const body: Record<string, unknown> = {
        model: model.id,
        prompt: request.prompt,
        width: request.width,
        height: request.height,
        steps: request.steps,
        guidance: request.guidance,
        seed: request.seed,
    };

    if (request.negative) body.negative = request.negative;
    if (request.image) {
        body.image = request.image;
        body.strength = request.strength;
    }

    let trouble: Error | undefined;

    // Not awaited: a long draw can outlive the connection, and the file on disk does not care.
    ask(request.image ? "/edit" : "/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }).then(
        async (answer) => {
            if (answer.ok) return;

            const said = (await answer.json().catch(() => ({}))) as { error?: string };

            trouble =
                answer.status === 409
                    ? new Busy(said.error ?? "A picture is already being drawn.")
                    : answer.status === 400
                      ? new BadRequest(said.error ?? "The image server could not take that.")
                      : new BadGateway(said.error ?? `The image server answered ${answer.status}.`);
        },
        () => {
            trouble = new BadGateway(`No answer from ${server}. Is the image server up?`);
        },
    );

    const ends = Date.now() + LONGEST;

    for (;;) {
        if (trouble) throw trouble;
        if (Date.now() > ends) throw new BadGateway("The picture did not appear in twenty minutes.");

        const res = await ask("/files").catch(() => undefined);

        if (res?.ok) {
            const found = ((await res.json()) as { items?: { name: string }[] }).items?.find(
                (each) => !had.has(each.name) && (each.name.includes(`-${request.seed}.png`) || each.name.includes(`-${request.seed}-`)),
            );

            if (found) {
                const png = await ask(`/file/${encodeURIComponent(found.name)}`).catch(() => undefined);

                if (png?.ok) return { png: Buffer.from(await png.arrayBuffer()), from: found.name };
            }
        }

        await sleep(2500, signal);
    }
}

async function makePicture(host: Host, body: Readonly<Record<string, unknown>>, signal?: AbortSignal) {
    const cfg = await config(host);
    const model = (cfg.models ?? []).find((each) => each.id === body.model);

    if (!cfg.backend?.server) throw new BadRequest("Draw is not set up yet. Read SETUP.md in the draw folder.");
    if (model === undefined) throw new BadRequest("Pick one of the models in draw.json.");
    if (running !== null) throw new Busy("A picture is already being drawn.");

    const prompt = text(body.prompt, 4000).trim();

    if (prompt.length === 0) throw new BadRequest("Write a prompt.");

    const image = text(body.image, 44 * 1024 * 1024);
    const editing = image.length > 0;

    if (editing && !model.edit) throw new BadRequest("That model draws new pictures. Pick a model that can change a photo.");

    const request = {
        prompt,
        negative: text(body.negative, 2000).trim(),
        width: number(body.width, 512, 1024) ?? model.width ?? 1024,
        height: number(body.height, 512, 1024) ?? model.height ?? 1024,
        steps: number(body.steps, 2, 80) ?? model.steps ?? 25,
        guidance: number(body.guidance, 0, 12, false) ?? model.guidance ?? 4,
        seed: number(body.seed, 0, 2 ** 31 - 1) ?? crypto.getRandomValues(new Uint32Array(1))[0] % 2 ** 31,
        strength: number(body.strength, 0.15, 0.95, false) ?? model.strength ?? 0.65,
        image: editing ? image : undefined,
    };

    const started = Date.now();

    running = {
        label: editing ? `changing a photo with ${model.label}` : `drawing with ${model.label}`,
        seconds: Math.max(10, Math.round(secondsOf(model))),
        started,
        steps: request.steps,
    };

    try {
        const made =
            cfg.backend.kind === "comfyui"
                ? await makeComfy(cfg.backend, model, request, signal)
                : cfg.backend.kind === "openai"
                  ? await makeOpenAI(cfg.backend, model, request, signal)
                  : await makeStink(cfg.backend, model, request, signal);

        const folder = folderFor(host, cfg);
        const local = `${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.png`;

        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, local), made.png);

        const kept: Kept = {
            prompt,
            model: model.id,
            seed: request.seed,
            at: Date.now(),
            from: made.from ?? null,
        };

        await keep(folder, local, kept);

        return { name: local, seconds: Math.round((Date.now() - started) / 1000) || null, ...kept };
    } finally {
        running = null;
    }
}

export default function createDraw(host: Host, web: Web) {
    /** What the page needs: the backend, the models, whether it is up, and what is running. */
    web.route("GET", "status", async ({ signal }) => {
        const cfg = await config(host);
        const folder = folderFor(host, cfg);

        return {
            server: cfg.backend?.server ?? "",
            label: cfg.backend?.label ?? "Draw",
            kind: cfg.backend?.kind ?? null,
            note: cfg.note ?? "",
            saved: folder,
            config: join(host.dataDir, "draw.json"),
            sync: cfg.backend?.kind === "stink",
            models: (cfg.models ?? []).map((each) => ({
                id: each.id,
                label: each.label,
                edit: each.edit === true,
                steps: each.steps ?? 25,
                guidance: each.guidance ?? 4,
                strength: each.strength ?? 0.65,
            })),
            ...(await health(cfg, signal)),
        };
    });

    /** Draw a new picture, or change the photo sent with the request, then keep it. */
    web.route("POST", "make", async ({ body, signal }) => {
        try {
            const kept = await makePicture(host, body, signal);

            web.send("x-draw.made", { name: kept.name });

            return kept;
        } catch (error) {
            throw web.error((error as { status?: number }).status ?? 500, (error as Error).message);
        }
    });

    /** The picture being drawn, with the estimate the page shows. */
    web.route("GET", "job", async ({ signal }) => {
        const cfg = await config(host);
        const said = await health(cfg, signal);

        if (running === null) return { ...said, mine: null, other: null };

        const spent = (Date.now() - running.started) / 1000;
        const cap = said.busy ? running.seconds : Math.max(5, spent + 2);
        const steps = running.steps === null ? null : Math.min(running.steps, Math.floor((spent / cap) * running.steps));

        return {
            ...said,
            mine: {
                label: running.label,
                estimate: running.seconds,
                elapsed: Math.round(spent),
                steps,
                of: running.steps,
                at: Date.now(),
            },
        };
    });

    /** Copy pictures the local server kept but this folder does not have. Other backends return nothing. */
    web.route("POST", "sync", async ({ signal }) => {
        const cfg = await config(host);

        if (cfg.backend?.kind !== "stink" || !cfg.backend.server) return { copied: 0 };

        const server = trim(cfg.backend.server);
        const folder = folderFor(host, cfg);
        const listed = await fetch(`${server}/files`, { signal }).catch(() => undefined);

        if (!listed?.ok) throw web.error(502, `No answer from ${server}. Is the image server up?`);

        const { items } = (await listed.json()) as { items: { name: string; at: number }[] };
        const index = await readIndex(folder);
        const had = new Set(Object.values(index).map((each) => each.from).filter(Boolean));
        let copied = 0;

        for (const item of items.slice(0, 200)) {
            if (typeof item.name !== "string" || had.has(item.name)) continue;

            const res = await fetch(`${server}/file/${encodeURIComponent(item.name)}`, { signal }).catch(() => undefined);

            if (!res?.ok) continue;

            const png = Buffer.from(await res.arrayBuffer());

            if (png.length === 0) continue;

            const name = `${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.png`;

            await mkdir(folder, { recursive: true });
            await writeFile(join(folder, name), png);
            await keep(folder, name, { at: item.at * 1000, from: item.name });
            copied += 1;
        }

        return { copied };
    });

    /** Every kept picture, newest first; `q` matches a prompt, `stars` keeps only those starred at least so. */
    web.route("GET", "saved", async ({ query }) => {
        const folder = folderFor(host, await config(host));

        await mkdir(folder, { recursive: true });

        const entries = await readdir(folder, { withFileTypes: true });
        const index = await readIndex(folder);
        const find = text(query.get("q"), 200).trim().toLowerCase();
        const least = number(query.get("stars"), 1, 5);
        const items = [];

        for (const entry of entries) {
            if (!entry.isFile() || !NAME.test(entry.name)) continue;

            const record = index[entry.name] ?? {};
            const star = number(record.star, 0, 5) ?? 0;

            if (least !== undefined && star < least) continue;
            if (find && !(record.prompt ?? "").toLowerCase().includes(find)) continue;

            items.push({
                name: entry.name,
                star,
                prompt: record.prompt ?? "",
                model: record.model ?? "",
                seed: record.seed ?? null,
                at: record.at ?? null,
            });
        }

        items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.name.localeCompare(b.name));

        return { folder, count: items.length, items: items.slice(0, 600) };
    });

    /** Serve one kept picture. The name is checked first, so nothing outside the folder can be read. */
    web.route("GET", "file/:name", async ({ params }) => {
        const name = text(params.name, 20);

        if (!NAME.test(name)) throw web.error(404, "No such picture.");

        const folder = folderFor(host, await config(host));
        const png = await readFile(join(folder, name)).catch(() => undefined);

        if (png === undefined) throw web.error(404, "No such picture.");

        return { data: png.toString("base64") };
    });

    /** Set a picture's stars, 0 to 5. */
    web.route("POST", "star", async ({ body }) => {
        const name = text(body.name, 20);
        const star = number(body.star, 0, 5);
        const folder = folderFor(host, await config(host));

        if (!NAME.test(name) || star === undefined) throw web.error(400, "Name a kept picture and a star from 0 to 5.");
        if (!existsSync(join(folder, name))) throw web.error(404, "No such picture.");

        await keep(folder, name, { star });

        return { name, star };
    });

    /** The page: its module and stylesheet, in the folder beside this file, served to the owner's tabs alone. */
    web.client("draw");

    const draw = defineTool({
        name: "draw_picture",
        description:
            "Draw a new picture, or change one on disk, with the machine's configured Draw backend (ComfyUI, an OpenAI-compatible image API, or a local image server) and keep it in the Draw folder. When a photo is given, this runs ImageMagick (magick -auto-orient) to turn phone photos upright before sending them. Answer with the saved file as ![what it shows](/absolute/path.png) so the picture shows in the reply.",
        parameters: Type.Object({
            prompt: Type.String({ description: "What to draw, or what to change in the photo" }),
            model: Type.Optional(Type.String({ description: "A model id from draw.json. Default: the first one." })),
            photo: Type.Optional(Type.String({ description: "A file on this machine to change: an absolute path, or one in the session's folder" })),
            strength: Type.Optional(Type.Number({ description: "How much to change the photo, 0.15 to 0.95. Default 0.65" })),
            width: Type.Optional(Type.Number({ description: "512 to 1024, a multiple of 16. Default 1024" })),
            height: Type.Optional(Type.Number({ description: "512 to 1024, a multiple of 16. Default 1024" })),
            steps: Type.Optional(Type.Number({ description: "Sampling steps. The model's own default if left out" })),
            guidance: Type.Optional(Type.Number({ description: "Guidance scale. The model's own default if left out" })),
            seed: Type.Optional(Type.Number({ description: "Leave out for a random seed" })),
            negative: Type.Optional(Type.String({ description: "Things to leave out" })),
        }),
        execute: async (args, api, context) => {
            const cfg = await config(host);
            const model = String(args.model ?? cfg.models?.[0]?.id ?? "");
            let image: string | undefined;

            if (typeof args.photo === "string" && args.photo.trim()) {
                const asked = args.photo.trim();

                if (asked.startsWith("-")) throw new Error("Name the photo's file.");

                const folder = (await api.agent(context)).cwd;
                const file = isAbsolute(asked) ? asked : resolve(folder, asked);
                const png = await readFile(file).catch(() => undefined);

                if (png === undefined) throw new Error(`No file at ${file}.`);

                image = (await upright(file, png)).toString("base64");
            }

            api.output(image ? `Changing ${args.photo} with ${cfg.backend?.label ?? "Draw"}. A minute or two…` : `Drawing with ${cfg.backend?.label ?? "Draw"}. A minute or two…`);

            let kept;

            try {
                kept = await makePicture(
                    host,
                    {
                        prompt: args.prompt,
                        model,
                        image,
                        strength: args.strength,
                        width: args.width,
                        height: args.height,
                        steps: args.steps,
                        guidance: args.guidance,
                        seed: args.seed,
                        negative: args.negative,
                    },
                    undefined,
                );
            } catch (error) {
                throw new Error((error as Error).message);
            }

            const folder = folderFor(host, cfg);
            const file = join(folder, kept.name);

            return {
                content: [
                    {
                        type: "text" as const,
                        text: `${image ? "Changed" : "Drew"} it with ${kept.model} in ${kept.seconds ? `${Math.round(kept.seconds)}s` : "a while"}, seed ${kept.seed ?? "random"}. Kept at ${file} (it is also in the Draw page's Saved tab).\n\n![${kept.prompt}](${file})`,
                    },
                ],
            };
        },
    });

    return defineExtension({ name: "draw", tools: [draw] });
}
