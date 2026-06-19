import React, { useState, useEffect } from 'react';

export function RabbitMqView({ connection, tabId }) {
  const rmqConfig = connection?.services?.rabbitmq || {};
  const username = rmqConfig.username || 'guest';
  const password = rmqConfig.password || 'guest';
  const port = parseInt(rmqConfig.port || '5672', 10);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tunnelPort, setTunnelPort] = useState(null);
  const [copiedUser, setCopiedUser] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  const connectTunnel = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/db/rabbitmq/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection, port })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to establish SSH tunnel for RabbitMQ Management');
      }
      setTunnelPort(data.port);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tabId) {
      connectTunnel();
    }
    // Clean up tunnel on unmount
    return () => {
      if (tabId) {
        fetch('/api/db/rabbitmq/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tabId })
        }).catch(err => console.error('Error during RabbitMQ tunnel cleanup:', err));
      }
    };
  }, [tabId]);

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

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '16px',
        color: 'var(--text-secondary)'
      }}>
        <div className="spinner-small" style={{ width: '32px', height: '32px', borderWidth: '3px', borderTopColor: 'var(--accent-primary)' }}></div>
        <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>Establishing secure SSH tunnel for RabbitMQ...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '24px',
        textAlign: 'center',
        gap: '16px'
      }}>
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#ef4444" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div style={{ color: '#ef4444', fontWeight: 600, fontSize: '1rem' }}>Connection Failed</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '400px', margin: 0 }}>
          {error}
        </p>
        <button 
          onClick={connectTunnel}
          className="db-connect-btn"
          style={{ width: 'auto', padding: '8px 16px', fontSize: '0.8rem', marginTop: '8px' }}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const managementUrl = `http://127.0.0.1:${tunnelPort}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Top Credentials Helper Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: 'rgba(10, 15, 30, 0.45)',
        borderBottom: '1px solid var(--panel-border)',
        flexShrink: 0,
        gap: '12px',
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 8px #10b981'
          }}></span>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>RabbitMQ Management Tunnel</span>
        </div>

        {/* Credentials Copier */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Username:</span>
            <span style={{ color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{username}</span>
            <button 
              onClick={() => copyToClipboard(username, 'username')}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: '0.65rem'
              }}
            >
              {copiedUser ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Password:</span>
            <span style={{ color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{password}</span>
            <button 
              onClick={() => copyToClipboard(password, 'password')}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: '0.65rem'
              }}
            >
              {copiedPass ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
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
          <button
            onClick={connectTunnel}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              padding: '5px 12px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600
            }}
          >
            Reconnect
          </button>
        </div>
      </div>

      {/* Embedded Iframe or Electron Webview */}
      <div style={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative', background: '#fff' }}>
        {navigator.userAgent.toLowerCase().includes('electron') ? (
          <webview 
            src={managementUrl}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#fff'
            }}
          />
        ) : (
          <iframe 
            src={managementUrl}
            title="RabbitMQ Management Console"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#fff'
            }}
          />
        )}
      </div>
    </div>
  );
}
