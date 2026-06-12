import { ChangeEvent, DragEvent, FormEvent, useMemo, useState } from "react";

type SolveSettings = {
  baseUrl: string;
  apiKey: string;
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

type RouteTableRow = {
  routeSort: number;
  routeKey: string;
  routeId: string;
  legs: number;
  stops: number;
  distance: string;
  driveHours: string;
  workHours: string;
  cost: string;
  violations: string;
};

type StopTableRow = {
  routeSort: number;
  legSort: number;
  sequenceSort: number;
  routeKey: string;
  routeId: string;
  leg: string;
  sequence: string;
  stopKey: string;
  orders: string;
  arrival: string;
  departure: string;
  distance: string;
  duration: string;
  wait: string;
  violations: string;
};

type UnloadedStopTableRow = {
  stopKey: string;
  orders: string;
};

type SolutionTableData = {
  routes: RouteTableRow[];
  stops: StopTableRow[];
  unloadedStops: UnloadedStopTableRow[];
};

const SOLVE_API = {
  title: "Multi-Vehicle Routing API",
  server: "https://services.appian.trimblemaps.com",
  path: "/routingoptimization/v2/solve",
  method: "POST",
  operationId: "Solve",
  auth: "Authorization header",
  acceptedResponse: "200 OK returns a Solution for the result tables",
  description:
    "Upload a prepared Solve request JSON file, review or edit the body, and send it to the Solve endpoint. A 200 OK response should include the route and stop information used to populate the result tables.",
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown) => (isRecord(value) ? value : null);

const hasSolutionFields = (value: unknown) => {
  const record = asRecord(value);
  return Boolean(
    record && (Array.isArray(record.routes) || Array.isArray(record.unloadedStops)),
  );
};

const findSolutionRecord = (body: unknown) => {
  const queue = [body];
  const visited = new Set<unknown>();
  const wrapperKeys = [
    "solution",
    "response",
    "result",
    "data",
    "body",
    "value",
    "payload",
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    const record = asRecord(current);

    if (!record || visited.has(record)) {
      continue;
    }

    if (hasSolutionFields(record)) {
      return record;
    }

    visited.add(record);
    wrapperKeys.forEach((key) => {
      if (isRecord(record[key])) {
        queue.push(record[key]);
      }
    });
  }

  return null;
};

const parseResponseBody = async (response: Response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const sleep = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const getPollingUrl = (body: unknown, baseUrl: string) => {
  const record = asRecord(body);
  const payload = asRecord(record?.payload);
  const resourceUrl =
    record?.resourceUrl ??
    record?.url ??
    record?.href ??
    payload?.resourceUrl ??
    payload?.url ??
    payload?.href;

  if (typeof resourceUrl !== "string" || !resourceUrl) {
    return null;
  }

  return new URL(resourceUrl, baseUrl).toString();
};

const pollForSolution = async (
  pollingUrl: string,
  apiKey: string,
  startedAt: number,
): Promise<ApiResult> => {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    await sleep(attempt === 1 ? 1000 : 3000);

    const response = await fetch(pollingUrl, {
      headers: apiKey ? { Authorization: apiKey } : {},
    });
    const body = await parseResponseBody(response);

    if (response.status === 200 && findSolutionRecord(body)) {
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Math.round(performance.now() - startedAt),
        body,
      };
    }

    const bodyStatus = asRecord(body)?.status;
    if (
      response.status >= 400 ||
      bodyStatus === "Failed" ||
      bodyStatus === "Cancelled"
    ) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Math.round(performance.now() - startedAt),
        body,
      };
    }
  }

  throw new Error("Timed out waiting for the 200 OK Solve solution response.");
};

const readNumber = (record: Record<string, unknown> | null, key: string) => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const formatCell = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
};

