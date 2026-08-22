# MitaPesa Frontend

Vite + React + Tailwind wrapper around `PersonalFinanceApp.jsx`.

## Local development

```bash
cp .env.example .env       # point VITE_API_URL at your backend
npm install
npm run dev                 # http://localhost:5173
```

Needs the backend (see `../mitapesa-backend`) running and reachable at
whatever `VITE_API_URL` points to.

## Build for deployment

```bash
npm run build      # outputs static files to dist/
npm run preview    # sanity-check the production build locally
```

`dist/` is a plain static site — any static host (Vercel, Netlify, etc.)
can serve it directly.
