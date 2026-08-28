import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExecuteResponse, ModelInfo, OutputField, ProviderId, SourceRecord } from "../shared/contracts";
import { presets, type PresetId } from "./presets";
import { Landing, Wordmark } from "./Landing";
import { CellPals } from "./Illustrations";
import { selectRecordColumns } from "../shared/contracts";
import { downloadBlob, exportSpreadsheet, parseSpreadsheet, type SheetData } from "./spreadsheet";

type RunState = "idle" | "running" | "paused" | "done" | "failed" | "cancelled";

const providerLabels: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  compatible: "OpenAI-compatible"
};

function Icon({ name, size = 18 }: { name: "sheet" | "upload" | "play" | "pause" | "stop" | "download" | "eye" | "refresh" | "chevron" | "check" | "plus" | "trash" | "web"; size?: number }) {
  const paths: Record<string, ReactNode> = {
    sheet: <><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h4M8 12h8M8 16h8"/></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 15v5h14v-5"/></>,
    play: <path d="m9 6 9 6-9 6z"/>,
    pause: <><path d="M9 6v12M15 6v12"/></>,
    stop: <path d="M7 7h10v10H7z"/>,
    download: <><path d="M12 4v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/></>,
    eye: <><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M18.5 16a7 7 0 1 1 .5-8.5L20 12"/></>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    trash: <><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14"/></>,
    web: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean, readonly retryAfterMs?: number) {
    super(message);
  }
}

