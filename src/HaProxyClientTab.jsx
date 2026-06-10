import React, { useState, useEffect } from 'react';

export function HaProxyView({ connection }) {
  const haproxyConfig = connection?.services?.haproxy || {};
  const [servers, setServers] = useState([
    { name: 'app_srv_01', ip: '10.0.0.10', weight: 1, activeConns: 12, status: 'UP', checkTime: '4ms', bytesIn: '124 MB', bytesOut: '1.2 GB' },
    { name: 'app_srv_02', ip: '10.0.0.11', weight: 1, activeConns: 8, status: 'UP', checkTime: '3ms', bytesIn: '98 MB', bytesOut: '940 MB' },
    { name: 'app_srv_03', ip: '10.0.0.12', weight: 1, activeConns: 0, status: 'MAINT', checkTime: '-', bytesIn: '0 MB', bytesOut: '0 MB' }
  ]);

  const [stats, setStats] = useState({
    sessionRate: 42,
    maxSessions: 1500,
    currentSessions: 20,
    bytesInRate: '4.2 MB/s',
    bytesOutRate: '35.4 MB/s'
  });

  useEffect(() => {
    const timer = setInterval(() => {
      // Simulate connection traffic fluctuations
      setServers(prev => prev.map(srv => {
        if (srv.status !== 'UP') return srv;
        const delta = Math.floor((Math.random() - 0.5) * 4);
        return {
          ...srv,
          activeConns: Math.max(0, srv.activeConns + delta)
        };
      }));

      setStats(prev => {
        const srvUp = servers.filter(s => s.status === 'UP');
        const activeSum = srvUp.reduce((sum, s) => sum + s.activeConns, 0);
        return {
          ...prev,
          currentSessions: activeSum,
          sessionRate: Math.max(5, Math.floor(activeSum * 2.1))
        };
      });
    }, 2500);

    return () => clearInterval(timer);
  }, [servers]);

  const toggleServerStatus = (serverName) => {
    setServers(prev => prev.map(srv => {
      if (srv.name === serverName) {
        const nextStatus = srv.status === 'UP' ? 'MAINT' : 'UP';
        return {
          ...srv,
          status: nextStatus,
          activeConns: nextStatus === 'MAINT' ? 0 : 5,
          checkTime: nextStatus === 'MAINT' ? '-' : '5ms'
        };
      }
      return srv;
    }));
  };

  return (
    <div className="haproxy-container">
      <div className="haproxy-metrics-grid">
        <div className="rmq-metric-card glass-panel">
          <div className="metric-header">Active Frontend Sessions</div>
          <div className="metric-val">{stats.currentSessions}</div>
          <div className="metric-sub">Connected client requests</div>
        </div>
        <div className="rmq-metric-card glass-panel">
          <div className="metric-header">Session Rate</div>
          <div className="metric-val">{stats.sessionRate} /s</div>
          <div className="metric-sub">New connections per second</div>
        </div>
        <div className="rmq-metric-card glass-panel">
          <div className="metric-header">Max Sessions Limit</div>
          <div className="metric-val">{stats.maxSessions}</div>
          <div className="metric-sub">Configured soft capacity</div>
        </div>
        <div className="rmq-metric-card glass-panel">
          <div className="metric-header">Network In / Out Rates</div>
          <div className="metric-val-split">
            <span className="rate-in">{stats.bytesInRate}</span>
            <span className="rate-divider">|</span>
            <span className="rate-out">{stats.bytesOutRate}</span>
          </div>
          <div className="metric-sub">Total routing throughput</div>
        </div>
      </div>

      <div className="haproxy-main-panel glass-panel">
        <div className="haproxy-header-row">
          <div className="table-list-title">Backend Server Pool: app_servers_backend</div>
          <div className="haproxy-config-meta">
            <span>Stats URL: {haproxyConfig.statsUrl || 'http://localhost:1936/;csv'}</span>
          </div>
        </div>

        <div className="results-table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Server Identifier</th>
                <th>Target IP Address</th>
                <th>Weight</th>
                <th>Active Sessions</th>
                <th>Health Status</th>
                <th>Check Latency</th>
                <th>Bytes In</th>
                <th>Bytes Out</th>
                <th style={{ textAlign: 'center' }}>Admin Controls</th>
              </tr>
            </thead>
            <tbody>
              {servers.map(srv => (
                <tr key={srv.name}>
                  <td style={{ fontWeight: 'bold' }}>{srv.name}</td>
                  <td>{srv.ip}</td>
                  <td>{srv.weight}</td>
                  <td style={{ fontWeight: 'bold' }}>{srv.activeConns}</td>
                  <td>
                    <span className={`haproxy-status-badge ${srv.status.toLowerCase()}`}>
                      {srv.status}
                    </span>
                  </td>
                  <td>{srv.checkTime}</td>
                  <td>{srv.bytesIn}</td>
                  <td>{srv.bytesOut}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className={`haproxy-control-btn ${srv.status === 'UP' ? 'disable' : 'enable'}`}
                      onClick={() => toggleServerStatus(srv.name)}
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
    </div>
  );
}
