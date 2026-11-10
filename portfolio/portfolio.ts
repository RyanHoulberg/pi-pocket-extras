/**
 * Portfolio: one page with every project's status, next action, and last activity. Projects link to their Pi session;
 * Pi keeps them current with the portfolio_update tool. A drop-in for Pi Pocket.
 */
import { readFile, writeFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import type { Host, Web } from "./_pocket.d.ts";

type Status = "active" | "blocked" | "paused" | "done";

interface Project {
    id: string;
    name: string;
    folder: string;
    sessionId?: number;
    status: Status;
    next: string;
    note: string;
    createdAt: number;
    updatedAt: number;
}

interface State {
    projects: Project[];
}

interface SessionInfo {
    id: number;
    title?: string;
    cwd?: string;
    updatedAt: number;
    archived?: boolean;
    pip?: unknown;
}

const STATUSES: Status[] = ["active", "blocked", "paused", "done"];

function stateFile(host: Host): string {
    return join(host.dataDir, "portfolio-state.json");
}

async function load(host: Host): Promise<State> {
    try {
        const parsed = JSON.parse(await readFile(stateFile(host), "utf8"));
        const projects: Project[] = [];
        for (const p of Array.isArray(parsed?.projects) ? parsed.projects : []) {
            if (!p || typeof p !== "object" || typeof p.id !== "string") continue;
            projects.push({
                id: p.id,
                name: typeof p.name === "string" ? p.name : "Untitled project",
                folder: typeof p.folder === "string" ? p.folder : "",
                sessionId: typeof p.sessionId === "number" ? p.sessionId : undefined,
                status: STATUSES.includes(p.status) ? p.status : "active",
                next: typeof p.next === "string" ? p.next : "",
                note: typeof p.note === "string" ? p.note : "",
                createdAt: Number(p.createdAt) || 0,
                updatedAt: Number(p.updatedAt) || 0,
            });
        }
        return { projects };
    } catch {
        return { projects: [] };
    }
}

async function save(host: Host, state: State): Promise<void> {
    const path = stateFile(host);
    const temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 1) + "\n", { mode: 0o600 });
    await rename(temp, path);
}

function cleanFolder(value: string): string {
    let folder = String(value ?? "").trim();
    if (folder.startsWith("~")) folder = join(process.env.HOME ?? "/home/rhoulb", folder.slice(1));
    if (folder.length > 1) folder = folder.replace(/\/+$/, "");
    return folder;
}

function latestByFolder(sessions: SessionInfo[]): Map<string, SessionInfo> {
    const map = new Map<string, SessionInfo>();
    for (const session of sessions) {
        if (!session.cwd || session.archived) continue;
        const folder = cleanFolder(session.cwd);
        const current = map.get(folder);
        if (!current || session.updatedAt > current.updatedAt) map.set(folder, session);
    }
    return map;
}

function findProject(state: State, query: string | undefined, cwd: string | undefined): Project | undefined {
    const wanted = query?.trim().toLowerCase();
    if (wanted) {
        return state.projects.find(
            (p) =>
                p.id === wanted ||
                p.name.toLowerCase() === wanted ||
                cleanFolder(p.folder).toLowerCase() === cleanFolder(wanted) ||
                (p.folder && cleanFolder(p.folder).toLowerCase().endsWith("/" + wanted)),
        );
    }
    if (cwd) {
        const folder = cleanFolder(cwd).toLowerCase();
        return state.projects.find((p) => cleanFolder(p.folder).toLowerCase() === folder);
    }
    return undefined;
}

