import { ChangeEvent, DragEvent, FormEvent, useMemo, useState } from "react";

type SolveSettings = {
  baseUrl: string;
  bearerToken: string;
};

type ApiResult = {
  ok: boolean;
  status: number;
  statusText: string;
  elapsedMs: number;
  body: unknown;
};

type UploadedRequest = {
  fileName: string;
  size: number;
  loadedAt: string;
};

const SOLVE_API = {
  title: "Multi-Vehicle Routing API",
  server: "https://services.appian.trimblemaps.com",
  path: "/routingoptimization/v2/solve",
  method: "POST",
  operationId: "Solve",
  auth: "JWT bearer token",
  acceptedResponse: "202 Accepted returns { id, resourceUrl }",
  description:
    "Upload a prepared Solve request JSON file, review or edit the body, and send it to the asynchronous Solve endpoint.",
};

const createSamplePayload = () => ({
  notificationOptions: {
    subscriptions: [{ type: "poll" }],
  },
  request: {
    unloadedStops: [],
    availableRoutes: [],
    config: {
      solution: {
        dispatchDate: new Date().toISOString().slice(0, 10),
        distanceUnits: "miles",
      },
    },
  },
});

const stringify = (value: unknown) => JSON.stringify(value, null, 2);

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function App() {
  const [settings, setSettings] = useState<SolveSettings>({
    baseUrl: SOLVE_API.server,
    bearerToken: "",
  });
  const [payloadText, setPayloadText] = useState("");
  const [uploadedRequest, setUploadedRequest] = useState<UploadedRequest | null>(
    null,
  );
  const [copyLabel, setCopyLabel] = useState("Copy JSON");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payloadParseError = useMemo(() => {
    if (!payloadText.trim()) {
      return "Upload or paste a Solve request JSON body.";
    }

    try {
      JSON.parse(payloadText);
      return null;
    } catch (parseError) {
      return parseError instanceof Error ? parseError.message : "Invalid JSON";
    }
  }, [payloadText]);

  const requestSummary = useMemo(() => {
    if (payloadParseError) {
      return null;
    }

    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const request =
      payload.request && typeof payload.request === "object"
        ? (payload.request as Record<string, unknown>)
        : null;
    const unloadedStops = Array.isArray(request?.unloadedStops)
      ? request.unloadedStops.length
      : 0;
    const availableRoutes = Array.isArray(request?.availableRoutes)
      ? request.availableRoutes.length
      : 0;
    const existingRoutes = Array.isArray(request?.routes)
      ? request.routes.length
      : 0;
    const subscriptions =
      payload.notificationOptions &&
      typeof payload.notificationOptions === "object" &&
      Array.isArray(
        (payload.notificationOptions as Record<string, unknown>).subscriptions,
      )
        ? ((payload.notificationOptions as Record<string, unknown>)
            .subscriptions as unknown[]).length
        : 0;

    return {
      unloadedStops,
      availableRoutes,
      existingRoutes,
      subscriptions,
    };
  }, [payloadParseError, payloadText]);

  const endpointUrl = `${settings.baseUrl.replace(/\/$/, "")}${SOLVE_API.path}`;

  const loadRequestFile = async (file: File) => {
    setError(null);
    setResult(null);

    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      setError("Choose a .json file containing the Solve request body.");
      return;
    }

    try {
      const fileText = await file.text();
      const parsed = JSON.parse(fileText);

      setPayloadText(stringify(parsed));
      setUploadedRequest({
        fileName: file.name,
        size: file.size,
        loadedAt: new Date().toLocaleString(),
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? `Unable to load JSON: ${loadError.message}`
          : "Unable to load that JSON file.",
      );
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      void loadRequestFile(file);
    }

    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(false);

    const file = event.dataTransfer.files[0];
    if (file) {
      void loadRequestFile(file);
    }
  };

  const copyPayload = async () => {
    await navigator.clipboard.writeText(payloadText);
    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy JSON"), 1400);
  };

  const clearPayload = () => {
    setPayloadText("");
    setUploadedRequest(null);
    setResult(null);
    setError(null);
  };

  const loadSamplePayload = () => {
    setPayloadText(stringify(createSamplePayload()));
    setUploadedRequest({
      fileName: "sample-solve-request.json",
      size: new Blob([stringify(createSamplePayload())]).size,
      loadedAt: new Date().toLocaleString(),
    });
    setResult(null);
    setError(null);
  };

  const submitSolve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(payloadText);
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? `Fix the request JSON before sending: ${parseError.message}`
          : "Fix the request JSON before sending.",
      );
      return;
    }

    setIsSubmitting(true);
    const startedAt = performance.now();

    try {
      const response = await fetch(endpointUrl, {
        method: SOLVE_API.method,
        headers: {
          "Content-Type": "application/json",
          ...(settings.bearerToken
            ? { Authorization: `Bearer ${settings.bearerToken}` }
            : {}),
        },
        body: JSON.stringify(requestBody),
      });

      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      setResult({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Math.round(performance.now() - startedAt),
        body,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to send the Solve request.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">OpenAPI-driven starter</p>
          <h1>Solve API console</h1>
          <p className="hero-copy">{SOLVE_API.description}</p>
        </div>
        <div className="endpoint-card" aria-label="Solve endpoint details">
          <span>{SOLVE_API.method}</span>
          <code>{SOLVE_API.path}</code>
          <small>{SOLVE_API.acceptedResponse}</small>
        </div>
      </section>

      <form className="layout upload-layout" onSubmit={submitSolve}>
        <div className="panel-stack">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Connection</p>
                <h2>API target</h2>
              </div>
              <span className="badge">{SOLVE_API.auth}</span>
            </div>
            <div className="grid two">
              <label>
                Base URL
                <input
                  value={settings.baseUrl}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder={SOLVE_API.server}
                />
              </label>
              <label>
                Bearer token
                <input
                  type="password"
                  value={settings.bearerToken}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      bearerToken: event.target.value,
                    }))
                  }
                  placeholder="Paste JWT when you are ready to call the API"
                />
              </label>
            </div>
            <p className="endpoint-preview">
              Request URL: <code>{endpointUrl}</code>
            </p>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Solve request</p>
                <h2>Upload request JSON</h2>
              </div>
              <button className="secondary" type="button" onClick={loadSamplePayload}>
                Load sample
              </button>
            </div>
            <label
              className={isDragActive ? "upload-dropzone active" : "upload-dropzone"}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={handleDrop}
            >
              <input type="file" accept="application/json,.json" onChange={handleFileInput} />
              <span>Drop a Solve request JSON file here, or click to browse.</span>
              <small>
                The uploaded file should be the full request body for{" "}
                <code>{SOLVE_API.path}</code>, including any{" "}
                <code>notificationOptions</code> and <code>request</code> data you
                want to send.
              </small>
            </label>

            {uploadedRequest && (
              <div className="upload-details">
                <div>
                  <span>Loaded file</span>
                  <strong>{uploadedRequest.fileName}</strong>
                </div>
                <div>
                  <span>Size</span>
                  <strong>{formatBytes(uploadedRequest.size)}</strong>
                </div>
                <div>
                  <span>Loaded at</span>
                  <strong>{uploadedRequest.loadedAt}</strong>
                </div>
              </div>
            )}

            {requestSummary && (
              <div className="summary-grid request-summary">
                <div>
                  <span>Unloaded stops</span>
                  <strong>{requestSummary.unloadedStops}</strong>
                </div>
                <div>
                  <span>Available routes</span>
                  <strong>{requestSummary.availableRoutes}</strong>
                </div>
                <div>
                  <span>Existing routes</span>
                  <strong>{requestSummary.existingRoutes}</strong>
                </div>
                <div>
                  <span>Subscriptions</span>
                  <strong>{requestSummary.subscriptions}</strong>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Request body</p>
                <h2>Review and edit JSON</h2>
              </div>
              <div className="button-row">
                <button
                  className="ghost"
                  type="button"
                  onClick={copyPayload}
                  disabled={!payloadText}
                >
                  {copyLabel}
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={clearPayload}
                  disabled={!payloadText}
                >
                  Clear
                </button>
              </div>
            </div>
            <p className="hint">
              You can paste a request JSON body directly here if you do not want
              to use a file. The app sends this JSON exactly as shown.
            </p>
            <textarea
              className={payloadParseError ? "json-editor invalid" : "json-editor"}
              value={payloadText}
              onChange={(event) => {
                setPayloadText(event.target.value);
                setUploadedRequest(null);
              }}
              placeholder={stringify(createSamplePayload())}
              spellCheck={false}
              aria-label="Solve request JSON"
            />
            {payloadParseError && (
              <p className="error-text">JSON status: {payloadParseError}</p>
            )}
            <button
              className="primary"
              type="submit"
              disabled={isSubmitting || Boolean(payloadParseError)}
            >
              {isSubmitting ? "Sending Solve request..." : "Send uploaded Solve request"}
            </button>
          </section>
        </div>

        <aside className="sidecar">
          <section className="panel sticky-panel muted-panel">
            <p className="eyebrow">Expected shape</p>
            <h2>Uploaded JSON should match Solve</h2>
            <p className="hint">
              The OpenAPI definition describes the Solve body as an async request
              plus a problem payload.
            </p>
            <pre className="schema-snippet">
{`{
  "notificationOptions": {
    "subscriptions": [{ "type": "poll" }]
  },
  "request": {
    "unloadedStops": [],
    "availableRoutes": [],
    "routes": [],
    "config": {
      "solution": {
        "dispatchDate": "2026-06-11",
        "distanceUnits": "miles"
      }
    },
    "resourceSchedules": []
  }
}`}
            </pre>
          </section>

          <ResponsePanel error={error} result={result} />
        </aside>
      </form>
    </main>
  );
}

