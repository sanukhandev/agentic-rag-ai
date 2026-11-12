import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const httpBase = process.env.API_BASE_URL ?? 'http://127.0.0.1';
const wsBase = process.env.WS_BASE_URL ?? 'ws://127.0.0.1';
const origin = process.env.ORIGIN ?? 'http://127.0.0.1';
const tenantSlug = process.env.TENANT_SLUG ?? 'anc';

async function createSession() {
  const res = await fetch(`${httpBase}/api/v1/chat/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ tenantSlug }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }
  return await res.json();
}

async function runJourney() {
  console.log(`[E2E] Creating chat session for tenant '${tenantSlug}'...`);
  const session = await createSession();
  const { sessionId, sessionToken } = session;
  console.log(`[E2E] Session created: ${sessionId}`);

  const wsUrl = `${wsBase}/api/chat/stream`;
  console.log(`[E2E] Connecting to WebSocket: ${wsUrl}...`);
  const ws = new WebSocket(wsUrl, { headers: { origin } });

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  console.log(`[E2E] WebSocket connected.`);

  // Authenticate
  ws.send(JSON.stringify({
    type: 'authenticate',
    sessionId,
    sessionToken,
  }));

  await new Promise((resolve, reject) => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.type === 'authenticated') {
        ws.off('message', handler);
        resolve(msg);
      } else if (msg.type === 'error' || msg.error) {
        ws.off('message', handler);
        reject(new Error(JSON.stringify(msg)));
      }
    };
    ws.on('message', handler);
  });
  console.log(`[E2E] WebSocket authenticated successfully.`);

  const turns = [
    {
      turn: 1,
      name: "Greeting",
      message: "Hello!",
    },
    {
      turn: 2,
      name: "Goal Initiation",
      message: "I want to start a company in the free zone.",
    },
    {
      turn: 3,
      name: "Goal Confirmation",
      message: "Yes, I want to proceed.",
    },
    {
      turn: 4,
      name: "Contact Name",
      message: "My name is Rehan Gada.",
    },
    {
      turn: 5,
      name: "Contact Channel (Email & Phone)",
      message: "My email is rehan.antulay@techcarrot.ae and my phone is +9715002133201.",
    },
    {
      turn: 6,
      name: "Contact Consent & Lead Request",
      message: "I consent to use my contact details. Please submit the lead.",
    },
    {
      turn: 7,
      name: "Lead Action Confirmation",
      message: "Yes, please submit the lead.",
    },
    {
      turn: 8,
      name: "Package Inquiry",
      message: "What packages are available for company formation?",
    },
    {
      turn: 9,
      name: "Package Selection (Triggers Document Requirement)",
      message: "I will go with the Growth package.",
    },
    {
      turn: 10,
      name: "Document Readiness & Consent (Before Quote)",
      message: "I have my passport ready and I consent to document processing.",
    },
    {
      turn: 11,
      name: "Quotation Action Proposal Request",
      message: "Yes, please prepare the official quotation for the Growth package.",
    },
    {
      turn: 12,
      name: "Quotation Action Confirmation",
      message: "Yes, please generate the quotation now.",
    },
  ];

  const results = [];

  for (const step of turns) {
    console.log(`\n========================================`);
    console.log(`[Turn ${step.turn}: ${step.name}] User: "${step.message}"`);
    // Use pure randomUUID to satisfy safeScopedReference opaqueUuid rule
    const clientMessageId = randomUUID();

    const turnPromise = new Promise((resolve, reject) => {
      let assistantAnswer = '';
      let turnCompletedResponse = null;

      const timeout = setTimeout(() => {
        ws.off('message', msgHandler);
        reject(new Error(`Turn ${step.turn} timed out waiting for completion`));
      }, 45000);

      const msgHandler = (raw) => {
        try {
          const frame = JSON.parse(raw.toString('utf8'));
          if (frame.clientMessageId !== clientMessageId) return;

          if (frame.type === 'assistant.message') {
            assistantAnswer = frame.answer;
          } else if (frame.type === 'turn.completed') {
            clearTimeout(timeout);
            ws.off('message', msgHandler);
            turnCompletedResponse = frame.response;
            resolve({ answer: assistantAnswer, response: turnCompletedResponse });
          } else if (frame.type === 'turn.failed') {
            clearTimeout(timeout);
            ws.off('message', msgHandler);
            reject(new Error(`Turn failed: ${JSON.stringify(frame.error)}`));
          }
        } catch (e) {
          // ignore parsing error
        }
      };

      ws.on('message', msgHandler);
    });

    ws.send(JSON.stringify({
      type: 'message',
      clientMessageId,
      message: step.message,
    }));

    const result = await turnPromise;
    console.log(`[Turn ${step.turn}] Assistant: "${result.answer}"`);
    if (result.response?.actionProposal) {
      console.log(`[Turn ${step.turn}] Action Proposal:`, JSON.stringify(result.response.actionProposal));
    }
    if (result.response?.pendingRequirementKey) {
      console.log(`[Turn ${step.turn}] Pending Requirement:`, result.response.pendingRequirementKey);
    }

    results.push({
      turn: step.turn,
      name: step.name,
      user: step.message,
      assistant: result.answer,
      actionProposal: result.response?.actionProposal,
      pendingRequirementKey: result.response?.pendingRequirementKey,
    });

    await new Promise((r) => setTimeout(r, 1200));
  }

  ws.close();
  console.log(`\n========================================`);
  console.log(`[E2E] All 12 turns completed over WebSocket!`);
  console.log(`Waiting 8 seconds for async event-worker to finish n8n dispatches...`);
  await new Promise((r) => setTimeout(r, 8000));

  return { sessionId, results };
}

runJourney()
  .then(res => {
    console.log(`\n[SUCCESS] Completed ${res.results.length} turns! SessionId: ${res.sessionId}`);
    process.exit(0);
  })
  .catch(err => {
    console.error(`\n[E2E FAILED]`, err);
    process.exit(1);
  });
