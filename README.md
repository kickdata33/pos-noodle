# POS ร้านลูกชิ้นแชมป์ x นายฮังเพ้ง

ระบบ POS สำหรับร้านก๋วยเตี๋ยว/ลูกชิ้นขนาดเล็ก (~8 โต๊ะ) เน้นใช้งานง่ายผ่าน Tablet (หลัก) และ Mobile (รอง)

สเปคฉบับเต็มอยู่ในโปรเจกต์ Claude ("Pos ร้านก๋วยเตี๋ยว" > `spec-pos-requirements.md`).

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS + hand-rolled shadcn/ui-style components,
Firebase (Firestore + Authentication).

## Architecture

```
src/
  app/            Next.js routes (login, /pos, /admin, API routes)
  components/ui/  shadcn-style primitives (button, card, input, label, ...)
  components/shared/  cross-cutting components (SignOutButton, ...)
  lib/firebase/   Firebase client/admin SDK init, collection name constants
  lib/auth/       session helpers (server) + AuthProvider (client)
  repositories/   thin Firestore data-access layer — one per collection.
                  Components never call Firestore directly; they go through these.
  services/       business logic on top of repositories (added as POS/checkout logic lands)
  hooks/          React hooks wrapping repositories/services for components
  types/          shared TS types mirroring the Firestore schema
  proxy.ts        Next.js 16 "Proxy" (formerly middleware) — optimistic route guard
scripts/
  seed.ts         one-time setup: default shop, 8 tables, sales channels, payment methods, admin login
firestore.rules    role-based Security Rules (see file for the full breakdown)
```

Every business value an Admin should be able to change (shop name, table count/names, menu,
prices, categories, modifiers, payment methods, sales channels, logo, theme, receipt text) is
read from Firestore, never hardcoded into a component — see `types/` and `repositories/`.

## Getting started

1. **Create a Firebase project** (console.firebase.google.com):
   - Enable **Firestore** (production mode, pick a region close to you, e.g. `asia-southeast1`).
   - Enable **Authentication** → Email/Password provider.
   - Add a **Web app** to the project, copy its config.
   - Project settings → Service accounts → Generate new private key (for the Admin SDK / seed script).

2. **Configure env vars**

   ```bash
   cp .env.example .env.local
   ```

   Fill in the Firebase Web app config, the Admin SDK service-account fields, a `NEXT_PUBLIC_SHOP_ID`
   slug, and `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` for the first login.

3. **Install & seed**

   ```bash
   npm install
   npm run seed
   ```

4. **Deploy security rules** (requires the [Firebase CLI](https://firebase.google.com/docs/cli)):

   ```bash
   npx firebase-tools login
   npx firebase-tools use --add   # pick your project
   npx firebase-tools deploy --only firestore:rules
   ```

5. **Run the app**

   ```bash
   npm run dev
   ```

   Log in at `/login` with the seeded admin account. Admins land on `/admin`, staff land on `/pos`.

## Testing security rules locally

```bash
npx firebase-tools emulators:start --only firestore,auth
```

## Status

Milestone 1 (project foundation) — see the plan/PR this was built from. Covers: project setup,
Firebase wiring, Firestore types, seed data, login + role-gated `/admin` vs `/pos`, and Security
Rules. Menu/modifier/table/channel admin screens, the POS order screen, checkout, and the audit
log are the next milestones.
