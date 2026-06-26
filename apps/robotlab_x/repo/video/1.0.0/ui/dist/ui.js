import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useWsClient, useActiveRuntime } from "@rlx/ui";
function VideoFullView({ proxy }) {
  const wsClient = useWsClient();
  const { connection } = useActiveRuntime();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/video/${proxyId}/state`;
  const streamId = `video/${proxyId}`;
  const [state, setState] = useState({});
  const [sourceDraft, setSourceDraft] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [picking, setPicking] = useState(null);
  const [rectDraft, setRectDraft] = useState(null);
  const mjpegImgRef = useRef(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotPayload, setSnapshotPayload] = useState(null);
  const [snapshotError, setSnapshotError] = useState(null);
  const [snapshotPending, setSnapshotPending] = useState(false);
  const pendingRequestIdRef = useRef(null);
  useEffect(() => {
    if (!proxyId) return;
    const off = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (!p || typeof p !== "object") return;
      setState(p);
    });
    return off;
  }, [proxyId, stateTopic, wsClient]);
  useEffect(() => {
    if (sourceDraft === "" && state.source) setSourceDraft(state.source);
  }, [state.source, sourceDraft]);
  const mjpegUrl = useMemo(() => {
    if (!connection) return null;
    const token = connection.getAccessToken();
    if (!token) return null;
    return `${connection.url}/v1/stream/${encodeURIComponent(streamId)}/mjpeg?token=${encodeURIComponent(token)}&_=${reloadTick}`;
  }, [connection, streamId, reloadTick]);
  const sendAction = useCallback(
    (action, args = {}) => {
      wsClient.publish(`/video/${proxyId}/control`, { action, ...args });
    },
    [wsClient, proxyId]
  );
  const onConnect = useCallback((e) => {
    e?.preventDefault();
    const src = sourceDraft.trim();
    sendAction("connect", src ? { source: src } : {});
    setReloadTick((t) => t + 1);
  }, [sourceDraft, sendAction]);
  const onDisconnect = useCallback(() => {
    sendAction("disconnect");
  }, [sendAction]);
  const onSnapshot = useCallback(() => {
    if (snapshotPending) return;
    const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    pendingRequestIdRef.current = requestId;
    setSnapshotOpen(true);
    setSnapshotPending(true);
    setSnapshotPayload(null);
    setSnapshotError(null);
    const off = wsClient.subscribe(`/video/${proxyId}/snapshot`, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (!p || typeof p !== "object") return;
      if (p.request_id !== pendingRequestIdRef.current) return;
      off();
      window.clearTimeout(timeoutId);
      pendingRequestIdRef.current = null;
      setSnapshotPending(false);
      if (p.error) {
        setSnapshotError(p.error);
      } else {
        setSnapshotPayload(p);
      }
    });
    const timeoutId = window.setTimeout(() => {
      if (pendingRequestIdRef.current !== requestId) return;
      off();
      pendingRequestIdRef.current = null;
      setSnapshotPending(false);
      setSnapshotError("snapshot timed out — no response from video service in 5s");
    }, 5e3);
    sendAction("snapshot", { request_id: requestId });
  }, [snapshotPending, wsClient, proxyId, sendAction]);
  const closeSnapshotModal = useCallback(() => {
    setSnapshotOpen(false);
    setSnapshotPayload(null);
    setSnapshotError(null);
    pendingRequestIdRef.current = null;
  }, []);
  const startPicking = useCallback(
    (filterId, paramName, type, currentValue) => {
      setPicking({ filterId, paramName, type, value: currentValue ?? [] });
    },
    []
  );
  const eventToImagePoint = useCallback((e) => {
    const img = mjpegImgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const rect = img.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    if (offsetX < 0 || offsetY < 0 || offsetX > rect.width || offsetY > rect.height) return null;
    return [
      Math.round(offsetX / rect.width * img.naturalWidth),
      Math.round(offsetY / rect.height * img.naturalHeight)
    ];
  }, []);
  const publishParam = useCallback((req, value) => {
    wsClient.publish(`/video/${proxyId}/control`, {
      action: "update_filter",
      id: req.filterId,
      params: { [req.paramName]: value }
    });
  }, [wsClient, proxyId]);
  const onOverlayMouseDown = useCallback((e) => {
    if (!picking) return;
    const p = eventToImagePoint(e);
    if (!p) return;
    if (picking.type === "point") {
      const next = p;
      setPicking({ ...picking, value: next });
      publishParam(picking, next);
    } else if (picking.type === "points") {
      const cur = picking.value ?? [];
      const next = [...cur, p];
      setPicking({ ...picking, value: next });
      publishParam(picking, next);
    } else if (picking.type === "rect") {
      setRectDraft([p[0], p[1], 0, 0]);
    }
  }, [picking, eventToImagePoint, publishParam]);
  const onOverlayMouseMove = useCallback((e) => {
    if (!picking || picking.type !== "rect" || !rectDraft) return;
    const p = eventToImagePoint(e);
    if (!p) return;
    const [x0, y0] = [rectDraft[0], rectDraft[1]];
    setRectDraft([x0, y0, p[0] - x0, p[1] - y0]);
  }, [picking, rectDraft, eventToImagePoint]);
  const onOverlayMouseUp = useCallback(() => {
    if (!picking) return;
    if (picking.type === "rect" && rectDraft) {
      let [x, y, w, h] = rectDraft;
      if (w < 0) {
        x = x + w;
        w = -w;
      }
      if (h < 0) {
        y = y + h;
        h = -h;
      }
      setRectDraft(null);
      if (w < 2 || h < 2) return;
      const next = [x, y, w, h];
      setPicking({ ...picking, value: next });
      publishParam(picking, next);
    }
  }, [picking, rectDraft, publishParam]);
  const onOverlayMouseLeave = useCallback(() => {
    if (rectDraft) setRectDraft(null);
  }, [rectDraft]);
  const stopPicking = useCallback(() => {
    setRectDraft(null);
    setPicking(null);
  }, []);
  const clearPickedValue = useCallback(() => {
    if (!picking) return;
    const empty = picking.type === "points" ? [] : [];
    setRectDraft(null);
    setPicking({ ...picking, value: empty });
    publishParam(picking, empty);
  }, [picking, publishParam]);
  const downloadSnapshot = useCallback(() => {
    if (!snapshotPayload?.jpeg_b64) return;
    const a = document.createElement("a");
    a.href = `data:image/jpeg;base64,${snapshotPayload.jpeg_b64}`;
    const ts = snapshotPayload.ts ? new Date(snapshotPayload.ts * 1e3).toISOString().replace(/[:.]/g, "-") : Date.now();
    a.download = `${proxyId}-${ts}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [snapshotPayload, proxyId]);
  const connected = state.connected === true;
  const resLabel = state.resolution ? `${state.resolution[0]}×${state.resolution[1]}` : "—";
  return /* @__PURE__ */ jsxs("div", { className: "flex min-w-[420px] flex-col gap-3 p-3 text-xs", children: [
    /* @__PURE__ */ jsxs("section", { className: "relative overflow-hidden rounded border border-slate-800 bg-black", children: [
      mjpegUrl && connected ? /* @__PURE__ */ jsx(
        "img",
        {
          ref: mjpegImgRef,
          src: mjpegUrl,
          alt: `stream ${streamId}`,
          className: "block h-auto w-full",
          draggable: false,
          onError: () => {
            window.setTimeout(() => setReloadTick((t) => t + 1), 1500);
          }
        },
        reloadTick
      ) : /* @__PURE__ */ jsx("div", { className: "flex aspect-video items-center justify-center text-slate-500", children: state.error ? /* @__PURE__ */ jsx("span", { className: "font-mono text-rose-400", children: state.error }) : connected ? "connecting to stream…" : "disconnected" }),
      picking && /* @__PURE__ */ jsx(
        PickOverlay,
        {
          picking,
          rectDraft,
          mjpegImgRef,
          onMouseDown: onOverlayMouseDown,
          onMouseMove: onOverlayMouseMove,
          onMouseUp: onOverlayMouseUp,
          onMouseLeave: onOverlayMouseLeave,
          onClear: clearPickedValue,
          onDone: stopPicking
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "grid grid-cols-3 gap-x-3 gap-y-1 rounded border border-slate-800 bg-slate-900/40 p-2 font-mono text-[10px] text-slate-400", children: [
      /* @__PURE__ */ jsx(Cell, { label: "source", value: state.source ?? "—" }),
      /* @__PURE__ */ jsx(Cell, { label: "resolution", value: resLabel }),
      /* @__PURE__ */ jsx(Cell, { label: "fps", value: state.observed_fps != null ? state.observed_fps.toFixed(1) : "—" }),
      /* @__PURE__ */ jsx(Cell, { label: "declared fps", value: state.declared_fps != null ? state.declared_fps.toFixed(1) : "—" }),
      /* @__PURE__ */ jsx(Cell, { label: "dropped", value: state.dropped?.toString() ?? "0" }),
      /* @__PURE__ */ jsx(Cell, { label: "status", value: connected ? "connected" : "idle", tone: connected ? "emerald" : "slate" })
    ] }),
    /* @__PURE__ */ jsx(ServiceTopics, { proxyId, typeName: "video" }),
    /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-2", children: [
      /* @__PURE__ */ jsxs("form", { onSubmit: onConnect, className: "flex items-end gap-2", children: [
        /* @__PURE__ */ jsxs("label", { className: "flex flex-1 flex-col", children: [
          /* @__PURE__ */ jsx("span", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "source" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "text",
              value: sourceDraft,
              onChange: (e) => setSourceDraft(e.target.value),
              placeholder: "0 (device), file path, or rtsp://…",
              className: "nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] focus:border-slate-500 focus:outline-none",
              onPointerDown: (e) => e.stopPropagation()
            }
          )
        ] }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "submit",
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500",
            children: "Connect"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: onDisconnect,
            onPointerDown: (e) => e.stopPropagation(),
            disabled: !connected,
            className: "nodrag nopan rounded border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500 disabled:opacity-40",
            children: "Disconnect"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: onSnapshot,
            onPointerDown: (e) => e.stopPropagation(),
            disabled: !connected || snapshotPending,
            title: "Capture a single frame + publish on /video/<id>/snapshot",
            className: "nodrag nopan rounded border border-sky-700 bg-sky-900/40 px-2 py-1 text-[11px] text-sky-200 hover:border-sky-500 disabled:opacity-40",
            children: snapshotPending ? "…" : "Snapshot"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "mt-1.5 text-[10px] text-slate-500", children: [
        "Source: ",
        /* @__PURE__ */ jsx("code", { className: "font-mono", children: "0" }),
        " = first webcam · file path · ",
        /* @__PURE__ */ jsx("code", { className: "font-mono", children: "rtsp://…" })
      ] })
    ] }),
    /* @__PURE__ */ jsx(
      FilterPipeline,
      {
        proxyId,
        onStartPick: startPicking,
        pickingFilterId: picking?.filterId ?? null
      }
    ),
    snapshotOpen && /* @__PURE__ */ jsx(
      SnapshotPanel,
      {
        proxyId,
        pending: snapshotPending,
        payload: snapshotPayload,
        error: snapshotError,
        onClose: closeSnapshotModal,
        onDownload: downloadSnapshot,
        onRetake: onSnapshot
      }
    )
  ] });
}
function SnapshotPanel({
  proxyId,
  pending,
  payload,
  error,
  onClose,
  onDownload,
  onRetake
}) {
  const dataUrl = payload?.jpeg_b64 ? `data:image/jpeg;base64,${payload.jpeg_b64}` : null;
  const tsLabel = payload?.ts ? new Date(payload.ts * 1e3).toLocaleString() : null;
  const resLabel = payload?.resolution ? `${payload.resolution[0]}×${payload.resolution[1]}` : null;
  const [pos, setPos] = useState(() => ({
    x: typeof window !== "undefined" ? Math.max(window.innerWidth - 440, 20) : 80,
    y: 80
  }));
  const dragRef = useRef({
    dragging: false,
    offX: 0,
    offY: 0
  });
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.dragging) return;
      setPos({
        x: e.clientX - dragRef.current.offX,
        y: e.clientY - dragRef.current.offY
      });
    };
    const onUp = () => {
      dragRef.current.dragging = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);
  const onHeaderPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      dragging: true,
      offX: e.clientX - pos.x,
      offY: e.clientY - pos.y
    };
  }, [pos.x, pos.y]);
  return createPortal(
    /* @__PURE__ */ jsxs(
      "div",
      {
        className: "fixed z-50 flex max-h-[80vh] w-[420px] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-200 shadow-2xl",
        style: { left: pos.x, top: pos.y },
        onPointerDown: (e) => e.stopPropagation(),
        children: [
          /* @__PURE__ */ jsxs(
            "header",
            {
              onPointerDown: onHeaderPointerDown,
              className: "flex cursor-move select-none items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5",
              children: [
                /* @__PURE__ */ jsxs("div", { className: "flex min-w-0 items-baseline gap-2", children: [
                  /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "snapshot from" }),
                  /* @__PURE__ */ jsx("span", { className: "truncate font-mono text-sm text-fuchsia-300", title: proxyId, children: proxyId })
                ] }),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    onClick: onClose,
                    className: "rounded p-1 text-slate-400 hover:text-slate-200",
                    title: "Close",
                    children: "×"
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ jsxs("div", { className: "flex-1 overflow-auto bg-black", children: [
            pending && /* @__PURE__ */ jsx("div", { className: "flex aspect-video items-center justify-center text-[11px] text-slate-500", children: "capturing…" }),
            !pending && error && /* @__PURE__ */ jsx("div", { className: "flex aspect-video items-center justify-center px-4 text-center font-mono text-[11px] text-rose-300", children: error }),
            !pending && !error && dataUrl && /* @__PURE__ */ jsx(
              "img",
              {
                src: dataUrl,
                alt: `snapshot from ${proxyId}`,
                className: "block w-full",
                draggable: false
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("footer", { className: "flex items-center gap-2 border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-400", children: [
            /* @__PURE__ */ jsxs("span", { className: "truncate font-mono", children: [
              tsLabel ?? "—",
              resLabel ? ` · ${resLabel}` : ""
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "ml-auto flex gap-1.5", children: [
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  onClick: onRetake,
                  disabled: pending,
                  className: "rounded border border-slate-700 px-2 py-0.5 text-[10px] hover:border-slate-500 disabled:opacity-40",
                  children: "Retake"
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  onClick: onDownload,
                  disabled: !dataUrl,
                  className: "rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40",
                  children: "Download"
                }
              )
            ] })
          ] })
        ]
      }
    ),
    document.body
  );
}
function Cell({ label, value, tone }) {
  const valColor = tone === "emerald" ? "text-emerald-300" : "text-slate-200";
  return /* @__PURE__ */ jsxs("div", { className: "flex items-baseline gap-1.5", children: [
    /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: label }),
    /* @__PURE__ */ jsx("span", { className: `truncate ${valColor}`, title: value, children: value })
  ] });
}
function FilterPipeline({
  proxyId,
  onStartPick,
  pickingFilterId
}) {
  const wsClient = useWsClient();
  const [catalog, setCatalog] = useState([]);
  const [filters, setFilters] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    const offCat = wsClient.subscribe(`/video/${proxyId}/filter_catalog`, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (p && Array.isArray(p.filters)) setCatalog(p.filters);
    });
    const offFil = wsClient.subscribe(`/video/${proxyId}/filters`, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (p && Array.isArray(p.filters)) setFilters(p.filters);
    });
    return () => {
      offCat();
      offFil();
    };
  }, [proxyId, wsClient]);
  const sendControl = useCallback(
    (action, args = {}) => {
      wsClient.publish(`/video/${proxyId}/control`, { action, ...args });
    },
    [wsClient, proxyId]
  );
  const onAdd = useCallback((type) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    sendControl("add_filter", { type, id });
    setExpandedId(id);
    setAddOpen(false);
  }, [sendControl]);
  const onRemove = useCallback((id) => {
    if (expandedId === id) setExpandedId(null);
    sendControl("remove_filter", { id });
  }, [sendControl, expandedId]);
  const onUpdate = useCallback((id, patch) => {
    sendControl("update_filter", { id, ...patch });
  }, [sendControl]);
  const onReorder = useCallback((id, dir) => {
    const idx = filters.findIndex((f) => f.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= filters.length) return;
    const ids = filters.map((f) => f.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    sendControl("reorder_filters", { ids });
  }, [filters, sendControl]);
  const catalogByType = useMemo(
    () => new Map(catalog.map((c) => [c.type, c])),
    [catalog]
  );
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40", children: [
    /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between border-b border-slate-800 px-3 py-1.5", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-baseline gap-2", children: [
        /* @__PURE__ */ jsx("h3", { className: "text-[10px] uppercase tracking-wider text-slate-400", children: "Filters" }),
        /* @__PURE__ */ jsx("span", { className: "font-mono text-[10px] text-slate-500", children: filters.length })
      ] }),
      /* @__PURE__ */ jsx(
        AddFilterMenu,
        {
          catalog,
          open: addOpen,
          onToggle: () => setAddOpen((v) => !v),
          onClose: () => setAddOpen(false),
          onPick: onAdd
        }
      )
    ] }),
    filters.length === 0 ? /* @__PURE__ */ jsx("div", { className: "px-3 py-3 text-center text-[10px] text-slate-500", children: "No filters. The camera frame passes through unchanged." }) : /* @__PURE__ */ jsx("ul", { className: "divide-y divide-slate-800", children: filters.map((spec, idx) => {
      const cat = catalogByType.get(spec.type);
      return /* @__PURE__ */ jsx(
        FilterCard,
        {
          index: idx + 1,
          spec,
          catalog: cat ?? null,
          expanded: expandedId === spec.id,
          isFirst: idx === 0,
          isLast: idx === filters.length - 1,
          isPicking: pickingFilterId === spec.id,
          onToggleExpand: () => setExpandedId(expandedId === spec.id ? null : spec.id),
          onRemove: () => onRemove(spec.id),
          onUpdate: (patch) => onUpdate(spec.id, patch),
          onMove: (dir) => onReorder(spec.id, dir),
          onStartPick,
          proxyId
        },
        spec.id
      );
    }) })
  ] });
}
function AddFilterMenu({
  catalog,
  open,
  onToggle,
  onClose,
  onPick
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (c) => c.type.toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q) || (c.description || "").toLowerCase().includes(q)
    );
  }, [catalog, query]);
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIndex]);
  const onInputKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[activeIndex];
      if (c) onPick(c.type);
    }
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick: (e) => {
          e.stopPropagation();
          onToggle();
        },
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-[10px] text-emerald-200 hover:border-emerald-500",
        children: "+ Add ▾"
      }
    ),
    open && createPortal(
      /* @__PURE__ */ jsx(
        "div",
        {
          className: "fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 p-4 pt-20",
          onClick: onClose,
          onPointerDown: (e) => e.stopPropagation(),
          role: "dialog",
          "aria-modal": "true",
          children: /* @__PURE__ */ jsxs(
            "div",
            {
              className: "flex w-full max-w-md flex-col rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-200 shadow-2xl",
              style: { maxHeight: "min(70vh, 560px)" },
              onClick: (e) => e.stopPropagation(),
              children: [
                /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between border-b border-slate-800 px-4 py-2.5", children: [
                  /* @__PURE__ */ jsx("h3", { className: "text-[13px] font-semibold text-slate-100", children: "Add filter" }),
                  /* @__PURE__ */ jsx(
                    "button",
                    {
                      type: "button",
                      onClick: onClose,
                      className: "rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200",
                      title: "Close (Esc)",
                      children: "✕"
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxs("div", { className: "border-b border-slate-800 px-4 py-2", children: [
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      ref: inputRef,
                      type: "text",
                      value: query,
                      onChange: (e) => {
                        setQuery(e.target.value);
                        setActiveIndex(0);
                      },
                      onKeyDown: onInputKey,
                      onPointerDown: (e) => e.stopPropagation(),
                      placeholder: "Search filters…",
                      className: "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[12px] placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
                    }
                  ),
                  /* @__PURE__ */ jsxs("div", { className: "mt-1 text-[10px] text-slate-500", children: [
                    catalog.length === 0 ? "No catalog yet — is the video service running and connected?" : `${filtered.length} of ${catalog.length} filter${catalog.length === 1 ? "" : "s"}`,
                    catalog.length > 0 && /* @__PURE__ */ jsx("span", { className: "ml-2 text-slate-600", children: "↑↓ navigate · Enter add · Esc close" })
                  ] })
                ] }),
                /* @__PURE__ */ jsx("div", { className: "flex-1 overflow-y-auto", children: filtered.length === 0 ? /* @__PURE__ */ jsx("div", { className: "px-4 py-6 text-center text-[11px] text-slate-500", children: catalog.length === 0 ? "waiting for filter catalog…" : "no matches" }) : filtered.map((c, i) => {
                  const active = i === activeIndex;
                  return /* @__PURE__ */ jsxs(
                    "button",
                    {
                      type: "button",
                      onClick: (e) => {
                        e.stopPropagation();
                        onPick(c.type);
                      },
                      onMouseEnter: () => setActiveIndex(i),
                      className: `block w-full border-b border-slate-800 px-4 py-2 text-left last:border-b-0 ${active ? "bg-slate-800" : "hover:bg-slate-800/60"}`,
                      children: [
                        /* @__PURE__ */ jsxs("div", { className: "flex items-baseline justify-between gap-2", children: [
                          /* @__PURE__ */ jsx("span", { className: "text-[12px] font-medium text-slate-200", children: c.title }),
                          /* @__PURE__ */ jsx("span", { className: "shrink-0 font-mono text-[10px] text-slate-500", children: c.type })
                        ] }),
                        c.description && /* @__PURE__ */ jsx("div", { className: "mt-0.5 text-[10px] leading-snug text-slate-500", children: c.description })
                      ]
                    },
                    c.type
                  );
                }) })
              ]
            }
          )
        }
      ),
      document.body
    )
  ] });
}
function FilterCard({
  index,
  spec,
  catalog,
  expanded,
  isFirst,
  isLast,
  isPicking,
  onToggleExpand,
  onRemove,
  onUpdate,
  onMove,
  onStartPick,
  proxyId
}) {
  const title = catalog?.title ?? spec.type;
  const wsClient = useWsClient();
  const [status, setStatus] = useState(null);
  const telemetryTopic = spec.telemetry_topic ?? (catalog?.publishes_telemetry ? `/video/${proxyId}/filter/${spec.id}` : null);
  useEffect(() => {
    if (!telemetryTopic) return;
    const off = wsClient.subscribe(telemetryTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload ?? null;
      if (!p || typeof p !== "object") {
        setStatus(null);
        return;
      }
      const s = typeof p.status === "string" ? p.status : "";
      if (!s) {
        setStatus(null);
        return;
      }
      setStatus({
        status: s,
        message: typeof p.status_message === "string" ? p.status_message : ""
      });
    });
    return off;
  }, [telemetryTopic, wsClient]);
  const statusChip = status && status.status !== "ready" ? /* @__PURE__ */ jsx(
    "span",
    {
      className: `nodrag nopan rounded px-1.5 py-0.5 text-[9px] font-medium ${status.status === "loading" ? "bg-amber-900/60 text-amber-200" : status.status === "error" ? "bg-rose-900/60 text-rose-200" : "bg-slate-800 text-slate-300"}`,
      title: status.message || status.status,
      children: status.status === "loading" ? "loading…" : status.status
    }
  ) : null;
  return /* @__PURE__ */ jsxs("li", { className: "text-[11px]", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5 px-2 py-1.5", children: [
      /* @__PURE__ */ jsx("span", { className: "w-4 text-center font-mono text-[10px] text-slate-500", children: index }),
      /* @__PURE__ */ jsxs("div", { className: "flex flex-col", children: [
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: (e) => {
              e.stopPropagation();
              onMove(-1);
            },
            onPointerDown: (e) => e.stopPropagation(),
            disabled: isFirst,
            className: "nodrag nopan text-[8px] leading-none text-slate-500 hover:text-slate-300 disabled:opacity-30",
            title: "Move up",
            children: "▲"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: (e) => {
              e.stopPropagation();
              onMove(1);
            },
            onPointerDown: (e) => e.stopPropagation(),
            disabled: isLast,
            className: "nodrag nopan text-[8px] leading-none text-slate-500 hover:text-slate-300 disabled:opacity-30",
            title: "Move down",
            children: "▼"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          onClick: onToggleExpand,
          onPointerDown: (e) => e.stopPropagation(),
          className: "nodrag nopan flex flex-1 items-baseline gap-2 text-left",
          children: [
            /* @__PURE__ */ jsx("span", { className: "font-medium text-slate-200", children: title }),
            /* @__PURE__ */ jsx("span", { className: "font-mono text-[10px] text-slate-500", children: spec.type }),
            /* @__PURE__ */ jsx("span", { className: "ml-auto text-slate-500", children: expanded ? "▾" : "▸" })
          ]
        }
      ),
      statusChip,
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: (e) => {
            e.stopPropagation();
            onUpdate({ enabled: !spec.enabled });
          },
          onPointerDown: (e) => e.stopPropagation(),
          title: spec.enabled ? "Disable" : "Enable",
          className: `nodrag nopan rounded px-1.5 py-0.5 text-[9px] ${spec.enabled ? "bg-emerald-900/60 text-emerald-200 hover:bg-emerald-800" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`,
          children: spec.enabled ? "ON" : "OFF"
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: (e) => {
            e.stopPropagation();
            onRemove();
          },
          onPointerDown: (e) => e.stopPropagation(),
          title: "Remove",
          className: "nodrag nopan rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-rose-900/40 hover:text-rose-300",
          children: "✕"
        }
      )
    ] }),
    expanded && /* @__PURE__ */ jsxs("div", { className: "space-y-2 border-t border-slate-800 bg-slate-950/40 px-3 py-2", children: [
      catalog ? /* @__PURE__ */ jsx(
        ParamPanel,
        {
          schema: catalog.param_schema,
          values: spec.params,
          filterId: spec.id,
          isPicking,
          onChange: (params) => onUpdate({ params }),
          onStartPick
        }
      ) : /* @__PURE__ */ jsx("div", { className: "font-mono text-[10px] text-rose-300", children: "unknown filter type — not in catalog" }),
      catalog?.publishes_telemetry && /* @__PURE__ */ jsx(
        FilterTelemetry,
        {
          proxyId,
          filterId: spec.id,
          topicOverride: spec.telemetry_topic,
          telemetrySchema: catalog?.telemetry_schema ?? null
        }
      )
    ] })
  ] });
}
function ParamPanel({
  schema,
  values,
  filterId,
  isPicking,
  onChange,
  onStartPick
}) {
  if (schema.length === 0) {
    return /* @__PURE__ */ jsx("div", { className: "text-[10px] text-slate-500", children: "no parameters" });
  }
  const patch = (name, v) => {
    onChange({ ...values, [name]: v });
  };
  return /* @__PURE__ */ jsx("div", { className: "space-y-1.5", children: schema.map((p) => /* @__PURE__ */ jsx(
    ParamInput,
    {
      schema: p,
      value: values[p.name],
      filterId,
      isPicking,
      onChange: (v) => patch(p.name, v),
      onStartPick
    },
    p.name
  )) });
}
function ParamInput({
  schema,
  value,
  filterId,
  isPicking,
  onChange,
  onStartPick
}) {
  const label = schema.label ?? schema.name;
  const current = value === void 0 ? schema.default : value;
  if (schema.type === "point" || schema.type === "rect" || schema.type === "points") {
    const spatialType = schema.type;
    let summary;
    if (schema.type === "points") {
      const arr = Array.isArray(current) ? current : [];
      summary = arr.length === 0 ? "no points" : `${arr.length} point${arr.length === 1 ? "" : "s"}`;
    } else if (schema.type === "point") {
      const a = Array.isArray(current) && current.length >= 2 ? current : null;
      summary = a ? `[${a[0]}, ${a[1]}]` : "not set";
    } else {
      const a = Array.isArray(current) && current.length >= 4 ? current : null;
      summary = a ? `[${a[0]}, ${a[1]}, ${a[2]}×${a[3]}]` : "not set";
    }
    return /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx("span", { className: "w-32 text-[10px] uppercase tracking-wider text-slate-500", title: schema.help, children: label }),
      /* @__PURE__ */ jsx("span", { className: "flex-1 truncate font-mono text-[10px] text-slate-400", children: summary }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: (e) => {
            e.stopPropagation();
            onStartPick(filterId, schema.name, spatialType, current ?? []);
          },
          onPointerDown: (e) => e.stopPropagation(),
          className: `nodrag nopan rounded border px-2 py-0.5 text-[10px] ${isPicking ? "border-amber-500 bg-amber-900/40 text-amber-200" : "border-sky-700 bg-sky-900/40 text-sky-200 hover:border-sky-500"}`,
          children: isPicking ? "Picking…" : "Pick"
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: (e) => {
            e.stopPropagation();
            onChange(schema.type === "points" ? [] : []);
          },
          onPointerDown: (e) => e.stopPropagation(),
          title: "Clear",
          className: "nodrag nopan rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-200",
          children: "✕"
        }
      )
    ] });
  }
  if (schema.type === "bool") {
    return /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "checkbox",
          checked: !!current,
          onChange: (e) => onChange(e.target.checked),
          onPointerDown: (e) => e.stopPropagation(),
          className: "nodrag nopan"
        }
      ),
      /* @__PURE__ */ jsx("span", { className: "text-[11px] text-slate-300", children: label }),
      schema.help && /* @__PURE__ */ jsxs("span", { className: "text-[9px] text-slate-500", children: [
        "— ",
        schema.help
      ] })
    ] });
  }
  if (schema.type === "enum") {
    return /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx("span", { className: "w-32 text-[10px] uppercase tracking-wider text-slate-500", children: label }),
      /* @__PURE__ */ jsx(
        "select",
        {
          value: String(current),
          onChange: (e) => onChange(e.target.value),
          onPointerDown: (e) => e.stopPropagation(),
          className: "nodrag nopan rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]",
          children: (schema.choices ?? []).map((c) => /* @__PURE__ */ jsx("option", { value: c, children: c }, c))
        }
      )
    ] });
  }
  if (schema.type === "string") {
    const text = typeof current === "string" ? current : current == null ? "" : String(current);
    return /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2", children: [
      /* @__PURE__ */ jsx(
        "span",
        {
          className: "w-32 shrink-0 text-[10px] uppercase tracking-wider text-slate-500",
          title: schema.help,
          children: label
        }
      ),
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "text",
          value: text,
          onChange: (e) => onChange(e.target.value),
          onPointerDown: (e) => e.stopPropagation(),
          onClick: (e) => e.stopPropagation(),
          placeholder: schema.placeholder,
          className: "nodrag nopan flex-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
        }
      )
    ] });
  }
  const num = typeof current === "number" ? current : Number(current) || 0;
  return /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
    /* @__PURE__ */ jsx("span", { className: "w-32 text-[10px] uppercase tracking-wider text-slate-500", title: schema.help, children: label }),
    schema.min != null && schema.max != null ? /* @__PURE__ */ jsx(
      "input",
      {
        type: "range",
        min: schema.min,
        max: schema.max,
        step: schema.step ?? (schema.type === "int" ? 1 : 0.01),
        value: num,
        onChange: (e) => onChange(schema.type === "int" ? parseInt(e.target.value, 10) : parseFloat(e.target.value)),
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan flex-1"
      }
    ) : null,
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "number",
        min: schema.min,
        max: schema.max,
        step: schema.step ?? (schema.type === "int" ? 1 : 0.01),
        value: num,
        onChange: (e) => {
          const v = e.target.value;
          if (v === "") return;
          onChange(schema.type === "int" ? parseInt(v, 10) : parseFloat(v));
        },
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right font-mono text-[11px]"
      }
    )
  ] });
}
function FilterTelemetry({
  proxyId,
  filterId,
  topicOverride,
  telemetrySchema
}) {
  const wsClient = useWsClient();
  const [data, setData] = useState(null);
  const [showSchema, setShowSchema] = useState(false);
  const topic = topicOverride ?? `/video/${proxyId}/filter/${filterId}`;
  useEffect(() => {
    const off = wsClient.subscribe(topic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (p === null) {
        setData(null);
        return;
      }
      if (typeof p === "object") setData(p);
    });
    return off;
  }, [topic, wsClient]);
  return /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-900/60 p-2", children: [
    /* @__PURE__ */ jsxs("div", { className: "mb-1 flex items-baseline justify-between gap-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-baseline gap-2", children: [
        /* @__PURE__ */ jsx("span", { className: "text-[9px] uppercase tracking-wider text-slate-500", children: "telemetry" }),
        telemetrySchema && /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: (e) => {
              e.stopPropagation();
              setShowSchema((v) => !v);
            },
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan text-[9px] uppercase tracking-wider text-slate-500 hover:text-slate-300",
            title: "Toggle JSON Schema for this filter's telemetry payload",
            children: showSchema ? "▾ schema" : "▸ schema"
          }
        )
      ] }),
      /* @__PURE__ */ jsx(
        "span",
        {
          className: "select-all truncate font-mono text-[9px] text-sky-400",
          title: `Published to ${topic} (retained). Click to select for copy.`,
          children: topic
        }
      )
    ] }),
    showSchema && telemetrySchema && /* @__PURE__ */ jsx(SchemaBlock, { label: `payload — ${telemetrySchema.title ?? ""}`, schema: telemetrySchema }),
    data === null ? /* @__PURE__ */ jsx("div", { className: "text-[10px] text-slate-500", children: "no data yet" }) : /* @__PURE__ */ jsx("dl", { className: "grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]", children: Object.entries(data).map(([k, v]) => /* @__PURE__ */ jsxs("div", { className: "contents", children: [
      /* @__PURE__ */ jsx("dt", { className: "text-slate-500", children: k }),
      /* @__PURE__ */ jsx("dd", { className: "truncate text-slate-200", title: String(v), children: formatTelemetryValue(v) })
    ] }, k)) })
  ] });
}
function formatTelemetryValue(v) {
  if (v === null || v === void 0) return "—";
  if (typeof v === "boolean") return v ? "✓ yes" : "✗ no";
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function ServiceTopics({ proxyId, typeName }) {
  const wsClient = useWsClient();
  const [meta, setMeta] = useState(null);
  const [type, setType] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [showSchemas, setShowSchemas] = useState(false);
  const metaTopic = `/${typeName}/${proxyId}/meta`;
  const typeTopic = `/runtime/runtime/types/${typeName}`;
  useEffect(() => {
    const off = wsClient.subscribe(metaTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (p === null || p === void 0) {
        setMeta(null);
        return;
      }
      if (typeof p === "object") setMeta(p);
    });
    return off;
  }, [metaTopic, wsClient]);
  useEffect(() => {
    const off = wsClient.subscribe(typeTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (p === null || p === void 0) {
        setType(null);
        return;
      }
      if (typeof p === "object") setType(p);
    });
    return off;
  }, [typeTopic, wsClient]);
  const copyToClipboard = useCallback((text) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch {
    }
  }, []);
  const methodArgs = (name) => (type?.methods ?? []).find((m) => m.name === name);
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40", children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        onClick: () => setExpanded((v) => !v),
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left",
        children: [
          /* @__PURE__ */ jsxs("span", { className: "flex items-baseline gap-2", children: [
            /* @__PURE__ */ jsx("span", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: "topics" }),
            meta ? /* @__PURE__ */ jsxs("span", { className: "font-mono text-[9px] text-slate-400", children: [
              Object.keys(meta.topics ?? {}).length,
              " topics ·",
              " ",
              (meta.methods ?? []).length,
              " methods · ",
              meta.transport ?? "—"
            ] }) : /* @__PURE__ */ jsx("span", { className: "text-[10px] text-slate-500", children: "no meta yet" })
          ] }),
          /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: expanded ? "▾" : "▸" })
        ]
      }
    ),
    expanded && meta && /* @__PURE__ */ jsxs("div", { className: "space-y-2 border-t border-slate-800 bg-slate-950/40 p-2", children: [
      /* @__PURE__ */ jsxs("dl", { className: "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px]", children: [
        /* @__PURE__ */ jsx("dt", { className: "text-slate-500", children: "runtime" }),
        /* @__PURE__ */ jsx("dd", { className: "text-slate-300", children: meta.runtime_id ?? "—" }),
        /* @__PURE__ */ jsx("dt", { className: "text-slate-500", children: "type/version" }),
        /* @__PURE__ */ jsxs("dd", { className: "text-slate-300", children: [
          meta.type,
          "@",
          meta.version ?? "?"
        ] }),
        /* @__PURE__ */ jsx("dt", { className: "text-slate-500", children: "pid" }),
        /* @__PURE__ */ jsx("dd", { className: "text-slate-300", children: meta.pid ?? "—" }),
        /* @__PURE__ */ jsx("dt", { className: "text-slate-500", children: "root" }),
        /* @__PURE__ */ jsx("dd", { className: "select-all truncate text-sky-400", title: meta.topics_root, children: meta.topics_root })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("div", { className: "mb-0.5 text-[9px] uppercase tracking-wider text-slate-500", children: "bus topics" }),
        /* @__PURE__ */ jsx("ul", { className: "space-y-0.5", children: Object.entries(meta.topics ?? {}).map(([k, v]) => /* @__PURE__ */ jsxs("li", { className: "flex items-baseline gap-2 font-mono text-[10px]", children: [
          /* @__PURE__ */ jsx("span", { className: "w-24 shrink-0 text-slate-500", children: k }),
          /* @__PURE__ */ jsx("span", { className: "select-all flex-1 truncate text-sky-400", title: v, children: v }),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: (e) => {
                e.stopPropagation();
                copyToClipboard(v);
              },
              onPointerDown: (e) => e.stopPropagation(),
              title: "Copy to clipboard",
              className: "nodrag nopan rounded px-1 py-0.5 text-[9px] text-slate-500 hover:bg-slate-800 hover:text-slate-200",
              children: "copy"
            }
          )
        ] }, k)) })
      ] }),
      (meta.methods ?? []).length > 0 && /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs("div", { className: "mb-0.5 text-[9px] uppercase tracking-wider text-slate-500", children: [
          "methods (sent to control topic as ",
          `{action:"<name>", …}`,
          ")"
        ] }),
        /* @__PURE__ */ jsx("ul", { className: "space-y-0.5 font-mono text-[10px]", children: meta.methods.map((m) => {
          const tm = methodArgs(m.name);
          const props = tm?.args_schema?.properties ?? {};
          const required = tm?.args_schema?.required ?? [];
          const argList = Object.entries(props).map(([k, info]) => `${k}${required.includes(k) ? "" : "?"}: ${info?.type ?? "any"}`).join(", ");
          return /* @__PURE__ */ jsxs("li", { className: "flex items-baseline gap-2", children: [
            /* @__PURE__ */ jsx("span", { className: "text-emerald-300", children: m.name }),
            /* @__PURE__ */ jsxs("span", { className: "text-slate-500", children: [
              "(",
              argList,
              ")"
            ] }),
            m.doc && /* @__PURE__ */ jsxs("span", { className: "truncate text-slate-500", title: m.doc, children: [
              "— ",
              m.doc
            ] })
          ] }, m.name);
        }) })
      ] }),
      type && (type.config_schema || type.state_schema || type.topic_schemas && Object.keys(type.topic_schemas).length > 0) && /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            onClick: () => setShowSchemas((v) => !v),
            onPointerDown: (e) => e.stopPropagation(),
            className: "nodrag nopan flex items-baseline gap-2 text-left text-[9px] uppercase tracking-wider text-slate-500 hover:text-slate-300",
            children: [
              /* @__PURE__ */ jsx("span", { children: "type schema" }),
              /* @__PURE__ */ jsxs("span", { className: "font-mono normal-case text-slate-600", children: [
                "@ ",
                typeTopic
              ] }),
              /* @__PURE__ */ jsx("span", { children: showSchemas ? "▾" : "▸" })
            ]
          }
        ),
        showSchemas && /* @__PURE__ */ jsxs("div", { className: "mt-1 space-y-1.5", children: [
          type.config_schema && /* @__PURE__ */ jsx(SchemaBlock, { label: "config_schema", schema: type.config_schema }),
          type.state_schema && /* @__PURE__ */ jsx(SchemaBlock, { label: "state_schema", schema: type.state_schema }),
          type.topic_schemas && Object.entries(type.topic_schemas).map(([k, v]) => /* @__PURE__ */ jsx(SchemaBlock, { label: `topic_schemas.${k}`, schema: v }, k))
        ] })
      ] }),
      type && !type.schemas_complete && /* @__PURE__ */ jsxs("div", { className: "font-mono text-[9px] text-amber-400", title: type.notes ?? "", children: [
        "schemas incomplete — ",
        type.notes ?? "subprocess type; subscribe to instance topics for live schemas"
      ] })
    ] })
  ] });
}
function SchemaBlock({ label, schema }) {
  const [raw, setRaw] = useState(false);
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  return /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-950 p-1.5", children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        onClick: () => setRaw((v) => !v),
        onPointerDown: (e) => e.stopPropagation(),
        className: "nodrag nopan flex items-baseline gap-2 text-[9px] text-slate-400 hover:text-slate-200",
        children: [
          /* @__PURE__ */ jsx("span", { className: "font-mono text-sky-400", children: label }),
          /* @__PURE__ */ jsxs("span", { className: "text-slate-600", children: [
            "— click to ",
            raw ? "collapse" : "view raw JSON"
          ] })
        ]
      }
    ),
    raw ? /* @__PURE__ */ jsx("pre", { className: "mt-1 max-h-64 overflow-auto rounded bg-black p-1.5 font-mono text-[9px] text-slate-300", children: JSON.stringify(schema, null, 2) }) : /* @__PURE__ */ jsx("dl", { className: "mt-1 grid grid-cols-[auto_auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px]", children: Object.entries(properties).map(([k, info]) => /* @__PURE__ */ jsxs("div", { className: "contents", children: [
      /* @__PURE__ */ jsxs("dt", { className: "text-slate-300", children: [
        k,
        required.includes(k) && /* @__PURE__ */ jsx("span", { className: "text-rose-400", children: "*" })
      ] }),
      /* @__PURE__ */ jsx("dd", { className: "text-amber-300", children: info?.type ?? "any" }),
      /* @__PURE__ */ jsx("dd", { className: "truncate text-slate-500", title: info?.description ?? "", children: info?.description ?? "" })
    ] }, k)) })
  ] });
}
function PickOverlay({
  picking,
  rectDraft,
  mjpegImgRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onClear,
  onDone
}) {
  const points = picking.type === "points" ? picking.value ?? [] : picking.type === "point" && Array.isArray(picking.value) && picking.value.length >= 2 ? [picking.value] : [];
  const committedRect = picking.type === "rect" && Array.isArray(picking.value) && picking.value.length >= 4 && picking.value[2] > 0 && picking.value[3] > 0 ? picking.value : null;
  const img = mjpegImgRef.current;
  const scaleX = img && img.naturalWidth ? img.clientWidth / img.naturalWidth : 1;
  const scaleY = img && img.naturalHeight ? img.clientHeight / img.naturalHeight : 1;
  const renderRect = (r, color, dashed) => {
    let [x, y, w, h] = r;
    if (w < 0) {
      x = x + w;
      w = -w;
    }
    if (h < 0) {
      y = y + h;
      h = -h;
    }
    return /* @__PURE__ */ jsx(
      "div",
      {
        className: "pointer-events-none absolute",
        style: {
          left: x * scaleX,
          top: y * scaleY,
          width: w * scaleX,
          height: h * scaleY,
          border: `2px ${dashed ? "dashed" : "solid"} ${color}`,
          background: `${color}15`
        },
        children: /* @__PURE__ */ jsxs(
          "div",
          {
            className: "absolute -top-5 left-0 rounded bg-slate-900/80 px-1.5 py-0.5 font-mono text-[10px]",
            style: { color },
            children: [
              Math.round(w),
              "×",
              Math.round(h)
            ]
          }
        )
      }
    );
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      onPointerDown: (e) => e.stopPropagation(),
      className: "absolute inset-0 z-10 cursor-crosshair",
      style: { background: "rgba(255, 200, 0, 0.05)" },
      children: [
        points.map(([x, y], i) => /* @__PURE__ */ jsxs(
          "div",
          {
            className: "pointer-events-none absolute",
            style: {
              left: x * scaleX,
              top: y * scaleY,
              transform: "translate(-50%, -50%)",
              width: 14,
              height: 14
            },
            children: [
              /* @__PURE__ */ jsx("div", { className: "h-full w-full rounded-full border-2 border-amber-300" }),
              /* @__PURE__ */ jsx("div", { className: "absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-amber-300/60" }),
              /* @__PURE__ */ jsx("div", { className: "absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-amber-300/60" })
            ]
          },
          i
        )),
        committedRect && renderRect(committedRect, "#fbbf24", false),
        rectDraft && renderRect(rectDraft, "#22d3ee", true),
        /* @__PURE__ */ jsxs(
          "div",
          {
            onMouseDown: (e) => e.stopPropagation(),
            onMouseUp: (e) => e.stopPropagation(),
            className: "absolute right-2 top-2 flex items-center gap-1 rounded border border-amber-700 bg-slate-900/90 px-2 py-1 text-[10px] text-amber-200 shadow",
            children: [
              /* @__PURE__ */ jsx("span", { className: "font-mono", children: picking.type === "points" ? `${points.length} picked — click to add` : picking.type === "rect" ? committedRect ? `rect ${committedRect[2]}×${committedRect[3]} — drag to redraw` : "drag to draw rectangle" : "click to set" }),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  onClick: onClear,
                  className: "rounded px-1.5 py-0.5 hover:bg-slate-800",
                  children: "clear"
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  onClick: onDone,
                  className: "rounded bg-emerald-700 px-1.5 py-0.5 text-white hover:bg-emerald-600",
                  children: "done"
                }
              )
            ]
          }
        )
      ]
    }
  );
}
export {
  VideoFullView as default
};