const formatDateTime = (value: unknown) => {
  if (typeof value !== "string" || !value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const joinList = (values: string[]) => (values.length > 0 ? values.join(", ") : "-");

const collectOrders = (orders: unknown) => {
  if (!Array.isArray(orders)) {
    return "-";
  }

  return joinList(
    orders.map((order) => {
      const record = asRecord(order);
      return formatCell(record?.id ?? record?.orderId ?? record?.key);
    }),
  );
};

const collectViolations = (violations: unknown) => {
  if (!Array.isArray(violations)) {
    return "-";
  }

  return joinList(
    violations.map((violation) => {
      const record = asRecord(violation);
      return formatCell(record?.name ?? violation);
    }),
  );
};

const countStops = (route: Record<string, unknown>) => {
  const legs = Array.isArray(route.legs) ? route.legs : [];
  const legStops = legs.reduce((count, leg) => {
    const legRecord = asRecord(leg);
    return count + (Array.isArray(legRecord?.stops) ? legRecord.stops.length : 0);
  }, 0);

  if (legStops > 0) {
    return legStops;
  }

  return Array.isArray(route.stops) ? route.stops.length : 0;
};

const toSortNumber = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const exact = Number(value);
    if (Number.isFinite(exact)) {
      return exact;
    }

    const match = value.match(/\d+/);
    if (match) {
      return Number(match[0]);
    }
  }

  return fallback;
};

const compareRouteRows = (left: RouteTableRow, right: RouteTableRow) =>
  left.routeSort - right.routeSort ||
  left.routeId.localeCompare(right.routeId) ||
  left.routeKey.localeCompare(right.routeKey);

const compareStopRows = (left: StopTableRow, right: StopTableRow) =>
  left.routeSort - right.routeSort ||
  left.legSort - right.legSort ||
  left.sequenceSort - right.sequenceSort ||
  left.stopKey.localeCompare(right.stopKey);

const buildSolutionTables = (body: unknown): SolutionTableData | null => {
  const solution = findSolutionRecord(body);
  const routes = Array.isArray(solution?.routes) ? solution.routes : null;
  const unloadedStops = Array.isArray(solution?.unloadedStops)
    ? solution.unloadedStops
    : null;

  if (!routes && !unloadedStops) {
    return null;
  }

  const routeRows =
    routes?.map((route, routeIndex) => {
      const routeRecord = asRecord(route) ?? {};
      const plan = asRecord(routeRecord.plan);
      const statistics = asRecord(plan?.statistics);
      const costs = asRecord(statistics?.costs);
      const legs = Array.isArray(routeRecord.legs) ? routeRecord.legs : [];
      const routeSort = toSortNumber(
        routeRecord.routeId,
        toSortNumber(routeRecord.key ?? routeRecord.internalKey, routeIndex),
      );

      return {
        routeSort,
        routeKey: formatCell(routeRecord.key ?? routeRecord.internalKey),
        routeId: formatCell(routeRecord.routeId),
        legs: legs.length,
        stops: countStops(routeRecord),
        distance: formatCell(readNumber(statistics, "distance")),
        driveHours: formatCell(readNumber(statistics, "driveHours")),
        workHours: formatCell(readNumber(statistics, "workHours")),
        cost: formatCell(readNumber(costs, "total")),
        violations: collectViolations(plan?.violations),
      };
    }).sort(compareRouteRows) ?? [];

  const stopRows =
    routes?.flatMap((route, routeIndex) => {
      const routeRecord = asRecord(route) ?? {};
      const routeKey = formatCell(routeRecord.key ?? routeRecord.internalKey);
      const routeId = formatCell(routeRecord.routeId);
      const routeSort = toSortNumber(
        routeRecord.routeId,
        toSortNumber(routeRecord.key ?? routeRecord.internalKey, routeIndex),
      );
      const legs = Array.isArray(routeRecord.legs) ? routeRecord.legs : [];
      const routeStops = Array.isArray(routeRecord.stops) ? routeRecord.stops : [];
      const stopGroups =
        legs.length > 0
          ? legs.map((leg) => {
              const legRecord = asRecord(leg) ?? {};
              return {
                leg: formatCell(legRecord.leg),
                stops: Array.isArray(legRecord.stops) ? legRecord.stops : [],
              };
            })
          : [{ leg: "-", stops: routeStops }];

      return stopGroups.flatMap((group) =>
        group.stops.map((stop) => {
          const stopRecord = asRecord(stop) ?? {};
          const plan = asRecord(stopRecord.plan);
          const legValue = stopRecord.leg ?? group.leg;
          const sequenceValue = stopRecord.sequence;

          return {
            routeSort,
            legSort: toSortNumber(legValue, 0),
            sequenceSort: toSortNumber(sequenceValue, 0),
            routeKey,
            routeId,
            leg: formatCell(legValue),
            sequence: formatCell(sequenceValue),
            stopKey: formatCell(stopRecord.key ?? stopRecord.internalKey),
            orders: collectOrders(stopRecord.orders),
            arrival: formatDateTime(plan?.arrival),
            departure: formatDateTime(plan?.departure),
            distance: formatCell(readNumber(plan, "distance")),
            duration: formatCell(readNumber(plan, "duration")),
            wait: formatCell(readNumber(plan, "wait")),
            violations: collectViolations(plan?.violations),
          };
        }),
      );
    }).sort(compareStopRows) ?? [];

  const unloadedStopRows =
    unloadedStops?.map((stop) => {
      const stopRecord = asRecord(stop) ?? {};

      return {
        stopKey: formatCell(stopRecord.internalKey ?? stopRecord.key),
        orders: collectOrders(stopRecord.orders),
      };
    }) ?? [];

  return {
    routes: routeRows,
    stops: stopRows,
    unloadedStops: unloadedStopRows,
  };
};

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
    apiKey: "",
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
          ...(settings.apiKey
            ? { Authorization: settings.apiKey }
            : {}),
        },
        body: JSON.stringify(requestBody),
      });

      const body = await parseResponseBody(response);
      const pollingUrl =
        response.status === 202 ? getPollingUrl(body, settings.baseUrl) : null;

      if (pollingUrl) {
        setResult(
          await pollForSolution(pollingUrl, settings.apiKey, startedAt),
        );
        return;
      }

      setResult({
        ok: response.status === 200,
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
                API key
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder="Value sent as the Authorization header"
                />
              </label>
            </div>
            <p className="endpoint-preview">
              Request URL: <code>{endpointUrl}</code>
              <br />
              Header: <code>Authorization: &lt;entered API key&gt;</code>
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
          A 200 OK Solve response should render the returned routes, route stops,
          and unloaded stops in tables.
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
      {result.status === 200 ? (
        <>
          <ResponseSummary body={result.body} />
          <SolutionTables body={result.body} />
        </>
      ) : (
        <p className="error-text">
          The Solve result tables require a 200 OK response containing the
          solution JSON.
        </p>
      )}
      <pre className="response-body">{stringify(result.body)}</pre>
    </section>
  );
}

