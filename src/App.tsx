import { FormEvent, useEffect, useMemo, useState } from "react";

type NotificationType = "poll" | "webhook" | "push";
type DistanceUnits = "miles" | "kilometers";

type StopForm = {
  internalKey: number;
  orderId: string;
  orderKey: number;
  lineItemId: string;
  lineItemKey: number;
  longitude: number;
  latitude: number;
  fixedTime: number;
  pieces: number;
  pounds: number;
  unloadRate: number;
  eqCode: string;
  windowOpen: string;
  windowClose: string;
  earliestDate: string;
  latestDate: string;
};

type RouteForm = {
  routeId: string;
  longitude: number;
  latitude: number;
  routeStartTime: string;
  driverHourlyCost: number;
  driverFixedCost: number;
  vehicleDistanceCost: number;
  vehicleFixedCost: number;
  capacityPieces: number;
  capacityPounds: number;
  maxWorkTime: number;
  workDay: number;
  oneWay: boolean;
  lateFinish: string;
};

type SolveSettings = {
  baseUrl: string;
  bearerToken: string;
  notificationType: NotificationType;
  webhookEndpoint: string;
  dispatchDate: string;
  distanceUnits: DistanceUnits;
  speedAdjustment: number;
  mileageAdjustment: number;
};

type ApiResult = {
  ok: boolean;
  status: number;
  statusText: string;
  elapsedMs: number;
  body: unknown;
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
    "Solve a full fleet routing problem asynchronously. The request combines notification options with a Problem made from unloaded stops, available routes, existing routes, config, and resource schedules.",
};

const weekDays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const makeDateInput = () => new Date().toISOString().slice(0, 10);

const makeDateTimeInput = (hoursFromNow = 0) => {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return date.toISOString().slice(0, 16);
};

const toNumber = (value: string) => (value === "" ? 0 : Number(value));

const toApiDateTime = (value: string) => {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

const compact = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(compact).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, compact(entry)] as const)
      .filter(([, entry]) => {
        if (entry === undefined || entry === null || entry === "") {
          return false;
        }

        if (Array.isArray(entry)) {
          return entry.length > 0;
        }

        if (typeof entry === "object") {
          return Object.keys(entry).length > 0;
        }

        return true;
      });

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  return value;
};

const buildTimeWindows = (open: string, close: string) => {
  if (!open && !close) {
    return undefined;
  }

  return Object.fromEntries(
    weekDays.map((day) => [
      day,
      {
        hours: [
          {
            open: open || "00:00",
            close: close || "24:00",
          },
        ],
      },
    ]),
  );
};

const createStop = (index: number): StopForm => ({
  internalKey: index,
  orderId: `ORDER-${index}`,
  orderKey: index,
  lineItemId: `ITEM-${index}`,
  lineItemKey: index,
  longitude: -75.1652 + index * 0.1,
  latitude: 39.9526 + index * 0.1,
  fixedTime: 20,
  pieces: 10,
  pounds: 120,
  unloadRate: 50,
  eqCode: "",
  windowOpen: "08:00",
  windowClose: "17:00",
  earliestDate: "",
  latestDate: "",
});

const createRoute = (index: number): RouteForm => ({
  routeId: `ROUTE-${index}`,
  longitude: -75.1652,
  latitude: 39.9526,
  routeStartTime: makeDateTimeInput(1),
  driverHourlyCost: 45,
  driverFixedCost: 0,
  vehicleDistanceCost: 1.5,
  vehicleFixedCost: 100,
  capacityPieces: 120,
  capacityPounds: 2600,
  maxWorkTime: 10,
  workDay: 8,
  oneWay: false,
  lateFinish: makeDateTimeInput(11),
});

