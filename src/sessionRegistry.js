const sessions = {};

/**
 * Get active session by tab ID.
 */
export function getSession(tabId) {
  return sessions[tabId];
}

/**
 * Register a new session by tab ID.
 */
export function registerSession(tabId, session) {
  sessions[tabId] = session;
}

/**
 * Close and dispose session connections and terminals when tabs are explicitly closed.
 */
export function destroySession(tabId) {
  const session = sessions[tabId];
  if (session) {
    try {
      if (session.socket) {
        session.socket.close();
      }
    } catch (e) {
      console.error('Error closing socket for session', tabId, e);
    }
    try {
      if (session.term) {
        session.term.dispose();
      }
    } catch (e) {
      console.error('Error disposing terminal for session', tabId, e);
    }
    delete sessions[tabId];
  }
}
