# web

The Split web app. React 19, TypeScript and Vite.

## Run it

```
npm run dev -w @split/web         # port 5173; start the API too (port 3000)
npm run typecheck -w @split/web
```

The dev server forwards `/auth`, `/me`, `/groups` and `/join` to the API on port 3000.

## Pages

- `/` landing page
- `/signup` create an account
- `/login` ask for a log-in link; `/login/verify` is the page the emailed link opens
- `/app` your groups, and each group's Bills and Payments tabs (Bills is a placeholder for now)
