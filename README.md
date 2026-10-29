# Docu — Offline Documentation to PDF Converter

Docu is a minimal web application that converts documentation websites, technical manuals, and online articles into structured, professionally formatted, downloadable PDF manuals.

Enter a documentation URL, discover pages within scope, customize your page selection, and download a clean, searchable PDF manual with a clickable table of contents, vector bookmarks, syntax-highlighted code blocks, and formatted tables.

---

## Features

- **Universal Deterministic Extraction:** Readability-style density scoring extracts genuine documentation and article content while stripping repeated navigation menus, cookie consent banners, advertisement blocks, and promotional clutter.
- **Publication-Quality PDFs:** Built using PDFKit for pure vector typography. Generates a cover page, hierarchical clickable Table of Contents, running headers/footers with page numbers, syntax-highlighted code boxes, definition lists, tables with repeated headers, and figures with captions.
- **Zero Raw URLs:** External/vector illustrations render elegant reference cards with direct browser link annotations rather than raw URL strings.
- **Hardened Security:** Multi-layered SSRF protection, private IP blocking (RFC 1918, RFC 4193, loopback, link-local, cloud metadata `169.254.169.254`), DNS rebinding mitigation, bounded streaming to prevent memory exhaustion, and strict redirect hop validation.
- **Authoritative Server Quotas:**
  - **Free Plan:** 2 exports per 30 days, up to 20 pages per export, default cover title, standard queue.
  - **Pro Plan ($12/mo):** 20 exports per 30 days, up to 500 pages per export, custom cover title, priority queue.
- **Stripe Billing Integration:** Cryptographic webhook verification (`stripe-signature` HMAC-SHA256), idempotent event processing, and local sandbox simulation mode for verification without live card charges.
- **Automatic Lifecycle Cleanup:** Generated PDF manuals, download tokens, and temporary files expire and are permanently purged from disk after 1 hour.
- **Zero AI:** Purely deterministic HTML and PDF processing. No LLMs, embeddings, or external AI APIs.

---

## Quick Start

### 1. Requirements

- Node.js 18.17+ or Node.js 20+
- npm 9+

### 2. Installation

```bash
git clone https://github.com/sanstack256/Docu.git
cd Docu
npm install
```

### 3. Environment Configuration

Copy the example configuration:

```bash
cp .env.example .env.local
```

Configure your secrets:
- `DOCU_SECRET`: Random secret used for HMAC cookie signing.
- `STRIPE_SECRET_KEY`: Stripe API secret key (optional for sandbox mode).
- `STRIPE_WEBHOOK_SECRET`: Stripe Webhook signing secret (optional for sandbox mode).

### 4. Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Verification & Testing

Docu includes a comprehensive regression test suite:

```bash
# Run unit, integration, corpus, and billing tests
npm test

# Run strict TypeScript type check
npm run typecheck

# Run ESLint
npm run lint

# Run optimized production build
npm run build
```

---

## Architecture Overview

```
src/
├── app/
│   ├── api/
│   │   ├── billing/          # Checkout, Webhooks, Portal, Sandbox
│   │   ├── convert/          # Content extraction & PDF generation
│   │   ├── discover/         # Crawling & page scope discovery
│   │   ├── download/[token]/ # Secure 1-hour tokenized PDF download
│   │   └── jobs/[id]/        # Real-time conversion job status polling
│   ├── privacy/              # Privacy policy & data retention terms
│   ├── terms/                # Terms of service & acceptable use
│   ├── page.tsx              # Main interactive conversion interface
│   └── layout.tsx            # Root layout & styling
└── lib/
    ├── billing.ts            # Stripe webhook crypto & portal handling
    ├── crawler.ts            # BFS crawler, sitemap parser, URL normalization
    ├── extractor.ts          # Density scoring, boilerplate stripping, figure parser
    ├── jobs.ts               # Job state persistence & 1-hour disk retention
    ├── pdf.ts                # PDFKit document generation & TOC generator
    ├── quota.ts              # Server-side entitlement & quota ledger
    ├── rateLimit.ts          # Sliding-window IP rate limiter & storage cleanup
    ├── security.ts           # SSRF, private IP validator, bounded streaming
    └── session.ts            # Cryptographically signed session cookie
```

---

## Deployment

Docu can be deployed to any standard Node.js hosting platform (Vercel, Render, Railway, AWS ECS, or a Docker container):

```bash
npm run build
npm start
```

For production deployments:
1. Ensure `NODE_ENV=production`.
2. Configure `NEXT_PUBLIC_APP_URL` with your public canonical domain (e.g., `https://docu.app`).
3. Set a strong random `DOCU_SECRET`.
4. Configure Stripe production API keys and register the webhook endpoint at `/api/billing/webhook`.

---

## License

MIT License. Respects source documentation policies, robots.txt exclusions, and copyright terms.
