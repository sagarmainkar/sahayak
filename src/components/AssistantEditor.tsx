"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Assistant, ModelInfo, ToolPublic } from "@/lib/types";
import { ARCHETYPES } from "@/lib/archetypes";

const EMOJIS = ["✨", "🤖", "🧠", "🎯", "🧭", "📚", "💻", "🔬", "✍️", "🎨", "🚀", "🛠️", "🧪", "🗺️", "📝"];
const COLORS = [
  "#b05830", "#8b2e3c", "#6366f1", "#8b5cf6", "#ec4899",
  "#10b981", "#14b8a6", "#06b6d4", "#f59e0b", "#eab308",
];

const DEFAULTS: Partial<Assistant> = {
  name: "New Assistant",
  emoji: "✨",
  color: "#b05830",
  model: "",
  systemPrompt: "",
  enabledTools: [],
  thinkMode: "medium",
};

export function AssistantEditor({
  initial,
  assistantId,
}: {
  initial?: Assistant;
  assistantId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Partial<Assistant>>(initial ?? DEFAULTS);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tools, setTools] = useState<ToolPublic[]>([]);
  const [defaultPrompt, setDefaultPrompt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { models: ModelInfo[] }) => {
        setModels(d.models);
        setForm((f) => ({ ...f, model: f.model || d.models[0]?.name || "" }));
      });
    fetch("/api/tools")
      .then((r) => r.json())
      .then((d: { tools: ToolPublic[] }) => setTools(d.tools));
    fetch("/api/assistants/defaults")
      .then((r) => r.json())
      .then((d: { systemPrompt: string }) => setDefaultPrompt(d.systemPrompt));
  }, []);

  function loadArchetype(id: string) {
    const archetype = ARCHETYPES.find((a) => a.id === id);
    if (!archetype) return;
    const cur = (form.systemPrompt ?? "").trim();
    if (
      cur &&
      cur !== archetype.systemPrompt &&
      cur !== defaultPrompt
    ) {
      if (
        !confirm(
          `Replace the current system prompt with the "${archetype.name}" template?`,
        )
      )
        return;
    }
    setForm((f) => ({ ...f, systemPrompt: archetype.systemPrompt }));
  }

  async function save() {
    setSaving(true);
    try {
      const method = assistantId ? "PATCH" : "POST";
      const url = assistantId ? `/api/assistants/${assistantId}` : "/api/assistants";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (j.assistant) router.push("/");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!assistantId) return;
    if (!confirm("Delete this assistant?")) return;
    await fetch(`/api/assistants/${assistantId}`, { method: "DELETE" });
    router.push("/");
  }

  const grouped = tools.reduce<Record<string, ToolPublic[]>>((acc, t) => {
    (acc[t.group] ??= []).push(t);
    return acc;
  }, {});

  function toggleTool(name: string) {
    setForm((f) => {
      const cur = f.enabledTools ?? [];
      return {
        ...f,
        enabledTools: cur.includes(name)
          ? cur.filter((n) => n !== name)
          : [...cur, name],
      };
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <Link
            href="/"
            className="mb-2 inline-flex items-center gap-1 font-sans text-[11px] text-fg-subtle hover:text-fg"
          >
            <ArrowLeft className="h-3 w-3" />
            back
          </Link>
          <h1
            className="font-display text-[36px] italic leading-none text-fg"
            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
          >
            {assistantId ? "Edit" : "New"} assistant
          </h1>
        </div>
        <div className="flex gap-2">
          {assistantId && (
            <button
              onClick={del}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 font-sans text-[12px] text-red-500 hover:bg-bg-muted"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 font-sans text-[12px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="space-y-5">
        <Section title="Identity">
          <Field label="Name">
            <input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded border border-border bg-bg px-3 py-2 font-display text-[18px] italic text-fg focus:border-accent focus:outline-none"
              style={{ fontVariationSettings: '"opsz" 144' }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-5">
            <Field label="Emoji">
              <div className="flex flex-wrap gap-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setForm({ ...form, emoji: e })}
                    className={cn(
                      "h-9 w-9 rounded text-xl transition",
                      form.emoji === e
                        ? "ring-2 ring-accent"
                        : "border border-border hover:bg-bg-muted",
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Accent color">
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={cn(
                      "h-8 w-8 rounded-full border-2 transition",
                      form.color === c ? "border-fg" : "border-transparent",
                    )}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Model & reasoning">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Model">
              <select
                value={form.model ?? ""}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full rounded border border-border bg-bg px-3 py-2 font-mono text-[13px] focus:border-accent focus:outline-none"
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} — {m.params} {m.quant}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Thinking effort">
              <select
                value={form.thinkMode ?? "medium"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    thinkMode: e.target.value as Assistant["thinkMode"],
                  })
                }
                className="w-full rounded border border-border bg-bg px-3 py-2 font-mono text-[13px] focus:border-accent focus:outline-none"
              >
                <option value="off">off</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </Field>
          </div>
          <div className="mt-5">
            <ContextLengthField
              value={form.contextLength}
              baseDefault={
                models.find((m) => m.name === form.model)?.contextLength ??
                null
              }
              onChange={(n) =>
                setForm({
                  ...form,
                  contextLength: n ?? undefined,
                })
              }
            />
          </div>
        </Section>

        <Section
          title="System prompt"
          actions={
            <div className="flex items-center gap-2">
              <label
                htmlFor="archetype"
                className="font-sans text-[10.5px] text-fg-subtle"
              >
                template
              </label>
              <select
                id="archetype"
                onChange={(e) => loadArchetype(e.target.value)}
                value=""
                className="rounded border border-border bg-bg-paper px-2 py-1 font-sans text-[10.5px] text-fg-muted focus:border-accent focus:outline-none"
              >
                <option value="" disabled>
                  Load…
                </option>
                {ARCHETYPES.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <textarea
            value={form.systemPrompt ?? ""}
            onChange={(e) =>
              setForm({ ...form, systemPrompt: e.target.value })
            }
            rows={12}
            className="w-full resize-y rounded border border-border bg-bg p-3 font-serif text-[14px] leading-[1.6] focus:border-accent focus:outline-none"
            placeholder="Describe this assistant's role, style, and constraints…"
          />
          <p className="font-sans text-[10.5px] text-fg-subtle">
            Pick a template to fill the prompt, then edit freely.
            Artifact instructions are injected per-turn via the composer
            toggle, not stored here.
          </p>
        </Section>

        <Section
          title={`Tools · ${(form.enabledTools ?? []).length} enabled`}
        >
          <div className="space-y-4">
            {Object.entries(grouped).map(([group, list]) => (
              <div key={group}>
                <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.15em] text-fg-subtle">
                  {group}
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {list.map((t) => {
                    const on = (form.enabledTools ?? []).includes(t.name);
                    return (
                      <label
                        key={t.name}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded border p-2 text-[12px] transition",
                          on
                            ? "border-accent bg-accent/10"
                            : "border-border hover:bg-bg-muted",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleTool(t.name)}
                          className="mt-0.5 accent-accent"
                        />
                        <div>
                          <div className="font-mono text-fg">{t.name}</div>
                          <div className="mt-0.5 font-serif text-[11.5px] text-fg-muted">
                            {t.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-elev p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="byline">{title}</h2>
        {actions}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block font-sans text-[11px] uppercase tracking-[0.1em] text-fg-subtle">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Context-length override for the selected base model. Sahayak bakes
 * a derived Ollama model with this num_ctx at first use, so the user
 * just picks the number — no modelfile authoring required. Presets
 * cover the common lengths; custom accepts any positive integer.
 */
function ContextLengthField({
  value,
  baseDefault,
  onChange,
}: {
  value: number | undefined;
  baseDefault: number | null;
  onChange: (n: number | null) => void;
}) {
  const presets = [8192, 16384, 32768, 65536, 131072, 262144];
  const [custom, setCustom] = useState<string>(
    value && !presets.includes(value) ? String(value) : "",
  );
  const fmt = (n: number) =>
    n >= 1024 ? `${Math.round(n / 1024)}k` : `${n}`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label className="font-sans text-[11px] uppercase tracking-[0.1em] text-fg-subtle">
          Context length
        </label>
        <span className="font-serif text-[11.5px] italic text-fg-subtle">
          {baseDefault
            ? `base model reports ${fmt(baseDefault)} tokens`
            : "unknown base default"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <PresetChip
          active={value === undefined}
          label="default"
          onClick={() => {
            onChange(null);
            setCustom("");
          }}
        />
        {presets.map((n) => (
          <PresetChip
            key={n}
            active={value === n}
            label={fmt(n)}
            onClick={() => {
              onChange(n);
              setCustom("");
            }}
          />
        ))}
        <input
          type="number"
          min={1}
          step={1}
          placeholder="custom"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => {
            const n = parseInt(custom, 10);
            if (Number.isFinite(n) && n > 0) onChange(n);
            else setCustom("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          className="w-24 rounded border border-border bg-bg px-2 py-1 font-mono text-[12px] focus:border-accent focus:outline-none"
        />
      </div>
      <div className="mt-1.5 font-serif text-[11.5px] italic text-fg-muted">
        Overrides the model&apos;s <span className="font-mono not-italic">num_ctx</span>.
        Sahayak builds a derived Ollama model on first use — cached by Ollama
        afterwards, hidden from the picker. Bigger context = more RAM/VRAM.
      </div>
    </div>
  );
}

function PresetChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded border border-accent bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent"
          : "rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg-muted hover:border-border-strong hover:text-fg"
      }
    >
      {label}
    </button>
  );
}