const buildSolvePayload = (
  settings: SolveSettings,
  stops: StopForm[],
  routes: RouteForm[],
) => {
  const subscription =
    settings.notificationType === "webhook"
      ? {
          type: "webhook",
          endpoint: settings.webhookEndpoint,
        }
      : { type: settings.notificationType };

  return compact({
    notificationOptions: {
      subscriptions: [subscription],
    },
    request: {
      unloadedStops: stops.map((stop) =>
        compact({
          internalKey: stop.internalKey,
          coordinates: [stop.longitude, stop.latitude],
          orders: [
            compact({
              orderId: stop.orderId,
              internalKey: stop.orderKey,
              lineItems: [
                compact({
                  lineItemId: stop.lineItemId,
                  internalKey: stop.lineItemKey,
                  fixedTime: stop.fixedTime,
                  volumes: {
                    pieces: {
                      value: stop.pieces,
                      unloadRate: stop.unloadRate,
                    },
                    pounds: {
                      value: stop.pounds,
                      unloadRate: stop.unloadRate,
                    },
                  },
                }),
              ],
            }),
          ],
          config: compact({
            eqCode: stop.eqCode,
            earliestDate: stop.earliestDate,
            latestDate: stop.latestDate,
            timeWindows: buildTimeWindows(stop.windowOpen, stop.windowClose),
          }),
        }),
      ),
      availableRoutes: routes.map((route) =>
        compact({
          routeId: route.routeId,
          origin: [route.longitude, route.latitude],
          routeStartTime: toApiDateTime(route.routeStartTime),
          driverProperties: {
            costs: {
              hourly: route.driverHourlyCost,
              fixed: route.driverFixedCost,
            },
            workRules: {
              maxWorkTime: route.maxWorkTime,
              workDay: route.workDay,
            },
          },
          vehicleProperties: {
            costs: {
              distance: route.vehicleDistanceCost,
              fixed: route.vehicleFixedCost,
            },
            capacity: {
              pieces: route.capacityPieces,
              pounds: route.capacityPounds,
            },
          },
          routingProperties: {
            oneWay: route.oneWay,
            workRules: {
              times: {
                normalStart: toApiDateTime(route.routeStartTime),
                lateFinish: toApiDateTime(route.lateFinish),
              },
            },
          },
        }),
      ),
      config: {
        solution: {
          dispatchDate: settings.dispatchDate,
          distanceUnits: settings.distanceUnits,
        },
        adjustments: {
          speedAdjustment: settings.speedAdjustment,
          mileageAdjustment: settings.mileageAdjustment,
        },
      },
    },
  });
};

const stringify = (value: unknown) => JSON.stringify(value, null, 2);