function waitForRetry(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export function App() {
  const [workspace, setWorkspace] = useState(window.location.hash === "#workspace" || window.location.hash === "#workspace-main");
  useEffect(() => {
    const navigate = () => setWorkspace(window.location.hash === "#workspace" || window.location.hash === "#workspace-main");
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  useEffect(() => {
    document.title = workspace ? "Your workspace · Rower" : "Rower · Give your rows a little more";
    if (workspace || !window.location.hash) window.scrollTo(0, 0);
    if (workspace) document.getElementById("workspace-title")?.focus();
  }, [workspace]);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [inputColumns, setInputColumns] = useState<string[]>([]);
  const [presetId, setPresetId] = useState<PresetId>("website");
  const initialPreset = presets[0];
  const [taskName, setTaskName] = useState(initialPreset.name);
  const [prompt, setPrompt] = useState(initialPreset.prompt);
  const [outputFields, setOutputFields] = useState<OutputField[]>(initialPreset.outputFields);
  const [web, setWeb] = useState(initialPreset.web);
  const [batchSize, setBatchSize] = useState(initialPreset.batchSize);
  const [provider, setProvider] = useState<ProviderId>("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [webStrength, setWebStrength] = useState<"low" | "medium" | "high">("medium");
  const [searchInfoOpen, setSearchInfoOpen] = useState(false);
  const [outputs, setOutputs] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [runState, setRunState] = useState<RunState>("idle");
  const [completed, setCompleted] = useState(0);
  const [runTotal, setRunTotal] = useState(0);
  const [activity, setActivity] = useState<string[]>(["Waiting for a spreadsheet."]);
  const [notice, setNotice] = useState<string | null>(null);
  const pauseRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const selectedModel = models.find((item) => item.id === model);
  const records = useMemo<SourceRecord[]>(() => sheet?.rows.map((values, index) => ({ id: `row-${index + 1}`, values })) ?? [], [sheet]);
  const taskSignature = useMemo(() => JSON.stringify({ provider, model, baseUrl: provider === "compatible" ? baseUrl : undefined, inputColumns, prompt, outputFields, web, webStrength }), [provider, model, baseUrl, inputColumns, prompt, outputFields, web, webStrength]);
  const previousTaskSignature = useRef(taskSignature);
  const previewRecords = records.slice(0, 12);
  const previewColumns = inputColumns.length ? inputColumns : (sheet?.headers ?? []).slice(0, 4);
  const outputFieldIssue = useMemo(() => {
    const names = outputFields.map((field) => field.name.trim());
    if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) return "Output names must start with a letter or underscore and contain only letters, numbers, or underscores.";
    if (new Set(names).size !== names.length) return "Output column names must be unique.";
    return null;
  }, [outputFields]);
  const knownWebMismatch = Boolean(web && selectedModel && !selectedModel.web);
  const canRun = Boolean(sheet && records.length && inputColumns.length && prompt.trim() && outputFields.length && !outputFieldIssue && apiKey.trim() && model.trim() && runState !== "running" && !loadingFile && !loadingModels && !(web && provider === "compatible") && !knownWebMismatch);
  const searchMultiplier = { low: 1, medium: 2, high: 3 }[webStrength];
  const searchCap = web && sheet && provider === "openrouter"
    ? sheet.rows.length * searchMultiplier * 0.005
    : web && sheet && provider === "anthropic" ? sheet.rows.length * searchMultiplier * 0.01 : null;

  useEffect(() => {
    if (previousTaskSignature.current === taskSignature) return;
    previousTaskSignature.current = taskSignature;
    if (!outputs.size && !errors.size) return;
    setOutputs(new Map());
    setErrors(new Map());
    setCompleted(0);
    setRunState("idle");
    setActivity((lines) => ["Task settings changed; previous results were cleared.", ...lines].slice(0, 8));
  }, [taskSignature, outputs.size, errors.size]);

  function log(message: string) {
    setActivity((lines) => [message, ...lines].slice(0, 8));
  }

  useEffect(() => {
    if (!outputs.size && runState !== "running") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [outputs.size, runState]);

  function loadSample() {
    void loadFile(new File(["company,country\nPatagonia,USA\nOatly,Sweden\nHeadspace,USA\nCanva,Australia\nDuolingo,USA\n"], "a-few-good-companies.csv", { type: "text/csv" }));
  }

  async function loadFile(nextFile: File, requestedSheet?: string) {
    if (runState === "running" || loadingFile || loadingModels) return;
    setLoadingFile(true);
    setNotice(null);
    try {
      const parsed = await parseSpreadsheet(nextFile, requestedSheet);
      setFile(nextFile);
      setSheet(parsed);
      setInputColumns(parsed.headers.slice(0, Math.min(presetId === "compare" ? 2 : 1, parsed.headers.length)));
      setOutputs(new Map());
      setErrors(new Map());
      setCompleted(0);
      setRunState("idle");
      setActivity([`Loaded ${parsed.fileName} · ${parsed.rows.length.toLocaleString()} records from ${parsed.sheetName}.`]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The spreadsheet could not be read.");
    } finally {
      setLoadingFile(false);
    }
  }

  function applyPreset(id: PresetId) {
    const preset = presets.find((item) => item.id === id)!;
    setPresetId(id);
    setTaskName(preset.name);
    setPrompt(preset.prompt);
    setOutputFields(preset.outputFields);
    setWeb(preset.web);
    setBatchSize(preset.batchSize);
    if (sheet) setInputColumns(sheet.headers.slice(0, Math.min(id === "compare" ? 2 : 1, sheet.headers.length)));
  }

  function toggleColumn(column: string) {
    setInputColumns((current) => current.includes(column) ? current.filter((item) => item !== column) : [...current, column]);
  }

  async function loadModels() {
    setLoadingModels(true);
    setNotice(null);
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey, baseUrl })
      });
      const value = await response.json() as { models?: ModelInfo[]; error?: string };
      if (!response.ok) throw new Error(value.error || "Could not load models.");
      const nextModels = value.models ?? [];
      setConnected(true);
      setModels(nextModels);
      setCustomModel(false);
      const preferred = provider === "openrouter"
        ? nextModels.find((item) => item.id.includes("deepseek-v4-flash")) ?? nextModels.find((item) => item.name.includes("· free"))
        : provider === "anthropic" ? nextModels.find((item) => item.id.includes("haiku"))
          : provider === "openai" ? nextModels.find((item) => item.id === "gpt-5.4-nano") ?? nextModels.find((item) => item.id.includes("luna"))
            : undefined;
      setModel(preferred?.id ?? nextModels[0]?.id ?? "");
      log(`Loaded ${nextModels.length} models from ${providerLabels[provider]}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load models.");
    } finally {
      setLoadingModels(false);
    }
  }

  async function executeRows(rows: SourceRecord[], signal: AbortSignal): Promise<ExecuteResponse> {
    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        provider,
        model,
        apiKey: apiKey.trim(),
        baseUrl: provider === "compatible" ? baseUrl : undefined,
        structuredOutput: selectedModel?.structuredOutput ?? false,
        webStrength,
        task: { name: taskName, prompt, inputColumns, outputFields, web },
        records: selectRecordColumns(rows, inputColumns)
      })
    });
    const value = await response.json().catch(() => ({})) as ExecuteResponse & { error?: string; retryable?: boolean; retryAfterMs?: number };
    if (!response.ok) throw new ApiRequestError(value.error || `The provider returned HTTP ${response.status}.`, response.status, Boolean(value.retryable), value.retryAfterMs);
    return value;
  }

  async function startRun(testOnly: boolean) {
    if (!canRun) return;
    if (web && selectedModel && !selectedModel.web) {
      setNotice("The selected model does not support web research.");
      return;
    }
    const pending = records.filter((record) => !outputs.has(record.id));
    const target = testOnly ? pending.slice(0, 3) : pending;
    if (!target.length) {
      setNotice("Every record already has a result.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    pauseRef.current = false;
    setRunState("running");
    setRunTotal(target.length);
    setCompleted(0);
    setNotice(null);
    setErrors((current) => {
      const next = new Map(current);
      target.forEach((record) => next.delete(record.id));
      return next;
    });
    log(`${testOnly ? "Testing" : "Running"} ${target.length.toLocaleString()} records in batches of ${batchSize}.`);

    let processed = 0;
    const processBatch = async (batch: SourceRecord[]): Promise<boolean> => {
      let lastError: unknown;
      const maxAttempts = web ? 2 : 3;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const result = await executeRows(batch, controller.signal);
          setOutputs((current) => {
            const next = new Map(current);
            result.results.forEach((row) => next.set(row.id, row.output));
            return next;
          });
          setErrors((current) => {
            const next = new Map(current);
            batch.forEach((row) => next.delete(row.id));
            return next;
          });
          processed += batch.length;
          setCompleted(processed);
          if (result.usage.webSearches !== undefined) log(`Provider reported ${result.usage.webSearches} web searches for the batch.`);
          return true;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          lastError = error;
          if (error instanceof ApiRequestError && error.retryable && attempt < maxAttempts - 1) {
            const delay = Math.min(60_000, Math.max(0, error.retryAfterMs ?? 750 * 2 ** attempt));
            log(`Provider is busy; retrying this batch in ${(delay / 1000).toFixed(1)}s.`);
            await waitForRetry(delay, controller.signal);
            continue;
          }
          break;
        }
      }

      const message = lastError instanceof Error ? lastError.message : "The batch failed.";
      setErrors((current) => {
        const next = new Map(current);
        batch.forEach((row) => next.set(row.id, message));
        return next;
      });
      log(`Batch failed: ${message}`);
      setNotice(`${message} The run stopped; no later batches were requested.`);
      return false;
    };

    let stoppedByFailure = false;
    for (let index = 0; index < target.length; index += batchSize) {
      if (controller.signal.aborted) break;
      if (pauseRef.current) {
        setRunState("paused");
        log(`Paused after ${processed.toLocaleString()} records.`);
        return;
      }
      const batch = target.slice(index, index + batchSize);
      log(`Processing records ${index + 1}–${index + batch.length}.`);
      try {
        if (!await processBatch(batch)) {
          stoppedByFailure = true;
          break;
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        const message = error instanceof Error ? error.message : "The batch failed.";
        setErrors((current) => {
          const next = new Map(current);
          batch.forEach((row) => next.set(row.id, message));
          return next;
        });
        log(`Batch failed: ${message}`);
        setNotice(`${message} The run stopped; no later batches were requested.`);
        stoppedByFailure = true;
        break;
      }
    }
    if (controller.signal.aborted) {
      setRunState("cancelled");
      log("Run cancelled. Completed results were kept.");
    } else if (stoppedByFailure) {
      setRunState("failed");
      log("Run stopped after the failed batch. Remaining records were not requested.");
    } else {
      setRunState("done");
      log(`${testOnly ? "Test" : "Run"} finished. Review the appended columns before export.`);
    }
  }

  function pauseRun() {
    pauseRef.current = true;
    log("Pause requested; the active batch will finish first.");
  }

  function cancelRun() {
    abortRef.current?.abort();
  }

  async function handleExport() {
    if (!sheet || !outputs.size) return;
    try {
      const result = await exportSpreadsheet(sheet, outputFields.map((field) => field.name), outputs);
      downloadBlob(result.blob, result.fileName);
      log(`Exported ${result.fileName}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed.");
    }
  }

  function updateField(index: number, patch: Partial<OutputField>) {
    setOutputFields((fields) => fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  }

  if (!workspace) return <Landing/>;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">Skip to workspace</a>
      <header className="topbar">
        <div className="workspace-brand"><a href="#" aria-label="Rower home"><Wordmark/></a><span className="workspace-label">Your workspace</span></div>
        <div className="privacy-note"><Icon name="sheet" size={15}/> No account needed</div>
      </header>

      <main className="workspace-main" id="workspace-main">
        <section className="intro"><div><h1 id="workspace-title" tabIndex={-1}>A little less on your plate.</h1><p>Bring a sheet, give it a job, and see what comes back.</p></div><div className="workspace-note"><span>↗</span><span>Start small. Test three rows before sending the whole crew.</span></div></section>

        {notice && <div className="notice" role="alert"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}

        <div className="workbench">
          <fieldset className="setup-column" disabled={runState === "running" || loadingFile || loadingModels}>
            <section className="panel file-panel">
              <div className="panel-heading"><div><span className="step">1</span><h2>Your spreadsheet</h2></div>{sheet && <span className="state-pill good"><Icon name="check" size={14}/> Ready</span>}</div>
              <label className={`dropzone ${loadingFile ? "loading" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const next = event.dataTransfer.files[0]; if (next) void loadFile(next); }}>
                <input aria-label="Upload spreadsheet" type="file" accept=".xlsx,.csv" onChange={(event) => { const next = event.target.files?.[0]; if (next) void loadFile(next); }}/>
                <div className="drop-icon"><Icon name="upload"/></div>
                <div><strong>{loadingFile ? "Reading spreadsheet…" : sheet ? sheet.fileName : "Choose or drop a spreadsheet"}</strong><span>{sheet ? `${sheet.rows.length.toLocaleString()} records · ${sheet.headers.length} columns` : ".xlsx or .csv"}</span></div>
              </label>
              {!sheet && <button className="sample-button" onClick={loadSample}>Or try a little sample sheet</button>}
              {sheet && sheet.sheetNames.length > 1 && <label className="field compact"><span>Sheet</span><span className="select-control"><select value={sheet.sheetName} onChange={(event) => file && void loadFile(file, event.target.value)}>{sheet.sheetNames.map((name) => <option key={name}>{name}</option>)}</select><Icon name="chevron" size={16}/></span></label>}
            </section>

            <section className="panel task-panel">
              <div className="panel-heading"><div><span className="step">2</span><h2>Give it a job</h2></div><span className={`state-pill ${web ? "web" : ""}`}>{web ? <><Icon name="web" size={14}/> Web</> : "Model only"}</span></div>
              <div className="preset-tabs" role="group" aria-label="Task templates">{presets.map((preset) => <button key={preset.id} aria-pressed={presetId === preset.id} className={presetId === preset.id ? "active" : ""} onClick={() => applyPreset(preset.id)}>{preset.label}</button>)}</div>
              <div className="field"><span id="input-columns-label">Columns to read</span><div aria-labelledby="input-columns-label" role="group" className="column-picker">{sheet?.headers.map((header) => <button type="button" key={header} className={inputColumns.includes(header) ? "selected" : ""} aria-pressed={inputColumns.includes(header)} onClick={() => toggleColumn(header)}>{inputColumns.includes(header) && <Icon name="check" size={13}/>} {header}</button>)}{!sheet && <span className="field-empty">Load a sheet to choose columns.</span>}</div></div>
              <label className="field"><span>Instruction</span><textarea rows={5} value={prompt} onChange={(event) => { setPrompt(event.target.value); setPresetId("custom"); }}/></label>
              <details className="output-editor"><summary>Output columns <span>{outputFields.length} columns · Edit <Icon name="chevron" size={13}/></span></summary>
              <div className="output-heading"><span>Append new columns</span><button className="text-button" disabled={outputFields.length >= 32} onClick={() => setOutputFields((fields) => { let number = fields.length + 1; while (fields.some((field) => field.name === `result_${number}`)) number++; return [...fields, { name: `result_${number}`, description: "", type: "string" }]; })}><Icon name="plus" size={15}/> Add column</button></div>
              <div className="output-fields">{outputFields.map((field, index) => <div className="output-field" key={index}>
                <input aria-label="Output column name" value={field.name} onChange={(event) => updateField(index, { name: event.target.value.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "") })}/>
                <span className="select-control"><select aria-label="Output type" value={field.type} onChange={(event) => updateField(index, { type: event.target.value as OutputField["type"] })}><option value="string">Text</option><option value="boolean">Yes / no</option><option value="number">Number</option></select><Icon name="chevron" size={14}/></span>
                <button className="icon-button" aria-label="Remove output column" disabled={outputFields.length === 1} onClick={() => setOutputFields((fields) => fields.filter((_, fieldIndex) => fieldIndex !== index))}><Icon name="trash" size={16}/></button>
                <input className="output-description" aria-label="Output column description" value={field.description} onChange={(event) => updateField(index, { description: event.target.value })} placeholder="What should this column contain?"/>
              </div>)}</div></details>
              <label className="mode-control"><input type="checkbox" checked={web} onChange={(event) => { setWeb(event.target.checked); setBatchSize((size) => Math.min(size, event.target.checked ? 10 : 25)); }}/> Search the web for this task</label>
              {outputFieldIssue && <p className="capability-warning">{outputFieldIssue}</p>}
            </section>

            <section className="panel provider-panel">
              <div className="panel-heading"><div><span className="step">3</span><h2>Your model & key</h2></div></div>
              <div className="provider-grid">
                <label className="field"><span>Provider</span><span className="select-control"><select aria-label="Provider" value={provider} onChange={(event) => { setProvider(event.target.value as ProviderId); setModels([]); setModel(""); setCustomModel(false); setConnected(false); setApiKey(""); setBaseUrl(""); }}><option value="openrouter">OpenRouter</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="compatible">OpenAI-compatible</option></select><Icon name="chevron" size={16}/></span></label>
                <label className="field"><span>Model</span>{customModel ? <input aria-label="Model ID" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Provider model ID"/> : <span className="select-control"><select aria-label="Model" value={model} onChange={(event) => { if (event.target.value === "__custom") { setCustomModel(true); setModel(""); } else setModel(event.target.value); }}><option value="">Load models first</option>{models.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="__custom">Custom model ID…</option></select><Icon name="chevron" size={16}/></span>}</label>
              </div>
              {provider === "compatible" && <label className="field"><span>API base URL</span><input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setConnected(false); }} placeholder="https://provider.example/v1"/></label>}
              <label className="field"><span className="label-row"><span>API key {connected && <small className="connected">Connected</small>}</span>{provider !== "compatible" && <a href={provider === "openrouter" ? "https://openrouter.ai/settings/keys" : provider === "anthropic" ? "https://platform.claude.com/settings/keys" : "https://platform.openai.com/api-keys"} target="_blank" rel="noreferrer">Get a key</a>}</span><span className="key-control"><input aria-label="API key" autoComplete="off" spellCheck={false} type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setConnected(false); }} placeholder={provider === "openrouter" ? "sk-or-v1-…" : provider === "anthropic" ? "sk-ant-…" : "Paste API key"}/><button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "Hide key" : "Show key"}><Icon name="eye"/></button></span></label>
              <button className="secondary-button load-models" onClick={() => void loadModels()} disabled={!apiKey || (provider === "compatible" && !baseUrl.trim()) || loadingModels}><Icon name="refresh" size={16}/>{loadingModels ? "Connecting…" : connected ? "Refresh models" : "Connect and load models"}</button>
              {web && provider !== "compatible" && <div className="field search-strength-field">
                <div className="field-label-with-info"><button className="info-button" type="button" aria-label="About web search strength" aria-expanded={searchInfoOpen} onClick={() => setSearchInfoOpen((value) => !value)}>(i)</button><span>Web search strength</span></div>
                <span className="select-control"><select aria-label="Web search strength" value={webStrength} onChange={(event) => setWebStrength(event.target.value as "low" | "medium" | "high")}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select><Icon name="chevron" size={16}/></span>
                {searchInfoOpen && <div className="search-strength-info" role="note"><p><strong>Low</strong> — quick lookups with less search detail.</p><p><strong>Medium</strong> — balanced cost and coverage.</p><p><strong>High</strong> — more search effort and detail for difficult rows.</p><small>Higher strength can increase search and model costs. Providers may use fewer searches than the maximum.</small></div>}
              </div>}
              {web && provider === "compatible" && <p className="capability-warning">OpenAI-compatible endpoints are model-only in this version. Choose OpenRouter, Anthropic, or OpenAI for web tasks.</p>}
              {knownWebMismatch && <p className="capability-warning">The selected model is not marked as supporting web research. Choose another model or switch this task to model-only.</p>}
              <p className="key-note">Your key stays in this tab’s memory. Selected cells and your key are sent through Rower to your chosen provider. Refreshing clears your key and results.</p>
            </section>
          </fieldset>

          <section className="panel run-panel">
            <div className="run-heading"><div><p className="eyebrow">Live preview</p><h2>{sheet ? sheet.fileName : "Your answers will land here"}</h2><span>{sheet ? `${sheet.rows.length.toLocaleString()} source records` : "Original columns + a little something extra."}</span></div>{sheet && <div className="record-count"><strong>{outputs.size}</strong><span>completed</span></div>}</div>
            {!sheet ? <div className="empty-preview"><CellPals/><h3>A blank slate, for now.</h3><p>Drop in your spreadsheet to see your rows here. We’ll add the answers in new columns.</p><button className="secondary-button" onClick={loadSample}>Try a sample sheet <Icon name="plus" size={14}/></button></div> : <div className="table-shell" tabIndex={0} role="region" aria-label="Spreadsheet preview">
              <table><thead><tr><th className="row-number">#</th>{previewColumns.map((header) => <th key={header}>{header}</th>)}{outputFields.map((field) => <th className="generated" key={field.name}><span>{field.name}</span></th>)}</tr></thead>
              <tbody>{previewRecords.length ? previewRecords.map((record, index) => <tr key={record.id}><td className="row-number">{index + 1}</td>{previewColumns.map((header) => <td key={header}>{formatCell(record.values[header])}</td>)}{outputFields.map((field) => <td className="generated" key={field.name}>{errors.has(record.id) ? <span className="cell-error">Error</span> : outputs.has(record.id) ? formatCell(outputs.get(record.id)?.[field.name]) : <span className="pending-cell">Pending</span>}</td>)}</tr>) : <tr><td colSpan={2 + outputFields.length} className="empty-table">Your selected source and output columns will appear here.</td></tr>}</tbody></table>
            </div>}
            {sheet && <div className="preview-footnote">Showing {previewRecords.length} of {records.length.toLocaleString()} rows · Only selected input columns are shown. Export keeps all original columns.</div>}

            <div className="preflight">
              <div><label htmlFor="batch-size">Rows per batch</label><input id="batch-size" type="number" min="1" max={web ? 10 : 25} disabled={runState === "running"} value={batchSize} onChange={(event) => { const max = web ? 10 : 25; setBatchSize(Math.min(max, Math.max(1, Number(event.target.value) || 1))); }}/></div>
              <div><span>Mode</span><strong>{web ? "Web research" : "Model only"}</strong></div>
              <div><span>Est. search / pass</span><strong>{!web ? "$0.00" : searchCap === null ? "Provider-priced" : `~${searchCap.toFixed(2)}`}</strong></div>
            </div>
            {runState !== "idle" && <div className="progress-wrap"><div className="progress-meta"><span>{runState === "running" ? "Running" : runState}</span><strong>{completed} / {runTotal}</strong></div><div className="progress"><span style={{ width: `${runTotal ? completed / runTotal * 100 : 0}%` }}/></div></div>}
            <div className="run-actions">
              {runState === "running" ? <><button className="primary-button" onClick={pauseRun}><Icon name="pause"/> Pause after batch</button><button className="secondary-button" onClick={cancelRun}><Icon name="stop"/> Cancel</button></> : <><button className="secondary-button" disabled={!canRun} onClick={() => void startRun(true)}><Icon name="play"/> Test 3 rows</button><button className="primary-button" disabled={!canRun} onClick={() => void startRun(false)}><Icon name="play"/> Run remaining rows</button></>}
              <button className="secondary-button export-button" disabled={!outputs.size || runState === "running"} onClick={() => void handleExport()}><Icon name="download"/> Export</button>
            </div>
            <p className="run-hint">{!sheet ? "Start by loading a sheet or trying the sample." : !apiKey.trim() ? "Add your provider key and choose a model to test your first rows." : !model.trim() ? "Load models or enter a custom model ID to get started." : "Provider charges apply. Export before closing this tab."}</p>
            <div className="activity" aria-live="polite"><div className="activity-title"><span>Activity</span><span>{errors.size ? `${errors.size} failed` : ""}</span></div>{activity.map((line, index) => <div className="activity-line" key={`${line}-${index}`}><time>{index === 0 ? "now" : ""}</time><p>{line}</p></div>)}</div>
          </section>
        </div>
      </main>
    </div>
  );
}
