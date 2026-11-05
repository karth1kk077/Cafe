# QR-Based Smart Café Ordering and Kitchen Management System

Production-minded monorepo: customer QR ordering, chef phone interface, waiter dashboard, admin, real-time updates, billing, strict session closure enforcement.

## Quick start (local)
See docs/SETUP.md. Requires Node 20+ and PostgreSQL (or Docker). 

## Docs
- **APPLICATION-CONTEXT.md** — complete briefing: what the app is, how complete it is, known gaps
- ARCHITECTURE.md, DB-DESIGN.md, API.md, SETUP.md, SECURITY.md, TESTING.md, ACCEPTANCE-TESTS.md, DEPLOYMENT.md, PROGRESS.md

## Core principle
Orders are rejected after session close (server-side). No frontend-only enforcement.
