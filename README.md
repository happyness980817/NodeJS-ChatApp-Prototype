# Product Prototype (AI-Assisted Counseling Platform)

A counseling platform prototype - based on Byron Katie's "The Work" methodology with AI assistance.

## Overview

- Counseling platform which implements Byron Katie's "The Work"
- AI assistance powered by OpenAI Responses API
- Inspired by the concept of "Pretotyping" from "The Right It" by Alberto Savoia
- Minimal feature set required only for demand validation
- No databases, No login/logout

## Tech Stack

- Node.js
- Express
- Socket.IO
- OpenAI Responses API
- Pug

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your OpenAI API key
```

3. Run the server:

```bash
npm start
```

## App Flow (Routes)

- `POST /create` – Generate a 20-char room code (shown **once**), save to session, optional immediate enter
- `POST /enter` – Join with a received code, save to session
- `GET /room` – Render counselor/client view by session (room code never shown in UI)

> For production, use a persistent session store (e.g., Redis, MongoDB) and secure cookies.

## Note

This is a "pretotype" - a smaller version of an MVP(Minimum Viable Product).
For fast demand validation with limited resources, only minimal features included.
