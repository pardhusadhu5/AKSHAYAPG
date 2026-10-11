// Real-time Event Broadcaster using Server-Sent Events (SSE)
// Supports automatic browser reconnection, heartbeats, and admin-only event routing

const clients = new Set();

/**
 * Register an admin SSE client response stream
 * @param {import('express').Response} res 
 * @param {import('express').Request} req 
 */
function addAdminClient(res, req) {
  clients.add(res);

  // Send initial connection handshake
  res.write(': connected\n\n');

  // Handle client disconnect or connection abort
  req.on('close', () => {
    clients.delete(res);
  });
}

/**
 * Broadcast an event to all connected admin dashboards
 * @param {string} eventType 
 * @param {object} data 
 */
function broadcastAdminEvent(eventType, data) {
  if (clients.size === 0) return;

  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch (err) {
      clients.delete(client);
    }
  }
}

// 25-second heartbeat ping to keep connections alive across Render / reverse-proxy timeouts
setInterval(() => {
  for (const client of clients) {
    try {
      client.write(': ping\n\n');
    } catch (err) {
      clients.delete(client);
    }
  }
}, 25000);

module.exports = {
  addAdminClient,
  broadcastAdminEvent,
  getActiveAdminCount: () => clients.size
};