function ResponsePanel({
  error,
  result,
}: {
  error: string | null;
  result: ApiResult | null;
}) {
  if (!error && !result) {
    return (
      <section className="panel response-panel muted-panel">
        <p className="eyebrow">Response</p>
        <h2>Waiting for a request</h2>
        <p className="hint">
          A successful async Solve call should return a token and resource URL
          that can be polled for the eventual Solution.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel response-panel error-panel">
        <p className="eyebrow">Response error</p>
        <h2>Request failed</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (!result) {
    return null;
  }

  return (
    <section
      className={
        result.ok ? "panel response-panel" : "panel response-panel error-panel"
      }
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Response</p>
          <h2>
            {result.status} {result.statusText || (result.ok ? "OK" : "Error")}
          </h2>
        </div>
        <span className="badge">{result.elapsedMs} ms</span>
      </div>
      <ResponseSummary body={result.body} />
      <pre className="response-body">{stringify(result.body)}</pre>
    </section>
  );
}

function ResponseSummary({ body }: { body: unknown }) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const routes = Array.isArray(record.routes) ? record.routes : null;
  const unloadedStops = Array.isArray(record.unloadedStops)
    ? record.unloadedStops
    : null;

  if (typeof record.id === "string" || typeof record.resourceUrl === "string") {
    return (
      <div className="summary-grid">
        <div>
          <span>Operation ID</span>
          <strong>{String(record.id ?? "Not returned")}</strong>
        </div>
        <div>
          <span>Resource URL</span>
          <strong>{String(record.resourceUrl ?? "Not returned")}</strong>
        </div>
      </div>
    );
  }

  if (routes || unloadedStops) {
    return (
      <div className="summary-grid">
        <div>
          <span>Routes</span>
          <strong>{routes?.length ?? 0}</strong>
        </div>
        <div>
          <span>Unloaded stops</span>
          <strong>{unloadedStops?.length ?? 0}</strong>
        </div>
      </div>
    );
  }

  return null;
}

export default App;