function newId(): string {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function statusLabel(status: Status): string {
    return status === "active" ? "🟢 active" : status === "blocked" ? "🔴 blocked" : status === "paused" ? "🟡 paused" : "✅ done";
}

export default function createPortfolio(host: Host, web: Web) {
    const view = async (request?: { sessions?: () => SessionInfo[] }) => {
        const state = await load(host);
        // Pi Pocket 0.28 hands a route its session list. A route without one gets no suggestions.
        const sessions = typeof request?.sessions === "function" ? request.sessions() : [];
        const folders = latestByFolder(sessions);
        const now = Date.now();
        const projects = state.projects
            .map((p) => {
                const latest = folders.get(cleanFolder(p.folder));
                const stored = p.sessionId ? sessions.find((s) => s.id === p.sessionId) : undefined;
                const session = latest ?? stored;
                const lastActivity = Math.max(p.updatedAt, session?.updatedAt ?? 0);
                return {
                    ...p,
                    session: session ? { id: session.id, title: session.title || "Chat", updatedAt: session.updatedAt } : null,
                    lastActivity,
                    staleDays: lastActivity ? Math.floor((now - lastActivity) / 86_400_000) : null,
                };
            })
            .sort((a, b) => {
                const rank = (s: Status) => (s === "active" ? 0 : s === "blocked" ? 1 : s === "paused" ? 2 : 3);
                return rank(a.status) - rank(b.status) || b.lastActivity - a.lastActivity;
            });
        const linked = new Set(projects.map((p) => cleanFolder(p.folder)));
        const suggestions = [...folders.entries()]
            .filter(([folder]) => !linked.has(folder))
            .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
            .slice(0, 6)
            .map(([folder, session]) => ({
                folder,
                title: session.title || basename(folder) || folder,
                sessionId: session.id,
                updatedAt: session.updatedAt,
            }));
        return { projects, suggestions, now };
    };

    web.route("GET", "state", view);

    web.route("POST", "project", async ({ body }) => {
        const change = (body ?? {}) as Record<string, unknown>;
        const state = await load(host);
        const now = Date.now();
        let project = typeof change.id === "string" ? state.projects.find((p) => p.id === change.id) : undefined;
        if (change.id && !project) throw web.error(404, "No such project");

        if (!project) {
            const folder = typeof change.folder === "string" ? cleanFolder(change.folder) : "";
            if (folder && state.projects.some((p) => cleanFolder(p.folder) === folder)) {
                throw web.error(400, "That folder is already a project.");
            }
            project = {
                id: newId(),
                name: "",
                folder: "",
                status: "active",
                next: "",
                note: "",
                createdAt: now,
                updatedAt: now,
            };
            state.projects.push(project);
        }

        if (typeof change.name === "string" && change.name.trim()) project.name = change.name.trim().slice(0, 120);
        if (typeof change.folder === "string" && change.folder.trim()) project.folder = cleanFolder(change.folder).slice(0, 500);
        if (typeof change.sessionId === "number") project.sessionId = change.sessionId;
        if (typeof change.status === "string" && STATUSES.includes(change.status as Status)) project.status = change.status as Status;
        if (typeof change.next === "string") project.next = change.next.trim().slice(0, 300);
        if (typeof change.note === "string") project.note = change.note.trim().slice(0, 1000);
        if (!project.name) project.name = project.folder ? basename(project.folder) : "Untitled project";
        project.updatedAt = now;

        await save(host, state);
        web.send("changed", { at: now });
        return { project };
    });

    web.route("POST", "delete", async ({ body }) => {
        const id = (body as { id?: unknown })?.id;
        if (typeof id !== "string") throw web.error(400, "Which project?");
        const state = await load(host);
        const before = state.projects.length;
        state.projects = state.projects.filter((p) => p.id !== id);
        if (state.projects.length === before) throw web.error(404, "No such project");
        await save(host, state);
        web.send("changed", { at: Date.now() });
        return { ok: true };
    });

    const update = defineTool({
        name: "portfolio_update",
        description:
            "Set a project's status, next action, or note on the Portfolio page. Use the project's name or folder; with none, the session's folder is used (and a project is added if needed).",
        parameters: Type.Object({
            project: Type.Optional(Type.String({ description: "Project name or folder; defaults to this session's folder" })),
            status: Type.Optional(
                Type.Union([Type.Literal("active"), Type.Literal("blocked"), Type.Literal("paused"), Type.Literal("done")], {
                    description: "active, blocked, paused, or done",
                }),
            ),
            next: Type.Optional(Type.String({ description: "The next concrete action, one line" })),
            note: Type.Optional(Type.String({ description: "A short note, why it is blocked for example" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
            const cwd = api.env?.cwd ?? (await api.agent(context)).cwd;
            const state = await load(host);
            let project = findProject(state, args.project, cwd);
            const now = Date.now();

            if (!project) {
                if (!cwd) throw new Error("Name a project, or run this in a session with a folder.");
                project = {
                    id: newId(),
                    name: basename(cwd) || cwd,
                    folder: cleanFolder(cwd),
                    sessionId: api.conversationId,
                    status: "active",
                    next: "",
                    note: "",
                    createdAt: now,
                    updatedAt: now,
                };
                state.projects.push(project);
            }

            if (args.status) project.status = args.status;
            if (typeof args.next === "string") project.next = args.next.trim().slice(0, 300);
            if (typeof args.note === "string") project.note = args.note.trim().slice(0, 1000);
            project.updatedAt = now;
            await save(host, state);
            web.send("changed", { at: now });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: `${project.name}: ${statusLabel(project.status)}${project.next ? ` — next: ${project.next}` : ""}`,
                    },
                ],
            };
        },
    });

    const list = defineTool({
        name: "portfolio_list",
        description: "List every project in the Portfolio with its status, next action, and how long ago it was last active.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async () => {
            const state = await load(host);
            const now = Date.now();
            const lines = state.projects.map((p) => {
                const age = p.updatedAt ? `${Math.floor((now - p.updatedAt) / 86_400_000)}d` : "never";
                return `${statusLabel(p.status)} ${p.name}${p.next ? ` — next: ${p.next}` : " — no next action"} (${age} ago)`;
            });
            return {
                content: [
                    {
                        type: "text" as const,
                        text: lines.length ? `${lines.length} projects\n${lines.join("\n")}` : "The Portfolio has no projects yet.",
                    },
                ],
            };
        },
    });

    const rule = section(
        "portfolio_status",
        () =>
            "This Pi Pocket has a Portfolio page for project status. When you finish a meaningful piece of work, call portfolio_update with the status (active, blocked, paused, or done) and the next concrete action, one line each. Keep it current and do not narrate the update.",
    );

    web.client("portfolio");

    return defineExtension({ name: "portfolio", tools: [update, list], sections: [rule] });
}
