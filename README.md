# MVROUI

A starter UI for the Trimble Multi-Vehicle Routing API.

## Solve API console

The current app focuses on `POST /routingoptimization/v2/solve` from the
provided OpenAPI collection definition. It includes:

- API target and API key input sent as the `Authorization` header
- Upload support for a prepared Solve request JSON file
- Drag-and-drop or browse-based JSON loading
- Editable JSON review before sending the request
- Request summaries for stops, routes, and notification subscriptions
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
