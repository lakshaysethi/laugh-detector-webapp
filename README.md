# Laugh Detector Web App

A browser-based webcam app that estimates whether a person looks like they are laughing.

The app runs entirely in the browser for detection and exposes a small JSON API from the container so live results can be polled or scraped.

## Features

- Live webcam preview
- Face-expression scoring in the browser
- Laugh-like state estimation
- JSON API for the latest snapshot
- Docker-first setup

## Requirements

### Hardware

- A webcam
- A CPU capable of running a modern browser and Docker
- 4 GB RAM minimum
- 8 GB RAM recommended
- No GPU required

### Software

- Docker Engine or Docker Desktop
- A modern browser with webcam permissions enabled
- Internet access the first time the page loads so the `face-api.js` library and model files can be fetched from the public CDN

## Quick Start

Clone the repository and start it with Docker:

```sh
git clone <your-github-repo-url>
cd laugh-detector-webapp
docker build -t laugh-detector .
docker run --rm -p 4173:4173 laugh-detector
```

Or with Docker Compose:

```sh
docker compose up --build
```

Open:

```text
http://localhost:4173
```

If your browser is running on the same machine, camera permissions should work from `localhost`.

## API

The app exposes a small JSON API for the latest live snapshot:

- `GET /api/live` returns the latest snapshot
- `POST /api/live` updates the snapshot from the browser
- `GET /api/health` returns a basic health check

Example:

```sh
curl http://localhost:4173/api/live
```

Example response:

```json
{
  "status": "Laughing",
  "detail": "Expression looks like laughter.",
  "tone": "good",
  "laughScore": 0.81,
  "happyScore": 0.74,
  "mouthOpenScore": 0.62,
  "faceCount": 1,
  "updatedAt": "2026-03-31T00:00:00Z",
  "source": "browser"
}
```

## Docker

The container serves the app on port `4173`.

Build:

```sh
docker build -t laugh-detector .
```

Run:

```sh
docker run --rm -p 4173:4173 laugh-detector
```

Compose:

```sh
docker compose up --build
```

Optional background run:

```sh
docker run -d --name laugh-detector -p 4173:4173 laugh-detector
```

Stop it:

```sh
docker stop laugh-detector
```

## Scraping Live Data

If you want to poll the current state:

```sh
watch -n 1 'curl -s http://localhost:4173/api/live'
```

The browser must be open and camera detection must be running for the API to update.

## Development Notes

- Detection is heuristic, not an objective truth classifier.
- The app uses face-expression and mouth-opening cues to estimate laughter.
- The API state lives in memory inside the container and resets when the container restarts.

## License

MIT. See [`LICENSE`](LICENSE).

## Repository Structure

```text
index.html   - UI shell
styles.css   - app styles
app.js       - webcam detection logic
server.py    - static server and JSON API
Dockerfile   - container image
```
