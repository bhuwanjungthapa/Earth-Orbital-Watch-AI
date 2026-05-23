# Earth Orbital Watch AI

Earth Orbital Watch AI is a serverless 3D orbital intelligence dashboard built. It visualizes tracked Earth-orbiting objects using public orbital element data, SGP4 propagation, and local AI-style analysis for classification, anomaly scoring, natural-language filtering, summaries, and proximity inspection.

Repository: [bhuwanjungthapa/Earth-Orbital-Watch-AI](https://github.com/bhuwanjungthapa/Earth-Orbital-Watch-AI)

## Features

- 3D Earth with draggable orbit controls, switchable 4K/terrain/default map styling, cloud toggle, latitude/longitude grid, atmosphere, and optional galaxy background
- Live propagated satellite/debris positions from current TLE data
- Color-coded orbital dots for satellites, stations, rocket bodies, debris, and unknown catalog objects
- CelesTrak-backed Netlify Function for broad public orbital catalog groups
- Optional Space-Track provider for the full public on-orbit catalog when credentials are configured
- Click any object to inspect altitude, velocity, inclination, eccentricity, apogee, perigee, latitude, longitude, and catalog identity
- SATCAT profile lookup for owner, launch date, launch site, and radar cross section
- Selected-object image lookup from Wikipedia/Wikimedia, with optional Google Programmable Search fallback
- Natural-language filtering such as `Russian rocket bodies before 2000` or `high risk debris below 600 km`
- Orbit classification into LEO, MEO, GEO, HEO, Deep, or Unknown
- Local anomaly scoring using perigee, eccentricity, drag proxy, stale element age, object type, and propagated altitude
- Crowding-based risk score by orbital band
- AI-style object brief with model explainability
- Nearest rendered object analysis
- Time scrubber for past/future propagation
- Prediction marker for +10 minutes, +1 hour, +6 hours, or +24 hours
- Location pass prediction for selected objects, including queries such as `When will this object pass over Mountain View, California?`
- Smart labels with adjustable density

## Tech Stack

- React
- TypeScript
- Vite
- Three.js
- `@react-three/fiber`
- `@react-three/drei`
- `satellite.js`
- Netlify Functions
- CelesTrak GP and SATCAT data

## Data Sources

The default provider uses CelesTrak public GP/TLE data:

- `/.netlify/functions/orbit-catalog`
- `/api/orbit-catalog`

The object detail panel uses CelesTrak SATCAT records:

- `/.netlify/functions/object-profile`
- `/api/object-profile`

The app describes positions as propagated from public orbital elements. It is not a live sensor-tracking or operational conjunction-assessment system.

## Optional Space-Track Setup

Create a free Space-Track account and configure these environment variables in Netlify:

```bash
SPACE_TRACK_IDENTITY=your-email@example.com
SPACE_TRACK_PASSWORD=your-password
```

Then choose `Space-Track` in the app provider menu. Credentials stay server-side inside Netlify Functions.

## Optional Google Image Fallback

The app uses Wikimedia image lookup for free by default. To fall back to Google image search when Wikimedia has no result, configure Google Programmable Search in Netlify:

```bash
GOOGLE_SEARCH_API_KEY=your-api-key
GOOGLE_SEARCH_CX=your-search-engine-id
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the app with Netlify Functions enabled:

```bash
npm run dev
```

Run only the Vite frontend:

```bash
npm run vite:dev
```

Build for production:

```bash
npm run build
```

## Netlify Deployment

1. Push the repository to GitHub.
2. Create a new Netlify site from `bhuwanjungthapa/Earth-Orbital-Watch-AI`.
3. Use the default build settings from `netlify.toml`.
4. Add optional Space-Track environment variables if needed.
5. Deploy.

## Resume Summary

Built Earth Orbital Watch AI, a serverless 3D orbital intelligence dashboard using React, TypeScript, Three.js, Netlify Functions, public CelesTrak/Space-Track orbital data, and SGP4 propagation. Implemented instanced 3D orbital object rendering, local ML-style orbit classification, anomaly scoring, natural-language filtering, selected-object pass prediction, object summarization, and proximity analysis for thousands of tracked Earth-orbiting objects.

## License

MIT License. Free to use, modify, and distribute.
