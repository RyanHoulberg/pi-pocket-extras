// Draw's browser module: a rail button and a page (from draw.ts) with two tabs. Draw writes a prompt, picks a model
// from draw.json, and can start from a photo; Saved shows every picture kept on the machine, at a size that loads
// quickly, with Stars, Search, and a tap to see one full size. The app loads it and calls its default export with
// `pocket`.

/** The version of `pocket` this module was written for: an older app does not load it. */
export const pocketApi = 1;

/** A picture on a rail: a 24×24 stroked path, like the app's own icons. */
const PICTURE = "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6M16.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3";

export default function setup(pocket) {
    const { html, useEffect, useRef, useState, Loader } = pocket;

    /** A blob from base64, and the blob's address, which the page frees when it goes. */
    const useBlob = (base64, type = "image/png") => {
        const [url, setUrl] = useState(null);

        useEffect(() => {
            if (!base64) {
                setUrl(null);

                return;
            }

            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);

            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

            const address = URL.createObjectURL(new Blob([bytes], { type }));

            setUrl(address);

            return () => URL.revokeObjectURL(address);
        }, [base64]);

        return url;
    };

    /** One kept picture, loaded only when it scrolls into view, so the page stays light on a phone. */
    function Thumb({ name, star, prompt, onOpen, onStar }) {
        const [src, setSrc] = useState(null);
        const [failed, setFailed] = useState(false);
        const holder = useRef(null);

        useEffect(() => {
            if (!("IntersectionObserver" in window)) {
                setSrc("now");

                return;
            }

            const watch = new IntersectionObserver(
                (entries) => {
                    if (entries.some((entry) => entry.isIntersecting)) {
                        setSrc("now");
                        watch.disconnect();
                    }
                },
                { rootMargin: "300px" },
            );

            if (holder.current) watch.observe(holder.current);

            return () => watch.disconnect();
        }, []);

        useEffect(() => {
            if (!src && !failed) return;

            let live = true;
            const stop = new AbortController();

            if (src) {
                pocket.api(`file/${name}`, undefined, { signal: stop.signal }).then(
                    (answer) => live && setSrc(`data:image/png;base64,${answer.data}`),
                    () => live && setFailed(true),
                );
            }

            return () => {
                live = false;
                stop.abort();
            };
        }, [name, src]);

        const shown = typeof src === "string" && src.startsWith("data:");

        return html`<figure class="x-draw-thumb" ref=${holder}>
            ${
                shown
                    ? html`<img
                          src=${src}
                          alt=${prompt || "A saved picture"}
                          loading="lazy"
                          onClick=${() => onOpen(name, src, prompt)}
                      />`
                    : html`<div class="x-draw-empty-tile">${failed ? "could not load" : html`<${pocket.Loader} />`}</div>`
            }
            <figcaption>
                <span class="x-draw-stars" role="group" aria-label="Stars">
                    ${[1, 2, 3, 4, 5].map(
                        (n) =>
                            html`<button
                                class=${`x-draw-star ${n <= star ? "on" : ""}`}
                                aria-label=${`${n} star${n === 1 ? "" : "s"}`}
                                onClick=${() => onStar(name, n === star ? 0 : n)}
                            >
                                ★
                            </button>`,
                    )}
                </span>
            </figcaption>
        </figure>`;
    }

    /** Saved: the whole folder, searchable, newest first, with stars. */
    function Saved() {
        const [list, setList] = useState(null);
        const [find, setFind] = useState("");
        const [only, setOnly] = useState(false);
        const [error, setError] = useState(null);
        const [opened, setOpened] = useState(null); // { name, src, prompt }
        const [again, setAgain] = useState(0);

        useEffect(() => {
            // Pictures made on stink's own page are copied in here, so one list holds everything.
            const stop = new AbortController();

            pocket.api("sync", {}, { signal: stop.signal }).then(
                (answer) => {
                    if (!stop.signal.aborted && answer.copied > 0) setAgain((n) => n + 1);
                },
                () => {},
            );

            return () => stop.abort();
        }, [again]);

        useEffect(() => {
            const stop = new AbortController();
            const query = new URLSearchParams();

            if (find.trim()) query.set("q", find.trim());
            if (only) query.set("stars", "1");

            const timer = setTimeout(() => {
                pocket.api(`saved?${query}`, undefined, { signal: stop.signal }).then(
                    (answer) => {
                        setList(answer);
                        setError(null);
                    },
                    (failure) => !stop.signal.aborted && setError(failure.message),
                );
            }, find ? 250 : 0);

            return () => {
                clearTimeout(timer);
                stop.abort();
            };
        }, [find, only, again]);

        const star = async (name, value) => {
            try {
                await pocket.api("star", { name, star: value });
                setAgain((n) => n + 1);
            } catch (failure) {
                setError(failure.message);
            }
        };

        if (error && !list) return html`<div class="error-box">${error}</div>`;

        return html`<div class="x-draw-saved">
            <div class="x-draw-search">
                <input
                    class="x-draw-field"
                    type="search"
                    placeholder="Search prompts"
                    value=${find}
                    onInput=${(event) => setFind(event.currentTarget.value)}
                />
                <label class="x-draw-check">
                    <input
                        type="checkbox"
                        checked=${only}
                        onChange=${(event) => setOnly(event.currentTarget.checked)}
                    />
                    Starred
                </label>
            </div>
            ${
                error
                    ? html`<div class="error-box">${error}</div>`
                    : list === null
                      ? html`<${Loader} label="Reading the folder" />`
                      : list.items.length === 0
                        ? html`<p class="muted small">Nothing here yet. Draw one.</p>`
                        : html`<div class="x-draw-grid">
                              ${list.items.map(
                                  (each) =>
                                      html`<${Thumb}
                                          key=${each.name}
                                          name=${each.name}
                                          star=${each.star}
                                          prompt=${each.prompt}
                                          onOpen=${(name, src, prompt) => setOpened({ name, src, prompt })}
                                          onStar=${star}
                                      />`,
                              )}
                          </div>`
            }
            ${
                list && list.items.length > 0
                    ? html`<p class="muted small">
                          ${list.count} picture${list.count === 1 ? "" : "s"} in ${list.folder}
                      </p>`
                    : null
            }
            ${opened ? html`<${Full} photo=${opened} onClose=${() => setOpened(null)} />` : null}
        </div>`;
    }

    /** One picture full size, with its prompt and where it is on the machine. */
    function Full({ photo, onClose }) {
        useEffect(() => {
            const onKey = (event) => event.key === "Escape" && onClose();

            addEventListener("keydown", onKey);

            return () => removeEventListener("keydown", onKey);
        }, []);

        return html`<div class="x-draw-full" onClick=${onClose}>
            <img src=${photo.src} alt=${photo.prompt || "A saved picture"} />
            <div class="x-draw-full-bar" onClick=${(event) => event.stopPropagation()}>
                <div>
                    <div class="mono small">${photo.name}</div>
                    ${photo.prompt ? html`<div class="small">${photo.prompt}</div>` : null}
                </div>
                <a class="button small" href=${photo.src} download=${photo.name}>Save</a>
                <button class="button small" onClick=${onClose}>Close</button>
            </div>
        </div>`;
    }

    /** A bar that fills the way the estimate expects, from the server's reading of the job; it never claims done. */
    function Progress({ started, after }) {
        const [job, setJob] = useState(null);

        useEffect(() => {
            const stop = new AbortController();
            let timer;

            const read = () => {
                pocket.api("job", undefined, { signal: stop.signal }).then(
                    (answer) => {
                        if (stop.signal.aborted) return;

                        setJob(answer);
                        after?.(answer);
                        timer = setTimeout(read, answer.mine ? 1500 : 2500);
                    },
                    () => {
                        if (!stop.signal.aborted) timer = setTimeout(read, 3000);
                    },
                );
            };

            read();

            return () => {
                clearTimeout(timer);
                stop.abort();
            };
        }, []);

        const mine = job?.mine;
        const other = job?.other ?? null;
        const waited = started ? Math.round((Date.now() - started) / 1000) : (mine?.elapsed ?? other?.elapsed ?? 0);
        const estimate = mine?.estimate ?? (other ? Math.max(other.elapsed + 30, 120) : null);
        // Short of the end until the picture is here: the last tenth is the server sending it back.
        const part = estimate ? Math.min(0.94, waited / estimate) : 0.12;
        const phase = !job
            ? "Asking the server…"
            : !job.online
              ? job.reason
              : other && !mine
                ? `The GPU is busy with a picture started somewhere else (${other.label}, ${other.elapsed}s so far). Waiting its turn.`
                : job.busy
                ? "The GPU is working. First it puts the chat model away, then it loads the weights, then it draws."
                : waited < 6
                  ? "Waiting for the GPU…"
                  : "Finishing up.";

        return html`<div class="x-draw-job" role="status" aria-live="polite">
            <div class="x-draw-job-line">
                <span class="small">${phase}</span>
                <span class="mono small">${estimate ? `${waited}s of about ${estimate}s` : `${waited}s`}</span>
            </div>
            <div class="x-draw-bar" aria-hidden="true">
                <div class="x-draw-fill" style=${`width:${Math.round(part * 100)}%`}></div>
            </div>
            ${
                mine?.steps != null && mine.of
                    ? html`<div class="muted small">Step ${Math.min(mine.steps + 1, mine.of)} of ${mine.of} or so</div>`
                    : null
            }
        </div>`;
    }

    /** Draw: the form. One tap draws; the picture shows when it is done, and is already kept. */
    function Draw() {
        const [status, setStatus] = useState(null);
        const [model, setModel] = useState("");
        const [prompt, setPrompt] = useState("");
        const [negative, setNegative] = useState("");
        const [photo, setPhoto] = useState(null); // { name, type, src, base64 }
        const [strength, setStrength] = useState(0.65);
        const [width, setWidth] = useState(1024);
        const [height, setHeight] = useState(1024);
        const [steps, setSteps] = useState(9);
        const [guidance, setGuidance] = useState(0);
        const [seed, setSeed] = useState("");
        const [busy, setBusy] = useState(false);
        const [startedAt, setStartedAt] = useState(0);
        const [jobLabel, setJobLabel] = useState(null);
        const [note, setNote] = useState("Loading the image server…");
        const [error, setError] = useState(null);
        const [result, setResult] = useState(null);
        const src = useBlob(result?.base64);

        useEffect(() => {
            const stop = new AbortController();

            pocket.api("status", undefined, { signal: stop.signal }).then(
                (answer) => {
                    setStatus(answer);
                    setNote(
                        answer.online
                            ? answer.busy
                                ? "The backend is drawing another picture. One at a time."
                                : answer.note || `Ready on ${answer.label || answer.server}.`
                            : answer.reason,
                    );

                    const first = answer.models?.[0];

                    if (first) {
                        setModel(first.id);
                        setSteps(first.steps ?? 25);
                        setGuidance(first.guidance ?? 4);
                        setStrength(first.strength ?? 0.65);
                    }
                },
                (failure) => !stop.signal.aborted && setNote(failure.message),
            );

            return () => stop.abort();
        }, []);

        if (status && (!status.models || status.models.length === 0)) {
            return html`<div class="x-draw-setup">
                <h3>Set up Draw</h3>
                <p class="muted">
                    Draw has no models yet. Its settings are in <code>${status.config}</code>, and the guide is
                    <code>SETUP.md</code> in the draw folder. Ask your agent to set it up with your ComfyUI, image API, or
                    local server.
                </p>
                <p class="small muted">${status.server ? `Backend: ${status.label} at ${status.server}` : "No backend configured."}</p>
            </div>`;
        }

        const chosen = status?.models?.find((each) => each.id === model);
        const canEdit = chosen ? chosen.edit : true;
        const editing = photo !== null;

        const choose = (id) => {
            setModel(id);

            const each = status?.models?.find((candidate) => candidate.id === id);

            if (each) {
                setSteps(each.steps);
                setGuidance(each.guidance);
                setStrength(each.strength ?? 0.65);
            }
        };

        const pickPhoto = async (event) => {
            const file = event.currentTarget.files?.[0];

            event.currentTarget.value = "";

            if (!file) return;

            if (!/^image\//.test(file.type)) {
                setError("That file is not a picture. Pick a PNG, JPEG, or WebP.");

                return;
            }

            try {
                // A route takes 1 MB of JSON, so the photo is scaled to about a megapixel and sent as a JPEG. The
                // editors scale it to about that size anyway, so nothing is lost.
                const bitmap = await createImageBitmap(file);
                const longest = Math.max(bitmap.width, bitmap.height);
                const scale = Math.min(1, 1024 / longest);
                const canvas = document.createElement("canvas");

                canvas.width = Math.round(bitmap.width * scale);
                canvas.height = Math.round(bitmap.height * scale);

                const context = canvas.getContext("2d");

                context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                bitmap.close?.();

                let data = canvas.toDataURL("image/jpeg", 0.9);

                // Still too big for the route: one more pass, smaller.
                for (let quality = 0.75; data.length > 900_000 && quality >= 0.4; quality -= 0.15) {
                    data = canvas.toDataURL("image/jpeg", quality);
                }

                if (data.length > 1_050_000) {
                    setError("That photo is too detailed to send. Try a smaller or simpler one.");

                    return;
                }

                setPhoto({
                    name: `${file.name} (${canvas.width}×${canvas.height})`,
                    src: data,
                    base64: data.split(",")[1],
                });
                setError(null);
            } catch {
                setError("That photo could not be read. Try another one.");
            }
        };

        const submit = async (event) => {
            event.preventDefault();

            if (busy) return;

            setBusy(true);
            setStartedAt(Date.now());
            setJobLabel(null);
            setError(null);
            setResult(null);
            setNote(editing ? "Changing the photo. This can take a minute, sometimes three." : "Drawing. This can take a minute, sometimes three.");

            try {
                const answer = await pocket.api("make", {
                    model,
                    prompt,
                    negative,
                    width,
                    height,
                    steps,
                    guidance,
                    strength,
                    seed: seed.trim() || undefined,
                    ...(editing ? { image: photo.base64 } : {}),
                });
                const seen = await pocket.api(`file/${answer.name}`);

                setResult({ ...answer, base64: seen.data });
                setNote(
                    `Done in ${answer.seconds ? `${Math.round(answer.seconds)}s. ` : ""}Seed ${answer.seed ?? "random"}. Kept in ${status?.saved ?? "your folder"}.`,
                );

                if (answer.seed) setSeed(String(answer.seed));
            } catch (failure) {
                setError(
                    failure.status === 413
                        ? "That photo was too big for the server. Try a smaller one."
                        : failure.message,
                );
                setNote("");
            } finally {
                setBusy(false);
                setJobLabel(null);
            }
        };

        return html`<form class="x-draw-form" onSubmit=${submit}>
            <p class=${`small ${error ? "x-draw-error" : "muted"}`}>${jobLabel ?? note}</p>
            ${error ? html`<div class="error-box">${error}</div>` : null}

            ${
                editing
                    ? html`<div class="x-draw-photo">
                          <img src=${photo.src} alt="The photo to change" />
                          <div>
                              <div class="small">Starting from ${photo.name}</div>
                              <button
                                  class="button small"
                                  type="button"
                                  onClick=${() => setPhoto(null)}
                              >
                                  Remove
                              </button>
                          </div>
                      </div>`
                    : null
            }

            <label class="x-draw-label">
                ${editing ? "What to change" : "Prompt"}
                <textarea
                    class="x-draw-field"
                    rows="4"
                    required
                    placeholder=${editing ? "Turn both circles blue" : "Describe the picture"}
                    value=${prompt}
                    onInput=${(event) => setPrompt(event.currentTarget.value)}
                ></textarea>
            </label>

            <label class="x-draw-label">
                Model
                <select class="x-draw-field" value=${model} onChange=${(event) => choose(event.currentTarget.value)}>
                    ${(status?.models ?? []).map(
                        (each) =>
                            html`<option value=${each.id} disabled=${editing && !each.edit}>${each.label}</option>`,
                    )}
                </select>
            </label>

            ${
                editing
                    ? html`<label class="x-draw-label">
                          How much to change: ${Math.round(strength * 100)}%
                          <input
                              class="x-draw-range"
                              type="range"
                              min="0.15"
                              max="0.95"
                              step="0.05"
                              value=${strength}
                              data-no-swipe
                              onInput=${(event) => setStrength(Number(event.currentTarget.value))}
                          />
                      </label>`
                    : null
            }

            <label class="x-draw-label">
                Start from a photo <span class="muted small">(optional; it is changed, not copied)</span>
                <input
                    class="x-draw-field"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange=${pickPhoto}
                />
            </label>

            <details class="x-draw-more">
                <summary class="small">More controls</summary>
                <div class="x-draw-pairs">
                    <label class="x-draw-label">
                        Width
                        <input
                            class="x-draw-field"
                            type="number"
                            inputmode="numeric"
                            min="512"
                            max="1024"
                            step="16"
                            value=${width}
                            onInput=${(event) => setWidth(Number(event.currentTarget.value))}
                        />
                    </label>
                    <label class="x-draw-label">
                        Height
                        <input
                            class="x-draw-field"
                            type="number"
                            inputmode="numeric"
                            min="512"
                            max="1024"
                            step="16"
                            value=${height}
                            onInput=${(event) => setHeight(Number(event.currentTarget.value))}
                        />
                    </label>
                    <label class="x-draw-label">
                        Steps
                        <input
                            class="x-draw-field"
                            type="number"
                            inputmode="numeric"
                            min="2"
                            max="60"
                            value=${steps}
                            onInput=${(event) => setSteps(Number(event.currentTarget.value))}
                        />
                    </label>
                    <label class="x-draw-label">
                        Guidance
                        <input
                            class="x-draw-field"
                            type="number"
                            inputmode="decimal"
                            min="0"
                            max="8"
                            step="0.5"
                            value=${guidance}
                            onInput=${(event) => setGuidance(Number(event.currentTarget.value))}
                        />
                    </label>
                    <label class="x-draw-label">
                        Seed <span class="muted small">(blank is random)</span>
                        <input
                            class="x-draw-field"
                            type="number"
                            inputmode="numeric"
                            min="0"
                            value=${seed}
                            placeholder="Random"
                            onInput=${(event) => setSeed(event.currentTarget.value)}
                        />
                    </label>
                </div>
                ${
                    canEdit || !editing
                        ? html`<label class="x-draw-label">
                              Leave out <span class="muted small">(negative prompt)</span>
                              <textarea
                                  class="x-draw-field"
                                  rows="2"
                                  value=${negative}
                                  onInput=${(event) => setNegative(event.currentTarget.value)}
                              ></textarea>
                          </label>`
                        : null
                }
            </details>

            <button class="button primary x-draw-go" type="submit" disabled=${busy}>
                ${busy ? "Drawing…" : editing ? "Change the photo" : "Draw"}
            </button>

            ${
                busy
                    ? html`<${Progress} started=${startedAt} after=${(answer) => answer.mine && setJobLabel(answer.mine.label)} />
                          <p class="muted small">
                              Keep this page open. The chat model comes back on your next message.
                          </p>`
                    : null
            }

            ${
                result && src
                    ? html`<figure class="x-draw-result">
                          <img
                              src=${src}
                              alt=${result.prompt}
                              onClick=${() => pocket.notify("info", "Shown in Saved too.")}
                          />
                      </figure>`
                    : null
            }
        </form>`;
    }

    /** The page: Draw, or Saved. The last tab stays open while the page does. */
    function DrawPage() {
        const [tab, setTab] = useState("draw");
        const [drawn, setDrawn] = useState(0);

        // A new picture makes Saved read the folder again.
        useEffect(() => {
            const off = pocket.on("x-draw.made", () => setDrawn((n) => n + 1));

            return () => off?.();
        }, []);

        return html`<div class="x-draw">
            <div class="x-draw-tabs" role="tablist">
                <button
                    class=${`x-draw-tab ${tab === "draw" ? "on" : ""}`}
                    role="tab"
                    onClick=${() => setTab("draw")}
                >
                    Draw
                </button>
                <button
                    class=${`x-draw-tab ${tab === "saved" ? "on" : ""}`}
                    role="tab"
                    onClick=${() => setTab("saved")}
                >
                    Saved
                </button>
            </div>
            ${tab === "draw" ? html`<${Draw} />` : html`<${Saved} key=${drawn} />`}
        </div>`;
    }

    pocket.style("draw.css");
    pocket.page({ id: "draw", title: "Draw", component: DrawPage });
    pocket.rail({ id: "draw", title: "Draw", iconPath: PICTURE, page: "draw" });
    pocket.launcher({
        id: "draw",
        label: "Draw a picture",
        detail: "Draw or change a photo with your image backend, and see what you kept",
        iconPath: PICTURE,
        page: "draw",
    });
}
