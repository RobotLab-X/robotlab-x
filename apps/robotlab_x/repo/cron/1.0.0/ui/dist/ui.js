import { jsxs, jsx } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useWsClient } from "@rlx/ui";
function CronFullView({ proxy }) {
  const wsClient = useWsClient();
  const proxyId = proxy.id ?? proxy.name ?? "";
  const stateTopic = `/cron/${proxyId}/state`;
  const firedTopic = `/cron/${proxyId}/fired`;
  const controlTopic = `/cron/${proxyId}/control`;
  const [state, setState] = useState({});
  const [recentFires, setRecentFires] = useState([]);
  useEffect(() => {
    if (!proxyId) return;
    const off1 = wsClient.subscribe(stateTopic, (f) => {
      if (f.method !== "message") return;
      setState(f.payload ?? {});
    });
    const off2 = wsClient.subscribe(firedTopic, (f) => {
      if (f.method !== "message") return;
      const p = f.payload;
      if (!p?.job_id) return;
      setRecentFires((prev) => prev.concat([p]).slice(-10));
    });
    return () => {
      off1();
      off2();
    };
  }, [proxyId, stateTopic, firedTopic, wsClient]);
  const send = useCallback(
    (action, args = {}) => {
      wsClient.publish(controlTopic, { action, ...args });
    },
    [controlTopic, wsClient]
  );
  const jobs = state.jobs ?? [];
  return /* @__PURE__ */ jsxs("div", { className: "flex min-w-[560px] flex-col gap-3 p-3 text-xs", children: [
    /* @__PURE__ */ jsx(AddJobForm, { onAdd: (args) => send("add_job", args) }),
    /* @__PURE__ */ jsx(
      JobTable,
      {
        jobs,
        onToggle: (j) => send(j.enabled ? "disable_job" : "enable_job", { id: j.id }),
        onRunNow: (j) => send("run_job_now", { id: j.id }),
        onRemove: (j) => send("remove_job", { id: j.id }),
        onUpdate: (id, patch) => send("update_job", { id, ...patch })
      }
    ),
    /* @__PURE__ */ jsx(RecentFires, { fires: recentFires, jobs })
  ] });
}
function AddJobForm({
  onAdd
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("*/5 * * * *");
  const [topic, setTopic] = useState("");
  const [payload, setPayload] = useState("{}");
  const [retained, setRetained] = useState(false);
  const [error, setError] = useState(null);
  const submit = useCallback((e) => {
    e?.preventDefault();
    if (!topic.trim().startsWith("/")) {
      setError("Topic must be an absolute path starting with /");
      return;
    }
    let parsed = null;
    if (payload.trim() !== "") {
      try {
        parsed = JSON.parse(payload);
      } catch {
        setError("Payload is not valid JSON");
        return;
      }
    }
    setError(null);
    onAdd({
      schedule: schedule.trim(),
      topic: topic.trim(),
      payload: parsed,
      name: name.trim(),
      retained
    });
    setName("");
    setTopic("");
    setPayload("{}");
    setOpen(false);
  }, [name, schedule, topic, payload, retained, onAdd]);
  return /* @__PURE__ */ jsxs(Section, { title: open ? "add job" : "add job ▸", children: [
    /* @__PURE__ */ jsx("div", { className: "-mt-1 mb-1", children: /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick: () => setOpen((o) => !o),
        className: "rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500",
        children: open ? "Cancel" : "+ New job"
      }
    ) }),
    open && /* @__PURE__ */ jsxs(
      "form",
      {
        onSubmit: submit,
        onPointerDown: (e) => e.stopPropagation(),
        className: "space-y-2",
        children: [
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsx(
              LabeledInput,
              {
                label: "name",
                value: name,
                onChange: setName,
                placeholder: "e.g. heartbeat",
                className: "flex-1"
              }
            ),
            /* @__PURE__ */ jsx(
              LabeledInput,
              {
                label: "schedule",
                value: schedule,
                onChange: setSchedule,
                placeholder: "*/5 * * * *",
                className: "flex-1",
                mono: true
              }
            )
          ] }),
          /* @__PURE__ */ jsx(
            LabeledInput,
            {
              label: "topic",
              value: topic,
              onChange: setTopic,
              placeholder: "/servo/servo-1/control",
              mono: true
            }
          ),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("div", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "payload (JSON)" }),
            /* @__PURE__ */ jsx(
              "textarea",
              {
                value: payload,
                onChange: (e) => setPayload(e.target.value),
                onPointerDown: (e) => e.stopPropagation(),
                rows: 3,
                className: "nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none"
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500", children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: retained,
                  onChange: (e) => setRetained(e.target.checked)
                }
              ),
              "retained"
            ] }),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "submit",
                className: "ml-auto rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-500",
                children: "Add"
              }
            )
          ] }),
          error && /* @__PURE__ */ jsx("div", { className: "rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[10px] text-rose-200", children: error }),
          /* @__PURE__ */ jsx(ScheduleHint, {})
        ]
      }
    )
  ] });
}
function ScheduleHint() {
  return /* @__PURE__ */ jsxs("div", { className: "rounded border border-slate-800 bg-slate-950/70 p-2 text-[10px] leading-tight text-slate-400", children: [
    /* @__PURE__ */ jsx("div", { className: "text-slate-300", children: "Cron 5-field syntax:" }),
    /* @__PURE__ */ jsxs("div", { className: "font-mono", children: [
      /* @__PURE__ */ jsx("span", { className: "text-emerald-300", children: "m" }),
      " ",
      /* @__PURE__ */ jsx("span", { className: "text-emerald-300", children: "h" }),
      " ",
      /* @__PURE__ */ jsx("span", { className: "text-emerald-300", children: "dom" }),
      " ",
      /* @__PURE__ */ jsx("span", { className: "text-emerald-300", children: "mon" }),
      " ",
      /* @__PURE__ */ jsx("span", { className: "text-emerald-300", children: "dow" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-1 grid grid-cols-[max-content_1fr] gap-x-2", children: [
      /* @__PURE__ */ jsx("span", { className: "font-mono text-slate-500", children: "*/5 * * * *" }),
      /* @__PURE__ */ jsx("span", { children: "every 5 min" }),
      /* @__PURE__ */ jsx("span", { className: "font-mono text-slate-500", children: "0 * * * *" }),
      /* @__PURE__ */ jsx("span", { children: "top of every hour" }),
      /* @__PURE__ */ jsx("span", { className: "font-mono text-slate-500", children: "0 9 * * 1-5" }),
      /* @__PURE__ */ jsx("span", { children: "9 AM on weekdays" }),
      /* @__PURE__ */ jsx("span", { className: "font-mono text-slate-500", children: "30 2 * * 0" }),
      /* @__PURE__ */ jsx("span", { children: "02:30 Sunday" })
    ] })
  ] });
}
function JobTable({
  jobs,
  onToggle,
  onRunNow,
  onRemove,
  onUpdate
}) {
  return /* @__PURE__ */ jsxs(Section, { title: `jobs (${jobs.length})`, children: [
    jobs.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-slate-500", children: "No jobs scheduled. Add one above — pair a cron expression with a topic + payload." }),
    jobs.length > 0 && /* @__PURE__ */ jsxs("table", { className: "w-full table-auto", children: [
      /* @__PURE__ */ jsx("thead", { className: "text-[10px] uppercase tracking-wider text-slate-500", children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "name" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "schedule" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "topic" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "last" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-left", children: "next" }),
        /* @__PURE__ */ jsx("th", { className: "py-1 text-right", children: "actions" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: jobs.map((j) => /* @__PURE__ */ jsx(
        JobRow,
        {
          job: j,
          onToggle: () => onToggle(j),
          onRunNow: () => onRunNow(j),
          onRemove: () => onRemove(j),
          onUpdate: (patch) => onUpdate(j.id, patch)
        },
        j.id
      )) })
    ] })
  ] });
}
function JobRow({
  job,
  onToggle,
  onRunNow,
  onRemove,
  onUpdate
}) {
  const [editing, setEditing] = useState(false);
  const [draftSchedule, setDraftSchedule] = useState(job.schedule);
  const [draftTopic, setDraftTopic] = useState(job.topic);
  const [draftPayload, setDraftPayload] = useState(
    typeof job.payload === "string" ? job.payload : JSON.stringify(job.payload ?? null)
  );
  const [editErr, setEditErr] = useState(null);
  useEffect(() => {
    if (editing) return;
    setDraftSchedule(job.schedule);
    setDraftTopic(job.topic);
    setDraftPayload(
      typeof job.payload === "string" ? job.payload : JSON.stringify(job.payload ?? null)
    );
  }, [editing, job.schedule, job.topic, job.payload]);
  const saveEdit = () => {
    let parsed = null;
    if (draftPayload.trim() !== "") {
      try {
        parsed = JSON.parse(draftPayload);
      } catch {
        setEditErr("Payload is not valid JSON");
        return;
      }
    }
    if (!draftTopic.startsWith("/")) {
      setEditErr("Topic must start with /");
      return;
    }
    setEditErr(null);
    onUpdate({ schedule: draftSchedule, topic: draftTopic, payload: parsed });
    setEditing(false);
  };
  if (editing) {
    return /* @__PURE__ */ jsx("tr", { className: "border-t border-slate-800 align-top", children: /* @__PURE__ */ jsx("td", { colSpan: 6, className: "px-1 py-2", children: /* @__PURE__ */ jsxs("div", { className: "space-y-1 rounded border border-slate-700 bg-slate-900/60 p-2", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsx(LabeledInput, { label: "schedule", value: draftSchedule, onChange: setDraftSchedule, mono: true, className: "flex-1" }),
        /* @__PURE__ */ jsx(LabeledInput, { label: "topic", value: draftTopic, onChange: setDraftTopic, mono: true, className: "flex-1" })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("div", { className: "mb-0.5 text-[10px] uppercase tracking-wider text-slate-500", children: "payload (JSON)" }),
        /* @__PURE__ */ jsx(
          "textarea",
          {
            value: draftPayload,
            onChange: (e) => setDraftPayload(e.target.value),
            onPointerDown: (e) => e.stopPropagation(),
            rows: 3,
            className: "nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-slate-500 focus:outline-none"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => setEditing(false),
            className: "rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:border-slate-500",
            children: "Cancel"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: saveEdit,
            className: "ml-auto rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-500",
            children: "Save"
          }
        )
      ] }),
      editErr && /* @__PURE__ */ jsx("div", { className: "rounded border border-rose-700 bg-rose-950/40 px-2 py-1 font-mono text-[10px] text-rose-200", children: editErr })
    ] }) }) });
  }
  return /* @__PURE__ */ jsxs("tr", { className: `border-t border-slate-800 align-top ${job.enabled ? "" : "opacity-50"}`, children: [
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2 font-mono text-slate-200", children: job.name || /* @__PURE__ */ jsx("span", { className: "text-slate-600", children: "—" }) }),
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2 font-mono text-slate-300", children: job.schedule }),
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2 font-mono text-slate-300", children: job.topic }),
    /* @__PURE__ */ jsxs("td", { className: "py-1 pr-2 text-slate-400", children: [
      formatRelative(job.last_run) || /* @__PURE__ */ jsx("span", { className: "text-slate-600", children: "never" }),
      job.last_error && /* @__PURE__ */ jsx("div", { className: "font-mono text-[10px] text-rose-400", children: job.last_error })
    ] }),
    /* @__PURE__ */ jsx("td", { className: "py-1 pr-2 text-slate-400", children: job.enabled ? formatRelative(job.next_run) || "—" : /* @__PURE__ */ jsx("span", { className: "text-slate-600", children: "disabled" }) }),
    /* @__PURE__ */ jsx("td", { className: "py-1 text-right", children: /* @__PURE__ */ jsxs("div", { className: "flex justify-end gap-1", onPointerDown: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsx(SmallButton, { onClick: onToggle, children: job.enabled ? "Disable" : "Enable" }),
      /* @__PURE__ */ jsx(SmallButton, { onClick: onRunNow, disabled: !job.enabled, children: "Run now" }),
      /* @__PURE__ */ jsx(SmallButton, { onClick: () => setEditing(true), children: "Edit" }),
      /* @__PURE__ */ jsx(SmallButton, { onClick: onRemove, tone: "danger", children: "×" })
    ] }) })
  ] });
}
function RecentFires({ fires, jobs }) {
  const jobNames = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j.name || j.id])), [jobs]);
  return /* @__PURE__ */ jsxs(Section, { title: `recent firings (${fires.length})`, children: [
    fires.length === 0 && /* @__PURE__ */ jsx("div", { className: "text-slate-500", children: "Nothing fired yet." }),
    fires.length > 0 && /* @__PURE__ */ jsx("ul", { className: "space-y-0.5 font-mono text-[11px] text-slate-300", children: fires.slice().reverse().map((f, i) => /* @__PURE__ */ jsxs("li", { children: [
      /* @__PURE__ */ jsx("span", { className: "text-slate-500", children: new Date(f.ts * 1e3).toLocaleTimeString() }),
      " ",
      /* @__PURE__ */ jsx("span", { className: "text-emerald-300", children: jobNames[f.job_id] ?? f.job_id }),
      " → ",
      /* @__PURE__ */ jsx("span", { children: f.topic })
    ] }, i)) })
  ] });
}
function formatRelative(epochSec) {
  if (epochSec === null) return "";
  const diffSec = epochSec - Date.now() / 1e3;
  if (Math.abs(diffSec) < 5) return "now";
  const sign = diffSec >= 0 ? "in " : "";
  const suffix = diffSec >= 0 ? "" : " ago";
  const abs = Math.abs(diffSec);
  if (abs < 60) return `${sign}${Math.round(abs)}s${suffix}`;
  if (abs < 3600) return `${sign}${Math.round(abs / 60)}m${suffix}`;
  if (abs < 86400) return `${sign}${Math.round(abs / 3600)}h${suffix}`;
  return `${sign}${Math.round(abs / 86400)}d${suffix}`;
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs("section", { className: "rounded border border-slate-800 bg-slate-900/40 p-3", children: [
    /* @__PURE__ */ jsx("h3", { className: "mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400", children: title }),
    children
  ] });
}
function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  className = ""
}) {
  return /* @__PURE__ */ jsxs("label", { className: `block ${className}`, children: [
    /* @__PURE__ */ jsx("span", { className: "mb-0.5 block text-[10px] uppercase tracking-wider text-slate-500", children: label }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "text",
        value,
        onChange: (e) => onChange(e.target.value),
        onPointerDown: (e) => e.stopPropagation(),
        placeholder,
        className: `nodrag nopan w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-slate-500 focus:outline-none ${mono ? "font-mono" : ""}`
      }
    )
  ] });
}
function SmallButton({
  children,
  onClick,
  disabled,
  tone = "normal"
}) {
  const cls = tone === "danger" ? "border border-rose-700 text-rose-300 hover:border-rose-500" : "border border-slate-700 text-slate-200 hover:border-slate-500";
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      onClick: (e) => {
        e.stopPropagation();
        onClick?.();
      },
      onPointerDown: (e) => e.stopPropagation(),
      disabled,
      className: `nodrag nopan rounded px-1.5 py-0.5 text-[11px] ${cls} disabled:cursor-not-allowed disabled:opacity-40`,
      children
    }
  );
}
export {
  CronFullView as default
};
