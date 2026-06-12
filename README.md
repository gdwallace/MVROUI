# MVROUI

A starter UI for the Trimble Multi-Vehicle Routing API.

## MVRO Console

The current app focuses on `POST /routingoptimization/v2/solve` from the
provided OpenAPI collection definition. It includes:

- API target and API key input sent as the `Authorization` header
- Upload support for a prepared Solve request JSON file
- Drag-and-drop or browse-based JSON loading
- Optional, hidden-by-default JSON review before sending the request
- Request summaries for stops, routes, and notification subscriptions
- Response handling for `200 OK` solution JSON
- Automatic polling when the API initially returns a polling URL
- Full-width result tables below the Solve controls populated from returned
  response JSON for routes, stops on routes, and unloaded stops
- Suggest API action for unloaded stops returned by Solve
- Suggestion candidate table for possible routes, legs, and sequences
- Hidden-by-default raw JSON sections for Solve and Suggest responses

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
