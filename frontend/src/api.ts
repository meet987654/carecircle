import type { Member, NewTask, Recipient, Task, Today } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : `Request failed (${res.status})`;
    throw new ApiError(res.status, detail, body);
  }
  return body as T;
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  // Session is an httpOnly cookie set by the server; fetch sends it on same-origin requests.
  login: (email: string, password: string) =>
    request<{ member: Member; token: string }>("/api/auth/login", post({ email, password })),
  logout: () => request<void>("/api/auth/logout", post({})),
  me: () => request<Member>("/api/auth/me"),
  recipient: () => request<Recipient>("/api/recipient"),
  today: () => request<Today>("/api/today"),
  createTask: (task: NewTask) => request<Task>("/api/tasks", post(task)),
  // Who did it comes from the session, not from the request.
  complete: (id: number) => request<Task>(`/api/tasks/${id}/complete`, post({})),
  reopen: (id: number) => request<Task>(`/api/tasks/${id}/reopen`, post({})),
  deleteTask: (id: number) => request<void>(`/api/tasks/${id}`, { method: "DELETE" }),
  feedback: (interactionId: number, helpful: boolean) =>
    request<void>(`/api/assistant/interactions/${interactionId}/feedback`, post({ helpful })),
};

/** An earlier question and answer, sent along so follow-ups ("did she take it?") make sense. */
export interface Turn {
  question: string;
  answer: string;
}

export interface AskHandlers {
  onMeta?: (meta: { interaction_id: number; provider: string }) => void;
  onToken: (text: string) => void;
  onDone?: (info: { latency_ms: number; first_token_ms: number | null }) => void;
  onError?: (message: string) => void;
}

/**
 * Streams the assistant's answer. The server speaks Server-Sent Events over a
 * POST response, so we read the body stream and split it into SSE frames
 * ("event: x\ndata: {...}\n\n") ourselves.
 */
export async function ask(
  question: string,
  history: Turn[],
  handlers: AskHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/assistant/ask", {
    ...post({ question, history }),
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, "Assistant unavailable", null);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === "token") handlers.onToken(payload.text);
      else if (event === "meta") handlers.onMeta?.(payload);
      else if (event === "done") handlers.onDone?.(payload);
      else if (event === "error") handlers.onError?.(payload.message);
    }
  }
}
