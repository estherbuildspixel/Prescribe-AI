# Prescribe AI

An AI app that takes medical prescriptions and breaks them down into simple, plain English — no medical jargon. Patients paste a prescription into a flat chat interface, and Google Gemini analyzes and rewrites it in everyday language.

## Stack

- Next.js (App Router) + TypeScript
- Prisma ORM + PostgreSQL
- Google Gemini API (`@google/genai`)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` (see `.env.example`):

   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/prescribe_ai?schema=public"
   GEMINI_API_KEY="<your key from https://aistudio.google.com/apikey>"
   GEMINI_MODEL="gemini-3.1-flash-lite"
   # Optional: cap startup wait (ms) before trying a fallback model
   GEMINI_STARTUP_BUDGET_MS="1800"
   ```

3. Apply the database schema:

   ```bash
   npx prisma migrate dev
   ```

4. Run the app:

   ```bash
   npm run dev
   ```

Open http://localhost:3000 and paste a prescription, e.g. `Amoxicillin 500 mg caps, i po TID x10d`.

## Notes

- Chat history is stored in PostgreSQL and keyed to a per-browser session id.
- Responses stream token-by-token into the chat.
- Prescribe AI gives general information only — it never diagnoses or changes doses.
