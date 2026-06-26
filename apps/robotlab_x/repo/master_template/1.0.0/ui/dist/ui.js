import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { useWsClient, Panel } from "@rlx/ui";
function MasterTemplateView({ proxy }) {
  const proxyId = proxy.id ?? proxy.name ?? "";
  const type = (proxy.service_meta_id ?? "master_template@1.0.0").split("@")[0];
  const ws = useWsClient();
  const [state, setState] = useState({});
  useEffect(() => {
    if (!proxyId) return;
    const off = ws.subscribe(`/${type}/${proxyId}/state`, (f) => {
      if (f.method === "message" && f.payload && typeof f.payload === "object") {
        setState(f.payload);
      }
    });
    return off;
  }, [ws, type, proxyId]);
  const sendAction = (action, args = {}) => {
    ws.publish(`/${type}/${proxyId}/control`, { action, ...args });
  };
  return /* @__PURE__ */ jsxs(Panel, { title: `${type} — replace me`, children: [
    /* @__PURE__ */ jsxs("div", { className: "text-slate-400", children: [
      "proxy: ",
      proxyId
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "text-slate-400", children: [
      "message: ",
      state.message ?? "—"
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "text-slate-400", children: [
      "ticks: ",
      state.ticks ?? "—"
    ] }),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "nodrag nopan w-fit rounded bg-sky-600 px-2 py-1 text-white hover:bg-sky-500",
        onClick: () => sendAction("ping"),
        onPointerDown: (e) => e.stopPropagation(),
        children: "send an action"
      }
    )
  ] });
}
export {
  MasterTemplateView as default
};