function App() {
  const [settings, setSettings] = useState<SolveSettings>({
    baseUrl: SOLVE_API.server,
    bearerToken: "",
    notificationType: "poll",
    webhookEndpoint: "",
    dispatchDate: makeDateInput(),
    distanceUnits: "miles",
    speedAdjustment: 1,
    mileageAdjustment: 1,
  });
  const [stops, setStops] = useState<StopForm[]>([createStop(1), createStop(2)]);
  const [routes, setRoutes] = useState<RouteForm[]>([createRoute(1)]);
  const generatedPayload = useMemo(
    () => buildSolvePayload(settings, stops, routes),
    [settings, stops, routes],
  );
  const generatedPayloadText = useMemo(
    () => stringify(generatedPayload),
    [generatedPayload],
  );
  const [payloadText, setPayloadText] = useState(generatedPayloadText);
  const [payloadDirty, setPayloadDirty] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy JSON");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!payloadDirty) {
      setPayloadText(generatedPayloadText);
    }
  }, [generatedPayloadText, payloadDirty]);

  const payloadParseError = useMemo(() => {
    try {
      JSON.parse(payloadText);
      return null;
    } catch (parseError) {
      return parseError instanceof Error ? parseError.message : "Invalid JSON";
    }
  }, [payloadText]);

  const endpointUrl = `${settings.baseUrl.replace(/\/$/, "")}${SOLVE_API.path}`;

  const updateSetting = <Key extends keyof SolveSettings>(
    key: Key,
    value: SolveSettings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const updateStop = <Key extends keyof StopForm>(
    index: number,
    key: Key,
    value: StopForm[Key],
  ) => {
    setStops((current) =>
      current.map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, [key]: value } : stop,
      ),
    );
  };

  const updateRoute = <Key extends keyof RouteForm>(
    index: number,
    key: Key,
    value: RouteForm[Key],
  ) => {
    setRoutes((current) =>
      current.map((route, routeIndex) =>
        routeIndex === index ? { ...route, [key]: value } : route,
      ),
    );
  };

  const resetRawPayload = () => {
    setPayloadDirty(false);
    setPayloadText(generatedPayloadText);
  };

  const copyPayload = async () => {
    await navigator.clipboard.writeText(payloadText);
    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy JSON"), 1400);
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

      <form className="layout" onSubmit={submitSolve}>
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
                    updateSetting("baseUrl", event.target.value)
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
                    updateSetting("bearerToken", event.target.value)
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
                <p className="eyebrow">AsyncRequest</p>
                <h2>Notification options</h2>
              </div>
            </div>
            <div className="grid two">
              <label>
                Subscription type
                <select
                  value={settings.notificationType}
                  onChange={(event) =>
                    updateSetting(
                      "notificationType",
                      event.target.value as NotificationType,
                    )
                  }
                >
                  <option value="poll">poll</option>
                  <option value="webhook">webhook</option>
                  <option value="push">push</option>
                </select>
              </label>
              <label>
                Webhook endpoint
                <input
                  value={settings.webhookEndpoint}
                  onChange={(event) =>
                    updateSetting("webhookEndpoint", event.target.value)
                  }
                  placeholder="https://example.com/solve-callback"
                  disabled={settings.notificationType !== "webhook"}
                />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Problem.config</p>
                <h2>Solution settings</h2>
              </div>
              <span className="badge">dispatchDate required</span>
            </div>
            <div className="grid four">
              <label>
                Dispatch date
                <input
                  type="date"
                  value={settings.dispatchDate}
                  onChange={(event) =>
                    updateSetting("dispatchDate", event.target.value)
                  }
                  required
                />
              </label>
              <label>
                Distance units
                <select
                  value={settings.distanceUnits}
                  onChange={(event) =>
                    updateSetting(
                      "distanceUnits",
                      event.target.value as DistanceUnits,
                    )
                  }
                >
                  <option value="miles">miles</option>
                  <option value="kilometers">kilometers</option>
                </select>
              </label>
              <label>
                Speed adjustment
                <input
                  type="number"
                  step="0.01"
                  value={settings.speedAdjustment}
                  onChange={(event) =>
                    updateSetting("speedAdjustment", toNumber(event.target.value))
                  }
                />
              </label>
              <label>
                Mileage adjustment
                <input
                  type="number"
                  step="0.01"
                  value={settings.mileageAdjustment}
                  onChange={(event) =>
                    updateSetting(
                      "mileageAdjustment",
                      toNumber(event.target.value),
                    )
                  }
                />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Problem.availableRoutes</p>
                <h2>Available route configurations</h2>
              </div>
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  setRoutes((current) => [
                    ...current,
                    createRoute(current.length + 1),
                  ])
                }
              >
                Add route
              </button>
            </div>
            <div className="items-list">
              {routes.map((route, index) => (
                <article className="subpanel" key={`${route.routeId}-${index}`}>
                  <div className="subpanel-heading">
                    <h3>{route.routeId || `Route ${index + 1}`}</h3>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() =>
                        setRoutes((current) =>
                          current.filter((_, routeIndex) => routeIndex !== index),
                        )
                      }
                      disabled={routes.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid three">
                    <label>
                      Route ID
                      <input
                        value={route.routeId}
                        onChange={(event) =>
                          updateRoute(index, "routeId", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Origin longitude
                      <input
                        type="number"
                        step="0.000001"
                        value={route.longitude}
                        onChange={(event) =>
                          updateRoute(index, "longitude", toNumber(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      Origin latitude
                      <input
                        type="number"
                        step="0.000001"
                        value={route.latitude}
                        onChange={(event) =>
                          updateRoute(index, "latitude", toNumber(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      Start time
                      <input
                        type="datetime-local"
                        value={route.routeStartTime}
                        onChange={(event) =>
                          updateRoute(index, "routeStartTime", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Late finish
                      <input
                        type="datetime-local"
                        value={route.lateFinish}
                        onChange={(event) =>
                          updateRoute(index, "lateFinish", event.target.value)
                        }
                      />
                    </label>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={route.oneWay}
                        onChange={(event) =>
                          updateRoute(index, "oneWay", event.target.checked)
                        }
                      />
                      One-way route
                    </label>
                  </div>
                  <div className="grid four">
                    <label>
                      Driver hourly cost
                      <input
                        type="number"
                        step="0.01"
                        value={route.driverHourlyCost}
                        onChange={(event) =>
                          updateRoute(
                            index,
                            "driverHourlyCost",
                            toNumber(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Driver fixed cost
                      <input
                        type="number"
                        step="0.01"
                        value={route.driverFixedCost}
                        onChange={(event) =>
                          updateRoute(
                            index,
                            "driverFixedCost",
                            toNumber(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Vehicle distance cost
                      <input
                        type="number"
                        step="0.01"
                        value={route.vehicleDistanceCost}
                        onChange={(event) =>
                          updateRoute(
                            index,
                            "vehicleDistanceCost",
                            toNumber(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Vehicle fixed cost
                      <input
                        type="number"
                        step="0.01"
                        value={route.vehicleFixedCost}
                        onChange={(event) =>
                          updateRoute(
                            index,
                            "vehicleFixedCost",
                            toNumber(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Capacity pieces
                      <input
                        type="number"
                        value={route.capacityPieces}
                        onChange={(event) =>
                          updateRoute(
                            index,
                            "capacityPieces",
                            toNumber(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Capacity pounds
                      <input
                        type="number"
                        value={route.capacityPounds}
                        onChange={(event) =>
                          updateRoute(
                            index,
                            "capacityPounds",
                            toNumber(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Max work time
                      <input
                        type="number"
                        step="0.25"
                        value={route.maxWorkTime}
                        onChange={(event) =>
                          updateRoute(
                            index,
                            "maxWorkTime",
                            toNumber(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Work day
                      <input
                        type="number"
                        step="0.25"
                        value={route.workDay}
                        onChange={(event) =>
                          updateRoute(index, "workDay", toNumber(event.target.value))
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Problem.unloadedStops</p>
                <h2>Unassigned stops and orders</h2>
              </div>
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  setStops((current) => [
                    ...current,
                    createStop(current.length + 1),
                  ])
                }
              >
                Add stop
              </button>
            </div>
            <div className="items-list">
              {stops.map((stop, index) => (
                <article className="subpanel" key={`${stop.internalKey}-${index}`}>
                  <div className="subpanel-heading">
                    <h3>Stop {stop.internalKey}</h3>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() =>
                        setStops((current) =>
                          current.filter((_, stopIndex) => stopIndex !== index),
                        )
                      }
                      disabled={stops.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid four">
                    <label>
                      Stop key
                      <input
                        type="number"
                        value={stop.internalKey}
                        onChange={(event) =>
                          updateStop(index, "internalKey", toNumber(event.target.value))
                        }
                        required
                      />
                    </label>
                    <label>
                      Longitude
                      <input
                        type="number"
                        step="0.000001"
                        value={stop.longitude}
                        onChange={(event) =>
                          updateStop(index, "longitude", toNumber(event.target.value))
                        }
                        required
                      />
                    </label>
                    <label>
                      Latitude
                      <input
                        type="number"
                        step="0.000001"
                        value={stop.latitude}
                        onChange={(event) =>
                          updateStop(index, "latitude", toNumber(event.target.value))
                        }
                        required
                      />
                    </label>
                    <label>
                      EQ code
                      <input
                        value={stop.eqCode}
                        onChange={(event) =>
                          updateStop(index, "eqCode", event.target.value)
                        }
                        placeholder="optional"
                      />
                    </label>
                    <label>
                      Order ID
                      <input
                        value={stop.orderId}
                        onChange={(event) =>
                          updateStop(index, "orderId", event.target.value)
                        }
                        required
                      />
                    </label>
                    <label>
                      Order key
                      <input
                        type="number"
                        value={stop.orderKey}
                        onChange={(event) =>
                          updateStop(index, "orderKey", toNumber(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      Line item ID
                      <input
                        value={stop.lineItemId}
                        onChange={(event) =>
                          updateStop(index, "lineItemId", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Line item key
                      <input
                        type="number"
                        value={stop.lineItemKey}
                        onChange={(event) =>
                          updateStop(
                            index,
                            "lineItemKey",
                            toNumber(event.target.value),
                          )
                        }
                      />
                    </label>
                    <label>
                      Fixed service time
                      <input
                        type="number"
                        step="0.25"
                        value={stop.fixedTime}
                        onChange={(event) =>
                          updateStop(index, "fixedTime", toNumber(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      Pieces
                      <input
                        type="number"
                        value={stop.pieces}
                        onChange={(event) =>
                          updateStop(index, "pieces", toNumber(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      Pounds
                      <input
                        type="number"
                        value={stop.pounds}
                        onChange={(event) =>
                          updateStop(index, "pounds", toNumber(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      Unload rate
                      <input
                        type="number"
                        step="0.25"
                        value={stop.unloadRate}
                        onChange={(event) =>
                          updateStop(index, "unloadRate", toNumber(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      Window opens
                      <input
                        type="time"
                        value={stop.windowOpen}
                        onChange={(event) =>
                          updateStop(index, "windowOpen", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Window closes
                      <input
                        type="time"
                        value={stop.windowClose}
                        onChange={(event) =>
                          updateStop(index, "windowClose", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Earliest date
                      <input
                        type="date"
                        value={stop.earliestDate}
                        onChange={(event) =>
                          updateStop(index, "earliestDate", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Latest date
                      <input
                        type="date"
                        value={stop.latestDate}
                        onChange={(event) =>
                          updateStop(index, "latestDate", event.target.value)
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="sidecar">
          <section className="panel sticky-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Request body</p>
                <h2>Generated JSON</h2>
              </div>
              <button className="ghost" type="button" onClick={copyPayload}>
                {copyLabel}
              </button>
            </div>
            <p className="hint">
              Edit this JSON directly for advanced fields like existing routes or
              resource schedules. Form changes keep updating it until you edit here.
            </p>
            {payloadDirty && (
              <div className="notice">
                Raw JSON has manual edits.
                <button type="button" onClick={resetRawPayload}>
                  Reset to form values
                </button>
              </div>
            )}
            <textarea
              className={payloadParseError ? "json-editor invalid" : "json-editor"}
              value={payloadText}
              onChange={(event) => {
                setPayloadDirty(true);
                setPayloadText(event.target.value);
              }}
              spellCheck={false}
              aria-label="Solve request JSON"
            />
            {payloadParseError && (
              <p className="error-text">Invalid JSON: {payloadParseError}</p>
            )}
            <button
              className="primary"
              type="submit"
              disabled={isSubmitting || Boolean(payloadParseError)}
            >
              {isSubmitting ? "Sending Solve request..." : "Send Solve request"}
            </button>
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
    <section className={result.ok ? "panel response-panel" : "panel response-panel error-panel"}>
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
