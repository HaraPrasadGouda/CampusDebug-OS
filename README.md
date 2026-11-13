# 🏛️ CampusDebug OS

> **The Offline-First, Zero-Trust College Operations & Vendor SLA Auditing Platform.**  
> Built with React 19, Express 5, Supabase (with resilient local disk-ledger fallback), and Gemini 2.0 Flash.

[![Node.js CI](https://img.shields.io/badge/Node.js-v20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React 19](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Express 5](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20%2B%20Offline%20Ledger-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Gemini 2.0 Flash](https://img.shields.io/badge/AI%20Engine-Gemini%202.0%20Flash-4285F4?logo=google-gemini&logoColor=white)](https://ai.google.dev/)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20First-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📌 Executive Summary

Colleges and universities struggle with disconnected, paper-heavy operations:
1. **Outsourced Cleaning & Vendor Fraud:** Colleges pay ₹1,00,000+ monthly to cleaning contractors without any proof of whether rooms were actually cleaned or if staff fulfilled their contract hours.
2. **Campus Gate Security:** Paper gate passes and fake/shared screenshot QRs bypass physical security.
3. **Flaky Campus Connectivity:** Standard cloud-only apps break the moment campus Wi-Fi or cellular networks drop.

**CampusDebug OS** is a unified, offline-first operating system designed to solve campus workflow friction with zero trust, real-time cryptographic validation, and an autonomous **AI Vendor SLA Auto-Auditor**.

---

## 🌟 Key Highlights & Innovations

### 1. 🤖 AI Vendor SLA Auto-Auditor (Enterprise B2B Feature)
* **The Problem:** College administrations outsource sanitation to third-party vendors. Wardens cannot manually inspect hundreds of paper registers, leading to full invoice payments despite missed rooms and ignored complaints.
* **The Solution:** An autonomous audit agent powered by **Gemini 2.0 Flash** (with a deterministic local fallback).
* **Multi-Silo Data Ingestion:**
  * **Ground-Truth Room Scans:** Cryptographically verified room cleaning timestamps.
  * **Gate Attendance Ledger:** Security guard check-ins recording cleaner entry/exit and shift hours.
  * **Student Grievances:** Cleanliness complaint tickets and resolution lag times.
* **Autonomous Output:** Computes exact penalty deductions against the vendor's contract (SLA) and drafts a legally defensible **Audit Memo & Dispute Letter** attached directly to the monthly invoice payout.

### 2. 🔐 Zero-Trust Dynamic Rotating QR Codes
* **Anti-Screenshot & Anti-Proxy:** Room cleaning and gate pass QRs rotate cryptographically with time-window validity (TweetNaCl/HMAC). Screenshots shared on WhatsApp expire within seconds.
* **Student-Presence Enforced:** Cleaners cannot fake room cleaning. A room is only recorded if a resident physically displays their live QR.
* **Auto-Exempt "All Away · Locked" Detection:** If all room occupants are away on approved gate passes or leave, the room is automatically flagged as locked and exempt from vendor penalties.

### 3. ⚡ Offline-First Dual-Write Persistence
* **Resilient Architecture:** Dual-write mechanism that writes to **Supabase (PostgreSQL)** when online and instantly falls back to an atomic **Local Disk-Ledger** during network dropouts.
* **Self-Healing Sync:** Automatically merges and deduplicates queued transactions when connectivity restores. Nothing is lost offline.

### 4. 👥 6 Role-Tailored Portals in a Single PWA
* 🎓 **Student Dashboard:** Dynamic gate pass requests, timetable, attendance tracking, fee dues, room QR generator, and instant complaint filing.
* 🛡️ **Guard Scanner:** High-speed barcode/QR scanner for campus gate entries, exit passes, cleaner staff badge attendance, and real-time parent SMS notifications.
* 🧹 **Cleaner Interface:** Distraction-free, single-screen camera tool for verifying hostel room cleans in real-time.
* 📋 **Warden Portal:** Hostel block oversight, floor-by-floor cleaning coverage heatmaps, gate pass approvals, and the Vendor SLA Auditor card.
* 👨‍🏫 **Teacher Hub:** One-tap classroom attendance marking, timetable management, and peer substitution coverage.
* 🏛️ **Admin & Dean Console:** Campus-wide analytics, timetable scheduling engine, fee reconciliation, and formal audit exports.

---

## 🏗️ Architecture & Data Flow

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer (PWA - React 19 + Tailwind)"]
        S[Student Portal]
        W[Warden Dashboard]
        C[Cleaner Tool]
        G[Guard Scanner]
        T[Teacher Hub]
        A[Admin Console]
    end

    subgraph CoreBackend ["Backend & Security (Express 5)"]
        API[REST API Gateway]
        QR[Crypto Token & QR Engine]
        DualWrite[Dual-Write Persistence Layer]
    end

    subgraph DataStorage ["Storage & Redundancy"]
        PG[(Supabase PostgreSQL)]
        Ledger[(Offline Disk-Ledger JSON)]
    end

    subgraph AIEngine ["Autonomous SLA Auditor"]
        Agg[Metrics Aggregator]
        Gemini[Gemini 2.0 Flash Engine]
        LocalFallback[Deterministic Math Fallback]
    end

    S & W & C & G & T & A --> API
    API --> QR
    API --> DualWrite
    DualWrite -->|Online| PG
    DualWrite -->|Offline / Fallback| Ledger
    DualWrite -.->|Auto-Sync & Dedupe| PG

    PG & Ledger --> Agg
    Agg --> Gemini
    Agg --> LocalFallback
    Gemini -->|Executive Memo & Penalty Score| W
```

---

## 🛠️ Tech Stack

* **Frontend:** React 19, Vite, Tailwind CSS, Lucide Icons, HTML5-QRCode
* **Backend:** Express 5 (Node.js ESM), WebPush, Axios, CORS
* **Database & Cloud:** Supabase (PostgreSQL), Atomic JSON disk-ledger
* **AI & Intelligence:** Google Gemini 2.0 Flash (`@google/genai` / REST API)
* **Cryptography & Auth:** TweetNaCl, rotating timestamp tokens, SHA-256 HMAC
* **Testing:** Node.js native test runner (`node:test`) with custom mock Supabase & fake-clock time-travel harness

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** >= 20.0.0
* **npm** >= 10.0.0
* Supabase Account (Optional — full local ledger fallback included)
* Gemini API Key (Optional — deterministic fallback included)

### 1. Clone & Install
```bash
git clone https://github.com/HaraPrasadGouda/CampusDebug-OS.git
cd CampusDebug-OS
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
PORT=3000

# Optional: Supabase Database (Auto-falls back to local ledger if omitted)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-or-service-key

# Optional: Gemini AI Key (Auto-falls back to deterministic engine if omitted)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash
```

### 3. Run in Development Mode
```bash
# Terminal 1: Start Express API Backend
npm run server

# Terminal 2: Start Vite Frontend
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Build for Production
```bash
npm run build
npm run preview
```

---

## 🧪 Testing & Verification

The project includes an end-to-end automated test suite utilizing Node's native test runner (`node:test`). Tests run against an isolated local mock environment with injectable time-travel clocks:

```bash
# Run entire test suite
npm test
```

### Test Suite Coverage:
* `test/cleaning.test.mjs`: Window limits, idempotency, student QR validation, and block roster rules.
* `test/cleaning-fixes.test.mjs`: Mobile camera lifecycle, role mappings, and cleaner session persistence.
* `test/cleaner-login.test.mjs`: Static staff credential authentication without forced password resets.
* `test/cleaning-store.test.mjs`: Dual-write self-healing and disk-ledger synchronization.
* `test/security.test.mjs`: Pass forgery prevention, token replay rejection, and role-based access control.

---

## 📊 Live User Roles & Credentials (Demo)

| Role | Username / Identifier | Password | Description |
| :--- | :--- | :--- | :--- |
| **Student** | `2101289001` | *Student Password* | Hostel resident with QR generation & pass access |
| **Cleaner** | `CLEANER-BH1-01` | `clean@BH1` | Dedicated hostel block cleaner |
| **Warden** | `warden_bh1` | *Warden Password* | Hostel warden with block approval rights |
| **Guard** | `guard_main` | *Guard Password* | Main gate barcode/QR pass scanning |
| **Teacher** | `prof_cse` | *Teacher Password* | Attendance & timetable management |
| **Admin** | `admin` | *Admin Password* | Central administration & audit oversight |

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
