import React, { useState, useEffect } from 'react';

export function HaProxyView({ connection, tabId }) {
  const haproxyConfig = connection?.services?.haproxy || {};
  const statsUrl = haproxyConfig.statsUrl || 'http://localhost:1936/;csv';
  const username = haproxyConfig.username || '';
  const password = haproxyConfig.password || '';

  const [viewMode, setViewMode] = useState('dashboard'); // 'dashboard' or 'raw'

  // Dashboard Stats State
  const [frontends, setFrontends] = useState([]);
  const [backends, setBackends] = useState([]);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionPending, setActionPending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Raw View Tunnel State
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState(null);
  const [tunnelPort, setTunnelPort] = useState(null);
  const [copiedUser, setCopiedUser] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  // ----------------------------------------------------
  // DASHBOARD VIEW LOGIC (Polling & Admin Actions)
  // ----------------------------------------------------
  const fetchStats = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch('/api/db/haproxy/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch HAProxy stats');
      }
      setFrontends(data.frontends || []);
      setBackends(data.backends || []);
      setServers(data.servers || []);
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'dashboard' && tabId) {
      fetchStats(true);
      const timer = setInterval(() => {
        fetchStats(false);
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [viewMode, tabId]);

  const handleServerAction = async (serverName, backendName, currentStatus) => {
    if (actionPending) return;
    setActionPending(true);
    const actionVal = currentStatus === 'UP' ? 'maint' : 'ready';
    try {
      const res = await fetch('/api/db/haproxy/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId,
          connection,
          serverName,
          backendName,
          action: actionVal
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update server status');
      }
      await fetchStats(false);
    } catch (err) {
      alert(`Failed to update server status: ${err.message}`);
    } finally {
      setActionPending(false);
    }
  };

  // ----------------------------------------------------
  // RAW VIEW LOGIC (SSH Tunneling & Webview)
  // ----------------------------------------------------
  const connectTunnel = async () => {
    setRawLoading(true);
    setRawError(null);
    try {
      const res = await fetch('/api/db/haproxy/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to establish SSH tunnel for HAProxy Stats page');
      }
      setTunnelPort(data.port);
    } catch (err) {
      console.error(err);
      setRawError(err.message);
    } finally {
      setRawLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'raw' && tabId) {
      connectTunnel();
    }
    return () => {
      if (tabId) {
        fetch('/api/db/haproxy/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tabId })
        }).catch(err => console.error('Error during HAProxy tunnel disconnect:', err));
      }
    };
  }, [viewMode, tabId]);

  // Helper formatting functions
  const formatBytes = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'username') {
      setCopiedUser(true);
      setTimeout(() => setCopiedUser(false), 2000);
    } else {
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    }
  };

  // Group servers by backend pool and filter by searchTerm
  const serversByBackend = {};
  servers.forEach(srv => {
    const matchesSearch = 
      srv.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      srv.backend.toLowerCase().includes(searchTerm.toLowerCase()) ||
      srv.addr.toLowerCase().includes(searchTerm.toLowerCase()) ||
      srv.status.toLowerCase().includes(searchTerm.toLowerCase());

    if (matchesSearch) {
      if (!serversByBackend[srv.backend]) {
        serversByBackend[srv.backend] = [];
      }
      serversByBackend[srv.backend].push(srv);
    }
  });

  // Calculate overall metrics
  const activeSessions = frontends.reduce((acc, f) => acc + f.scur, 0) + backends.reduce((acc, b) => acc + b.scur, 0);
  const totalSessions = frontends.reduce((acc, f) => acc + f.stot, 0);
  const totalBytesIn = frontends.reduce((acc, f) => acc + f.bin, 0);
  const totalBytesOut = frontends.reduce((acc, f) => acc + f.bout, 0);

  // Parse path and query params for raw webview to avoid 503 Service Unavailable (e.g. /stats)
  let pathAndQuery = '/';
  try {
    const parsed = new URL(statsUrl);
    let pathname = parsed.pathname || '/';
    let search = parsed.search || '';
    if (pathname.endsWith(';csv')) {
      pathname = pathname.slice(0, -4);
    }
    if (search.includes(';csv')) {
      search = search.replace(';csv', '');
    }
    pathAndQuery = pathname + search;
  } catch (e) {
    const match = statsUrl.match(/https?:\/\/[^/]+(\/.*)/);
    if (match) {
      pathAndQuery = match[1];
      if (pathAndQuery.endsWith(';csv')) {
        pathAndQuery = pathAndQuery.slice(0, -4);
      }
    }
  }
  const managementUrl = tunnelPort ? `http://127.0.0.1:${tunnelPort}${pathAndQuery}` : '';

  return (
    <div className="haproxy-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Subtab Mode Selector Bar */}
      <div className="haproxy-subtab-headers">
        <button 
          className={`haproxy-tab-btn ${viewMode === 'dashboard' ? 'active' : ''}`}
          onClick={() => setViewMode('dashboard')}
        >
          Interactive Dashboard
        </button>
        <button 
          className={`haproxy-tab-btn ${viewMode === 'raw' ? 'active' : ''}`}
          onClick={() => setViewMode('raw')}
        >
          Raw Web View
        </button>
        <div className="rmq-connection-meta" style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <span>HAProxy Endpoint: {statsUrl}</span>
        </div>
      </div>

      {/* RENDER MODE: INTERACTIVE DASHBOARD */}
      {viewMode === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflowY: 'auto', gap: '20px', paddingBottom: '20px' }}>
          
          {/* Dashboard Control Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
            flexShrink: 0
          }}>
            {/* Search Input */}
            <div style={{ position: 'relative', flexGrow: 1, maxWidth: '400px' }}>
              <input
                type="text"
                placeholder="Search backend pool or server name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 36px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.8rem',
                  outline: 'none'
                }}
              />
              <svg 
                viewBox="0 0 24 24" 
                width="14" 
                height="14" 
                fill="none" 
                stroke="var(--text-secondary)" 
                strokeWidth="2.5"
                style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => fetchStats(true)}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--panel-border)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              <svg 
                viewBox="0 0 24 24" 
                width="14" 
                height="14" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2.5"
                style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}
              >
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '12px', color: 'var(--text-secondary)' }}>
              <div className="spinner-small" style={{ width: '28px', height: '28px', borderWidth: '3px', borderTopColor: 'var(--accent-primary)' }}></div>
              <div style={{ fontSize: '0.85rem' }}>Loading HAProxy stats...</div>
            </div>
          ) : error ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#ef4444', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Failed to retrieve HAProxy stats</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.9, marginBottom: '12px' }}>{error}</div>
              <button className="db-connect-btn" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => fetchStats(true)}>
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Metrics Grid */}
              <div className="haproxy-metrics-grid">
                <div className="rmq-metric-card glass-panel">
                  <div className="metric-header">Active Sessions</div>
                  <div className="metric-val">{activeSessions}</div>
                  <div className="metric-sub">Frontend + Backend concurrency</div>
                </div>
                <div className="rmq-metric-card glass-panel">
                  <div className="metric-header">Total Routed Sessions</div>
                  <div className="metric-val">{totalSessions}</div>
                  <div className="metric-sub">Cumulative connection requests</div>
                </div>
                <div className="rmq-metric-card glass-panel">
                  <div className="metric-header">Total Bytes In</div>
                  <div className="metric-val">{formatBytes(totalBytesIn)}</div>
                  <div className="metric-sub">Incoming traffic data volume</div>
                </div>
                <div className="rmq-metric-card glass-panel">
                  <div className="metric-header">Total Bytes Out</div>
                  <div className="metric-val">{formatBytes(totalBytesOut)}</div>
                  <div className="metric-sub">Outgoing response data volume</div>
                </div>
              </div>

              {/* Render Backend Pools */}
              {Object.keys(serversByBackend).length === 0 ? (
                <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {searchTerm ? 'No servers matched your search criteria.' : 'No backend server pools or servers detected.'}
                </div>
              ) : (
                Object.keys(serversByBackend).map(backendName => (
                  <div key={backendName} className="haproxy-main-panel glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="haproxy-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="table-list-title" style={{ margin: 0, fontWeight: 700 }}>
                        Backend Pool: <span style={{ color: 'var(--accent-primary)' }}>{backendName}</span>
                      </div>
                      <div className="haproxy-config-meta">
                        <span className={`haproxy-status-badge ${backends.find(b => b.name === backendName)?.status.toLowerCase() || 'unknown'}`}>
                          Pool: {backends.find(b => b.name === backendName)?.status || 'UNKNOWN'}
                        </span>
                      </div>
                    </div>

                    <div className="results-table-wrapper">
                      <table className="db-results-table">
                        <thead>
                          <tr>
                            <th>Server Identifier</th>
                            <th>Target Address</th>
                            <th>Weight</th>
                            <th>Active Sessions</th>
                            <th>Health Status</th>
                            <th>Check Duration</th>
                            <th>Bytes In</th>
                            <th>Bytes Out</th>
                            <th style={{ textAlign: 'center' }}>Admin Controls</th>
                          </tr>
                        </thead>
                        <tbody>
                          {serversByBackend[backendName].map(srv => (
                            <tr key={srv.name}>
                              <td style={{ fontWeight: 'bold' }}>{srv.name}</td>
                              <td>{srv.addr}</td>
                              <td>{srv.weight}</td>
                              <td style={{ fontWeight: 'bold' }}>{srv.scur}</td>
                              <td>
                                <span className={`haproxy-status-badge ${srv.status.toLowerCase()}`}>
                                  {srv.status}
                                </span>
                              </td>
                              <td>{srv.check_duration}</td>
                              <td>{formatBytes(srv.bin)}</td>
                              <td>{formatBytes(srv.bout)}</td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  className={`haproxy-control-btn ${srv.status === 'UP' ? 'disable' : 'enable'}`}
                                  disabled={actionPending}
                                  onClick={() => handleServerAction(srv.name, backendName, srv.status)}
                                  style={{
                                    opacity: actionPending ? 0.6 : 1,
                                    cursor: actionPending ? 'not-allowed' : 'pointer'
                                  }}
                                >
                                  {srv.status === 'UP' ? 'Drain (MAINT)' : 'Set Online (UP)'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}

      {/* RENDER MODE: RAW WEB VIEW (SSH TUNNEL + EMBED) */}
      {viewMode === 'raw' && (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}>
          {rawLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', color: 'var(--text-secondary)' }}>
              <div className="spinner-small" style={{ width: '32px', height: '32px', borderWidth: '3px', borderTopColor: 'var(--accent-primary)' }}></div>
              <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>Establishing secure SSH tunnel for HAProxy Stats...</div>
            </div>
          ) : rawError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center', gap: '16px' }}>
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#ef4444" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div style={{ color: '#ef4444', fontWeight: 600, fontSize: '1rem' }}>Connection Failed</div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '400px', margin: 0 }}>
                {rawError}
              </p>
              <button onClick={connectTunnel} className="db-connect-btn" style={{ width: 'auto', padding: '8px 16px', fontSize: '0.8rem', marginTop: '8px' }}>
                Retry Connection
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
              {/* Credentials / Control Bar */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                background: 'rgba(10, 15, 30, 0.45)',
                borderBottom: '1px solid var(--panel-border)',
                flexShrink: 0,
                gap: '12px',
                flexWrap: 'wrap',
                marginBottom: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }}></span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>HAProxy Stats Web Tunnel</span>
                </div>

                {username && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Username:</span>
                      <span style={{ color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{username}</span>
                      <button 
                        onClick={() => copyToClipboard(username, 'username')}
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--text-secondary)', padding: '2px 6px', cursor: 'pointer', fontSize: '0.65rem' }}
                      >
                        {copiedUser ? 'Copied!' : 'Copy'}
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Password:</span>
                      <span style={{ color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{password}</span>
                      <button 
                        onClick={() => copyToClipboard(password, 'password')}
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--text-secondary)', padding: '2px 6px', cursor: 'pointer', fontSize: '0.65rem' }}
                      >
                        {copiedPass ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => window.open(managementUrl, '_blank')}
                    style={{
                      background: 'rgba(99, 102, 241, 0.15)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: '6px',
                      color: '#818cf8',
                      padding: '5px 12px',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    Open External Browser
                  </button>
                  <button onClick={connectTunnel} style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px', color: 'var(--text-primary)', padding: '5px 12px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
                    Reconnect
                  </button>
                </div>
              </div>

              {/* Embedded Guest Frame */}
              <div style={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative', background: '#fff' }}>
                {navigator.userAgent.toLowerCase().includes('electron') ? (
                  <webview src={managementUrl} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
                ) : (
                  <iframe src={managementUrl} title="HAProxy Raw Stats Board" style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
