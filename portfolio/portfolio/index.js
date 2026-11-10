// Portfolio's page: every project with its status, next action, and last activity. The server module keeps the
// projects and Pi updates them with portfolio_update.

export const pocketApi = 1;

const STATUS = {
    active: { label: "Active" },
    blocked: { label: "Blocked" },
    paused: { label: "Paused" },
    done: { label: "Done" },
};

function age(at) {
    if (!at) return "never";
    const ms = Date.now() - at;
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export default function setup(pocket) {
    const { html, useState, useEffect, Loader } = pocket;

    pocket.style("look.css");

    function Portfolio() {
        const [data, setData] = useState(null);
        const [error, setError] = useState(null);
        const [editing, setEditing] = useState(null);
        const [draft, setDraft] = useState({ status: "active", next: "", note: "" });
        const [busy, setBusy] = useState(false);
        const [newName, setNewName] = useState("");
        const [newFolder, setNewFolder] = useState("");

        const refresh = async () => {
            try {
                setData(await pocket.api("state"));
                setError(null);
            } catch (failure) {
                setError(failure.message);
            }
        };

        useEffect(() => {
            void refresh();
            return pocket.on("changed", () => void refresh());
        }, []);

        const startEdit = (project) => {
            setEditing(project.id);
            setDraft({ name: project.name, status: project.status, next: project.next, note: project.note });
        };

        const save = async (id) => {
            setBusy(true);
            try {
                await pocket.api("project", {
                    id,
                    name: draft.name,
                    status: draft.status,
                    next: draft.next,
                    note: draft.note,
                });
                setEditing(null);
                await refresh();
            } catch (failure) {
                setError(failure.message);
            } finally {
                setBusy(false);
            }
        };

        const remove = async (project) => {
            if (!confirm(`Remove "${project.name}" from the Portfolio?`)) return;
            setBusy(true);
            try {
                await pocket.api("delete", { id: project.id });
                setEditing(null);
                await refresh();
            } catch (failure) {
                setError(failure.message);
            } finally {
                setBusy(false);
            }
        };

        const add = async (payload) => {
            setBusy(true);
            try {
                await pocket.api("project", payload);
                setNewName("");
                setNewFolder("");
                await refresh();
            } catch (failure) {
                setError(failure.message);
            } finally {
                setBusy(false);
            }
        };

        if (error && !data) {
            return html`<div class="pf-wrap">
                <div class="error-box">${error}</div>
                <button class="button" onClick=${refresh}>Try again</button>
            </div>`;
        }

        if (!data) return html`<${Loader} label="Reading the Portfolio" />`;

        const projects = data.projects;
        const counts = {
            active: projects.filter((p) => p.status === "active").length,
            blocked: projects.filter((p) => p.status === "blocked").length,
            stale: projects.filter((p) => p.status === "active" && p.staleDays !== null && p.staleDays >= 7).length,
        };

        return html`<div class="pf-wrap">
            ${error ? html`<div class="error-box">${error}</div>` : null}

            <div class="pf-stats">
                <span class="pf-stat"><b>${counts.active}</b> active</span>
                <span class="pf-stat ${counts.blocked ? "hot" : ""}"><b>${counts.blocked}</b> blocked</span>
                <span class="pf-stat ${counts.stale ? "warn" : ""}"><b>${counts.stale}</b> stale</span>
            </div>

            ${projects.length
                ? html`<div class="pf-list">
                      ${projects.map((project) => {
                          const meta = STATUS[project.status] ?? STATUS.active;
                          const isEditing = editing === project.id;
                          const stale = project.status === "active" && project.staleDays !== null && project.staleDays >= 7;
                          return html`<div class="pf-row ${isEditing ? "editing" : ""}">
                              <div class="pf-head">
                                  <button class="pf-main" onClick=${() => (isEditing ? setEditing(null) : startEdit(project))}>
                                      <span class=${`pf-dot ${project.status}`}></span>
                                      <span class="pf-title">
                                          <span class="pf-name">${project.name}</span>
                                          <span class="pf-next">${project.next || "No next action"}</span>
                                      </span>
                                      <span class="pf-meta">
                                          <span>${meta.label}</span>
                                          <span>${age(project.lastActivity)}</span>
                                          ${stale ? html`<span class="pf-badge warn">stale ${project.staleDays}d</span>` : null}
                                          ${!project.next ? html`<span class="pf-badge">no next</span>` : null}
                                      </span>
                                  </button>
                                  ${project.session
                                      ? html`<a class="button pf-open" href=${"/s/" + project.session.id}>Open</a>`
                                      : html`<span class="pf-open muted small">no chat</span>`}
                              </div>

                              ${isEditing
                                  ? html`<div class="pf-editor">
                                        <div class="pf-statuses">
                                            ${Object.entries(STATUS).map(
                                                ([value, info]) => html`<button
                                                    class="pf-status ${draft.status === value ? "on" : ""}"
                                                    disabled=${busy}
                                                    onClick=${() => setDraft({ ...draft, status: value })}
                                                >
                                                    <span class=${`pf-dot ${value}`}></span> ${info.label}
                                                </button>`,
                                            )}
                                        </div>
                                        <label class="pf-field">
                                            <span class="muted small">Name</span>
                                            <input
                                                class="pf-input"
                                                value=${draft.name}
                                                onInput=${(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                                            />
                                        </label>
                                        <label class="pf-field">
                                            <span class="muted small">Next action</span>
                                            <input
                                                class="pf-input"
                                                value=${draft.next}
                                                placeholder="The one thing to do next"
                                                onInput=${(event) => setDraft({ ...draft, next: event.currentTarget.value })}
                                            />
                                        </label>
                                        <label class="pf-field">
                                            <span class="muted small">Note</span>
                                            <textarea
                                                class="pf-input"
                                                rows="2"
                                                value=${draft.note}
                                                placeholder="Why it is blocked, what changed…"
                                                onInput=${(event) => setDraft({ ...draft, note: event.currentTarget.value })}
                                            ></textarea>
                                        </label>
                                        <div class="pf-actions">
                                            <button class="button primary" disabled=${busy} onClick=${() => save(project.id)}>
                                                Save
                                            </button>
                                            <button class="button" disabled=${busy} onClick=${() => setEditing(null)}>Cancel</button>
                                            <button class="button pf-delete" disabled=${busy} onClick=${() => remove(project)}>
                                                Remove
                                            </button>
                                        </div>
                                        <div class="pf-path mono small">${project.folder}</div>
                                    </div>`
                                  : null}
                          </div>`;
                      })}
                  </div>`
                : html`<div class="pf-empty">
                      <p>No projects yet. Add one below, or pick a recent chat.</p>
                  </div>`}

            ${data.suggestions.length
                ? html`<div class="pf-add">
                      <div class="pf-subhead">Recent chats not in the Portfolio</div>
                      ${data.suggestions.map(
                          (suggestion) => html`<div class="pf-suggestion">
                              <span class="pf-title">
                                  <span class="pf-name">${suggestion.title}</span>
                                  <span class="pf-next mono small">${suggestion.folder}</span>
                              </span>
                              <button
                                  class="button"
                                  disabled=${busy}
                                  onClick=${() =>
                                      add({
                                          name: suggestion.title,
                                          folder: suggestion.folder,
                                          sessionId: suggestion.sessionId,
                                      })}
                              >
                                  Add
                              </button>
                          </div>`,
                      )}
                  </div>`
                : null}

            <div class="pf-add">
                <div class="pf-subhead">Add a project</div>
                <input
                    class="pf-input"
                    value=${newName}
                    placeholder="Name (for example Pi Pocket)"
                    onInput=${(event) => setNewName(event.currentTarget.value)}
                />
                <input
                    class="pf-input mono"
                    value=${newFolder}
                    placeholder="/home/rhoulb/pi-pocket"
                    onInput=${(event) => setNewFolder(event.currentTarget.value)}
                />
                <button
                    class="button primary"
                    disabled=${busy || !newName.trim()}
                    onClick=${() => add({ name: newName, folder: newFolder })}
                >
                    Add project
                </button>
            </div>

            <p class="muted small">
                Pi updates a project with the portfolio_update tool: status, next action, and note. Open a project's chat
                with Open.
            </p>
        </div>`;
    }

    pocket.page({ id: "portfolio", title: "Portfolio", component: Portfolio });
    pocket.rail({ id: "portfolio", title: "Portfolio", icon: "grid", page: "portfolio" });
    pocket.launcher({
        id: "portfolio",
        label: "Portfolio",
        detail: "project status and next actions",
        icon: "grid",
        page: "portfolio",
    });
}
