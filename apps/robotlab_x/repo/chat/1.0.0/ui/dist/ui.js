import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { useWsClient } from "@rlx/ui";
const MAX_TURNS = 200;
function ChatFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const inboxTopic = `/chat/${proxyId}/inbox`;
  const spokenTopic = `/chat/${proxyId}/spoken`;
  const stateTopic = `/chat/${proxyId}/state`;
  const [transcript, setTranscript] = useState([]);
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);
  const keyCounterRef = useRef(0);
  const pushTurn = useCallback((from, text, ts) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    keyCounterRef.current += 1;
    const key = `${ts}-${keyCounterRef.current}`;
    setTranscript((prev) => {
      const next = [...prev, { from, text: trimmed, ts, key }];
      return next.length > MAX_TURNS ? next.slice(next.length - MAX_TURNS) : next;
    });
  }, []);
  useEffect(() => {
    if (!proxyId) return;
    const offInbox = wsClient.subscribe(inboxTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload ?? {};
      if (typeof p.text !== "string") return;
      pushTurn("operator", p.text, p.ts ?? Date.now() / 1e3);
    });
    const offSpoken = wsClient.subscribe(spokenTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload ?? {};
      if (typeof p.text !== "string") return;
      pushTurn("brain", p.text, p.ts ?? Date.now() / 1e3);
    });
    const offState = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState(f.payload);
    });
    return () => {
      offInbox();
      offSpoken();
      offState();
    };
  }, [proxyId, inboxTopic, spokenTopic, stateTopic, wsClient, pushTurn]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [transcript.length]);
  const serviceRunning = proxy.status === "running" || proxy.status === "starting";
  const send = useCallback(
    (e) => {
      e?.preventDefault();
      const text = draft.trim();
      if (!text || !serviceRunning) return;
      wsClient.publish(inboxTopic, { text, ts: Date.now() / 1e3 });
      setDraft("");
    },
    [draft, inboxTopic, serviceRunning, wsClient]
  );
  const onKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);
  const fmtTime = (ts) => {
    const d = new Date(ts * 1e3);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: "flex h-full min-h-[260px] min-w-[300px] flex-col gap-2 p-3 text-xs",
      onPointerDown: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-baseline justify-between text-[10px] text-slate-500", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            "chat-",
            proxyId
          ] }),
          /* @__PURE__ */ jsx("span", { className: "flex items-baseline gap-2", children: state ? /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("span", { className: state.listening ? "text-emerald-400" : "text-slate-500", children: state.listening ? "● listening" : "○ idle" }),
            state.queued > 0 && /* @__PURE__ */ jsxs("span", { className: "text-amber-400", title: "Messages queued for the next listen() call", children: [
              "queued ",
              state.queued
            ] })
          ] }) : /* @__PURE__ */ jsx("span", { children: serviceRunning ? "loading…" : "service not running" }) })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "relative min-h-0 flex-1 rounded border border-slate-800 bg-slate-950/60", children: /* @__PURE__ */ jsx(
          "div",
          {
            ref: scrollRef,
            className: "nodrag nopan absolute inset-0 flex flex-col gap-1 overflow-y-auto p-2",
            onWheel: (e) => e.stopPropagation(),
            children: transcript.length === 0 ? /* @__PURE__ */ jsx("div", { className: "text-[11px] text-slate-600", children: serviceRunning ? "no conversation yet — type below to talk to the brain" : "start the chat service to begin a conversation" }) : transcript.map((t) => {
              const isOperator = t.from === "operator";
              return /* @__PURE__ */ jsxs(
                "div",
                {
                  className: `flex flex-col ${isOperator ? "items-end" : "items-start"}`,
                  children: [
                    /* @__PURE__ */ jsxs("span", { className: "text-[9px] text-slate-600", children: [
                      t.from,
                      " · ",
                      fmtTime(t.ts)
                    ] }),
                    /* @__PURE__ */ jsx(
                      "div",
                      {
                        className: `max-w-[85%] whitespace-pre-wrap break-words rounded px-2 py-1 text-[11px] ${isOperator ? "bg-sky-950/60 text-sky-100" : "bg-emerald-950/60 text-emerald-100"}`,
                        children: t.text
                      }
                    )
                  ]
                },
                t.key
              );
            })
          }
        ) }),
        /* @__PURE__ */ jsxs("form", { onSubmit: send, className: "flex items-end gap-2", children: [
          /* @__PURE__ */ jsx(
            "textarea",
            {
              value: draft,
              onChange: (e) => setDraft(e.target.value),
              onKeyDown,
              onClick: (e) => e.stopPropagation(),
              disabled: !serviceRunning,
              rows: 2,
              placeholder: serviceRunning ? "type here, Enter to send" : "service not running",
              className: "nodrag nopan min-h-[44px] flex-1 resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 font-sans text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none disabled:opacity-50"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "submit",
              onClick: (e) => e.stopPropagation(),
              onPointerDown: (e) => e.stopPropagation(),
              disabled: !serviceRunning || draft.trim().length === 0,
              className: "nodrag nopan rounded bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40",
              children: "Send"
            }
          )
        ] })
      ]
    }
  );
}
export {
  ChatFullView as default
};
