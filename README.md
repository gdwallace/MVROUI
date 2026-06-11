# MVROUI

A starter UI for the Trimble Multi-Vehicle Routing API.

## Solve API console

The current app focuses on `POST /routingoptimization/v2/solve` from the
provided OpenAPI collection definition. It includes:

- API target and bearer token inputs
- Async notification options (`poll`, `webhook`, or `push`)
- Solution config controls for dispatch date, distance units, and adjustments
- Available route configuration controls for origin, costs, capacity, and work
  rules
- Unloaded stop/order controls for coordinates, volume, service time, and time
  windows
- Editable generated JSON for advanced request fields
- Response summaries for accepted async operation tokens or returned solutions

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
