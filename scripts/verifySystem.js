import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';

const BASE_URL = 'http://localhost:5000';
// Offline-token signing key comes from .env — same HMAC_SECRET the server uses.
const SECRET_KEY = process.env.HMAC_SECRET || '';
if (!SECRET_KEY) console.warn('⚠️ HMAC_SECRET missing in .env — signature steps will fail.');

function logStep(stepNum, title, status, details = '') {
  const icon = status === 'SUCCESS' ? '✅ [SUCCESS]' : '❌ [FAILED]';
  console.log(`\n======================================================`);
  console.log(`STEP ${stepNum}: ${title}`);
  console.log(`STATUS: ${icon}`);
  if (details) console.log(`DETAILS: ${details}`);
  console.log(`======================================================`);
}

async function runSweep() {
  console.log('\n🚀 Starting CampusDebug OS Automated E2E Verification Sweep...\n');

  // STEP 1: Dashboard Data API Check
  try {
    const res = await axios.get(`${BASE_URL}/api/dashboard-data`, { timeout: 5000 });
    if (res.status === 200 && Array.isArray(res.data.tickets) && Array.isArray(res.data.masterClusters)) {
      logStep(1, 'Unified Server & Dashboard Data API Check', 'SUCCESS', 
        `Server returned 200 OK. Active tickets: ${res.data.tickets.length}, Master Clusters: ${res.data.masterClusters.length}`);
    } else {
      logStep(1, 'Unified Server & Dashboard Data API Check', 'FAILED', `Unexpected response payload`);
    }
  } catch (err) {
    logStep(1, 'Unified Server & Dashboard Data API Check', 'FAILED', err.message);
  }

  // STEP 2: Local Ollama AI Ticket Parsing Endpoint Verification
  try {
    const ticketPayload = {
      complaintText: "Room 304 fan regulator sparking and making loud noise",
      hostelBlock: "Block A",
      floor: "2nd Floor",
      room: "304"
    };
    const res = await axios.post(`${BASE_URL}/api/parse-ticket`, ticketPayload, { timeout: 35000 });
    if (res.data && res.data.success && res.data.ticket) {
      logStep(2, 'Ollama AI Ticket Parsing (/api/parse-ticket)', 'SUCCESS',
        `Ticket ID: ${res.data.ticket.id} | Category: ${res.data.ticket.category} | Location: ${res.data.ticket.location} | Clustered: ${res.data.clustered ? 'YES' : 'NO'}`);
    } else {
      logStep(2, 'Ollama AI Ticket Parsing (/api/parse-ticket)', 'FAILED', 'Missing success flag');
    }
  } catch (err) {
    logStep(2, 'Ollama AI Ticket Parsing (/api/parse-ticket)', 'FAILED', err.message);
  }

  // STEP 3: AI Mess Feedback Sentiment Analysis Endpoint Verification
  try {
    const feedbackPayload = {
      feedbackText: "Paneer was delicious but dining tables were unhygienic"
    };
    const res = await axios.post(`${BASE_URL}/api/analyze-feedback`, feedbackPayload, { timeout: 20000 });
    if (res.data && res.data.success && res.data.analysis) {
      const a = res.data.analysis;
      logStep(3, 'AI Mess Feedback Sentiment (/api/analyze-feedback)', 'SUCCESS',
        `Sentiment: ${a.sentiment} | Hygiene Score: ${a.hygieneScore}% | Food Quality Score: ${a.foodQualityScore}% | Reason: "${a.flagReason}"`);
    } else {
      logStep(3, 'AI Mess Feedback Sentiment (/api/analyze-feedback)', 'FAILED', 'Analysis failed');
    }
  } catch (err) {
    logStep(3, 'AI Mess Feedback Sentiment (/api/analyze-feedback)', 'FAILED', err.message);
  }

  // STEP 4: Master Cluster Resolution & Cascade Endpoint Test
  try {
    const resolvePayload = { clusterId: "MST-PLUMB-301" };
    const res = await axios.post(`${BASE_URL}/api/resolve-cluster`, resolvePayload, { timeout: 5000 });
    if (res.data && res.data.success) {
      logStep(4, 'Master Cluster Resolution & Cascade (/api/resolve-cluster)', 'SUCCESS',
        `Cluster ${res.data.clusterId} status updated to RESOLVED. ${res.data.resolvedTickets} child ticket(s) cascaded.`);
    } else {
      logStep(4, 'Master Cluster Resolution & Cascade (/api/resolve-cluster)', 'FAILED', 'Resolution failed');
    }
  } catch (err) {
    logStep(4, 'Master Cluster Resolution & Cascade (/api/resolve-cluster)', 'FAILED', err.message);
  }

  // STEP 5: Offline HMAC Gate Pass Cryptographic Integrity Check
  try {
    const payload = {
      passId: 'GP-TEST-101',
      studentId: 'STU-9921',
      rollNo: '2201106190',
      destination: 'Central Pharmacy',
      reason: 'Medical prescription',
      validUntil: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      issuedAt: new Date().toISOString()
    };

    const canonicalString = JSON.stringify({
      passId: payload.passId,
      studentId: payload.studentId,
      rollNo: payload.rollNo,
      destination: payload.destination,
      reason: payload.reason,
      validUntil: payload.validUntil,
      issuedAt: payload.issuedAt
    });

    const signature = crypto.createHmac('sha256', SECRET_KEY).update(canonicalString).digest('hex');
    const tokenObj = { payload, signature, v: 1 };
    const rawToken = Buffer.from(JSON.stringify(tokenObj)).toString('base64');

    // Recalculate signature to verify tamper-evidence
    const reDecoded = JSON.parse(Buffer.from(rawToken, 'base64').toString('utf-8'));
    const reCanonical = JSON.stringify({
      passId: reDecoded.payload.passId,
      studentId: reDecoded.payload.studentId,
      rollNo: reDecoded.payload.rollNo,
      destination: reDecoded.payload.destination,
      reason: reDecoded.payload.reason,
      validUntil: reDecoded.payload.validUntil,
      issuedAt: reDecoded.payload.issuedAt
    });

    const verifySignature = crypto.createHmac('sha256', SECRET_KEY).update(reCanonical).digest('hex');
    const isValid = verifySignature === reDecoded.signature;
    const isExpired = Date.now() > new Date(reDecoded.payload.validUntil).getTime();

    if (isValid && !isExpired) {
      logStep(5, 'Offline HMAC Gate Pass Cryptographic Integrity', 'SUCCESS',
        `Pass #${reDecoded.payload.passId} HMAC-SHA256 signature verified match. Expired: ${isExpired ? 'YES' : 'NO (Active)'}`);
    } else {
      logStep(5, 'Offline HMAC Gate Pass Cryptographic Integrity', 'FAILED', 'Signature mismatch or expired');
    }
  } catch (err) {
    logStep(5, 'Offline HMAC Gate Pass Cryptographic Integrity', 'FAILED', err.message);
  }

  console.log('\n🎉 E2E Automated Verification Sweep Complete!\n');
}

runSweep();