function ResponseSummary({ body }: { body: unknown }) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const solution = findSolutionRecord(body);
  const routes = Array.isArray(solution?.routes) ? solution.routes : null;
  const unloadedStops = Array.isArray(solution?.unloadedStops)
    ? solution.unloadedStops
    : null;

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

function SolutionTables({ body }: { body: unknown }) {
  const tables = buildSolutionTables(body);

  if (!tables) {
    return (
      <div className="notice">
        The 200 OK response was received, but no routes or unloaded stops were
        found in the response JSON.
      </div>
    );
  }

  return (
    <div className="solution-tables">
      <DataTable
        emptyMessage="No routes were returned."
        title="Routes"
        columns={[
          "Route key",
          "Route ID",
          "Legs",
          "Stops",
          "Distance",
          "Drive hours",
          "Work hours",
          "Total cost",
          "Violations",
        ]}
        rows={tables.routes.map((route) => [
          route.routeKey,
          route.routeId,
          route.legs,
          route.stops,
          route.distance,
          route.driveHours,
          route.workHours,
          route.cost,
          route.violations,
        ])}
      />

      <DataTable
        emptyMessage="No routed stops were returned."
        title="Stops on routes"
        columns={[
          "Route",
          "Leg",
          "Sequence",
          "Stop key",
          "Orders",
          "Arrival",
          "Departure",
          "Distance",
          "Duration",
          "Wait",
          "Violations",
        ]}
        rows={tables.stops.map((stop) => [
          stop.routeId !== "-" ? stop.routeId : stop.routeKey,
          stop.leg,
          stop.sequence,
          stop.stopKey,
          stop.orders,
          stop.arrival,
          stop.departure,
          stop.distance,
          stop.duration,
          stop.wait,
          stop.violations,
        ])}
      />

      <DataTable
        emptyMessage="No unloaded stops were returned."
        title="Unloaded stops"
        columns={["Stop key", "Orders"]}
        rows={tables.unloadedStops.map((stop) => [stop.stopKey, stop.orders])}
      />
    </div>
  );
}

function DataTable({
  title,
  columns,
  rows,
  emptyMessage,
}: {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  emptyMessage: string;
}) {
  return (
    <section className="table-card">
      <div className="table-card-heading">
        <h3>{title}</h3>
        <span>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty-table">{emptyMessage}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${title}-${rowIndex}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default App;
