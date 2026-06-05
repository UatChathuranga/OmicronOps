import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import SftpExplorer from './SftpExplorer';
import 'xterm/css/xterm.css';
import { getSession, registerSession } from './sessionRegistry';

export default function TerminalTab({ tab, onStatusChange, onRegisterSocket, isSplit }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);

  const existingSession = getSession(tab.id);
  const [status, setStatus] = useState(existingSession ? existingSession.status : 'connecting');
  const [errorMsg, setErrorMsg] = useState(null);
  const [viewMode, setViewMode] = useState('terminal'); // 'terminal' or 'files'
  const [fontSize, setFontSize] = useState(14);
  
  // VM specifications and usage stats
  const [stats, setStats] = useState(existingSession ? existingSession.stats : null);
  const [speeds, setSpeeds] = useState(existingSession ? existingSession.speeds : { rxSpeed: 0, txSpeed: 0 });
  const lastStatsTimeRef = useRef(null);

  const statusRef = useRef('connecting');
  const viewModeRef = useRef('terminal');

  const onStatusChangeRef = useRef(onStatusChange);
  const setStatusRef = useRef(setStatus);
  const setErrorMsgRef = useRef(setErrorMsg);
  const setStatsRef = useRef(setStats);
  const setSpeedsRef = useRef(setSpeeds);

  const updateStatus = (newVal) => {
    setStatus(newVal);
    const session = getSession(tab.id);
    if (session) session.status = newVal;
  };
  const updateStats = (newVal) => {
    setStats(newVal);
    const session = getSession(tab.id);
    if (session) session.stats = newVal;
  };
  const updateSpeeds = (newVal) => {
    setSpeeds(newVal);
    const session = getSession(tab.id);
    if (session) session.speeds = newVal;
  };

  const updateStatusRef = useRef(updateStatus);
  const updateStatsRef = useRef(updateStats);
  const updateSpeedsRef = useRef(updateSpeeds);

  // Synchronize dynamic refs on every render
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    setStatusRef.current = setStatus;
    setErrorMsgRef.current = setErrorMsg;
    setStatsRef.current = setStats;
    setSpeedsRef.current = setSpeeds;
    updateStatusRef.current = updateStatus;
    updateStatsRef.current = updateStats;
    updateSpeedsRef.current = updateSpeeds;
  });

  // Handle dynamically resizing terminal font-size (text zoom)
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      try {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          const cols = terminalRef.current.cols;
          const rows = terminalRef.current.rows;
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        }
      } catch (err) {
        // Ignore temporary layout sizing issues
      }
    }
  }, [fontSize]);

  const connectSSH = () => {
    // Check if session already exists in global registry
    const existing = getSession(tab.id);
    if (existing) {
      terminalRef.current = existing.term;
      fitAddonRef.current = existing.fitAddon;
      socketRef.current = existing.socket;
      setStatus(existing.status);
      setStats(existing.stats);
      setSpeeds(existing.speeds);
      return;
    }

    setStatus('connecting');
    setErrorMsg(null);

    // Initialize Terminal if not already done
    if (!terminalRef.current) {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'var(--font-mono)',
        fontSize: fontSize,
        lineHeight: 1.2,
        theme: {
          background: '#0a0d16',
          foreground: '#e2e8f0',
          cursor: '#6366f1',
          selectionBackground: 'rgba(99, 102, 241, 0.3)',
          black: '#0f172a',
          red: '#ef4444',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#f8fafc',
          brightBlack: '#475569',
          brightRed: '#f87171',
          brightGreen: '#34d399',
          brightYellow: '#fbbf24',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#ffffff'
        }
      });

      // Highlighted selection copies to system clipboard automatically
      term.onSelectionChange(() => {
        const selection = term.getSelection();
        if (selection && selection.trim().length > 0) {
          navigator.clipboard.writeText(selection).catch(err => {
            console.error('Failed to copy selection to clipboard:', err);
          });
        }
      });

      // Attach custom key event handler to allow standard browser shortcuts
      term.attachCustomKeyEventHandler((e) => {
        const isF = e.key.toLowerCase() === 'f';
        const isR = e.key.toLowerCase() === 'r';
        const isF5 = e.key === 'F5';
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;

        // Allow Ctrl++ and Ctrl+- for terminal zoom
        if (isCtrlOrMeta) {
          if (e.key === '+' || e.key === '=') {
            if (e.type === 'keydown') {
              setFontSize(prev => Math.min(32, prev + 1));
            }
            e.preventDefault();
            return false;
          }
          if (e.key === '-') {
            if (e.type === 'keydown') {
              setFontSize(prev => Math.max(9, prev - 1));
            }
            e.preventDefault();
            return false;
          }
        }

        // Allow Ctrl+F / Cmd+F to bubble up for searching
        if (isCtrlOrMeta && isF) {
          return false;
        }

        // Allow F5 to bubble up for global reload prevention
        if (isF5) {
          return false;
        }

        return true;
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
    }

    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    // Reset terminal content
    term.clear();
    term.reset();
    term.write('\r\n\x1b[36mConnecting to SSH remote host...\x1b[0m\r\n');

    // Establish WebSocket Connection
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    // Register active session to allow survival across mounts
    registerSession(tab.id, {
      term,
      fitAddon,
      socket,
      status: 'connecting',
      stats: null,
      speeds: { rxSpeed: 0, txSpeed: 0 }
    });

    socket.onopen = () => {
      // Fit first to determine sizes
      if (containerRef.current) {
        fitAddon.fit();
      }

      const cols = term.cols || 80;
      const rows = term.rows || 24;

      // Construct and send the init payload
      const initPayload = {
        type: 'init',
        tabId: tab.id,
        cols,
        rows
      };

      if (tab.connectionId) {
        initPayload.connectionId = tab.connectionId;
      } else if (tab.quickConnectDetails) {
        // Quick connect parameters
        Object.assign(initPayload, tab.quickConnectDetails);
      }

      if (isSplit) {
        initPayload.hideStats = true;
      }

      socket.send(JSON.stringify(initPayload));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'status') {
          updateStatusRef.current(msg.status);
          if (onStatusChangeRef.current) {
            onStatusChangeRef.current(tab.id, msg.status);
          }
          if (msg.error) {
            setErrorMsgRef.current(msg.error);
            term.write(`\r\n\x1b[31mSSH Error: ${msg.error}\x1b[0m\r\n`);
          }
        } else if (msg.type === 'data') {
          term.write(colorizeText(msg.data));
        } else if (msg.type === 'stats') {
          const now = Date.now();
          updateStatsRef.current(current => {
            if (current && lastStatsTimeRef.current) {
              const timeDiff = (now - lastStatsTimeRef.current) / 1000;
              if (timeDiff > 0) {
                const rxDiff = msg.stats.network.rx - current.network.rx;
                const txDiff = msg.stats.network.tx - current.network.tx;
                const rxSpeed = rxDiff >= 0 ? rxDiff / timeDiff : 0;
                const txSpeed = txDiff >= 0 ? txDiff / timeDiff : 0;
                updateSpeedsRef.current({ rxSpeed, txSpeed });
              }
            }
            lastStatsTimeRef.current = now;
            return msg.stats;
          });
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    socket.onerror = (err) => {
      console.error('WebSocket encountered an error:', err);
      updateStatusRef.current('disconnected');
      if (onStatusChangeRef.current) {
        onStatusChangeRef.current(tab.id, 'disconnected');
      }
      setErrorMsgRef.current('WebSocket connection error.');
    };

    socket.onclose = () => {
      updateStatusRef.current('disconnected');
      if (onStatusChangeRef.current) {
        onStatusChangeRef.current(tab.id, 'disconnected');
      }
    };

    // Attach local term keystroke listener to WebSocket
    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'data', data }));
      }
    });

    // Attach terminal resize listener to WebSocket
    term.onResize((size) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'resize',
          cols: size.cols,
          rows: size.rows
        }));
      }
    });
  };

  useEffect(() => {
    // Connect SSH on mount
    connectSSH();

    // Mount terminal DOM element
    if (containerRef.current && terminalRef.current) {
      terminalRef.current.open(containerRef.current);
      fitAddonRef.current.fit();
    }

    if (onRegisterSocket) {
      onRegisterSocket(tab.id, (data) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'data', data }));
        }
      });
    }

    // Intercept right click (contextmenu) to paste from system clipboard
    const handleContextMenu = (e) => {
      if (viewModeRef.current !== 'terminal') return; // Do not intercept context menu in SFTP view
      e.preventDefault();
      navigator.clipboard.readText()
        .then(text => {
          if (text && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'data', data: text }));
          }
        })
        .catch(err => {
          console.error('Failed to read from clipboard for paste:', err);
        });
    };

    const el = containerRef.current;
    if (el) {
      el.addEventListener('contextmenu', handleContextMenu);
    }

    const handleGlobalKeyDown = (e) => {
      if (e.defaultPrevented) return;
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (isCtrlOrMeta) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setFontSize(prev => Math.min(32, prev + 1));
        } else if (e.key === '-') {
          e.preventDefault();
          setFontSize(prev => Math.max(9, prev - 1));
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);

    // Set up ResizeObserver to handle element size changes reactively
    const resizeObserver = new ResizeObserver(() => {
      if (terminalRef.current && fitAddonRef.current && statusRef.current === 'connected' && viewModeRef.current === 'terminal') {
        try {
          fitAddonRef.current.fit();
        } catch (err) {
          // Ignore dimensions failures when container has 0 height temporarily
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Cleanup on unmount - do NOT close socket/terminal since they are registered globally
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      resizeObserver.disconnect();
      if (el) {
        el.removeEventListener('contextmenu', handleContextMenu);
      }
      if (onRegisterSocket) {
        onRegisterSocket(tab.id, null);
      }
    };
  }, []);

  // Refit whenever terminal status shifts to connected (ensures prompt size maps correctly)
  useEffect(() => {
    if (status === 'connected' && terminalRef.current && fitAddonRef.current) {
      const performFit = () => {
        try {
          if (terminalRef.current && fitAddonRef.current) {
            fitAddonRef.current.fit();
            // Send active resize update to remote host
            const cols = terminalRef.current.cols;
            const rows = terminalRef.current.rows;
            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
          }
        } catch (err) {
          console.error('Post-connection resize alignment failed:', err);
        }
      };

      performFit();
      const timer = setTimeout(performFit, 100);
      const timerLong = setTimeout(performFit, 500);
      document.fonts.ready.then(performFit);

      return () => {
        clearTimeout(timer);
        clearTimeout(timerLong);
      };
    }
  }, [status]);

  // Refit terminal when switching views
  useEffect(() => {
    if (viewMode === 'terminal' && status === 'connected' && terminalRef.current && fitAddonRef.current) {
      const performFit = () => {
        try {
          if (terminalRef.current && fitAddonRef.current) {
            fitAddonRef.current.fit();
          }
        } catch (err) {
          // Ignore
        }
      };

      performFit();
      const timer = setTimeout(performFit, 50);
      document.fonts.ready.then(performFit);

      return () => clearTimeout(timer);
    }
  }, [viewMode, status]);

  const getTerminalText = () => {
    if (!terminalRef.current) return '';
    const term = terminalRef.current;
    const buffer = term.buffer.active;
    let text = '';
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        text += line.translateToString(true) + '\n';
      }
    }
    return text;
  };

  const handleSaveOutput = () => {
    const text = getTerminalText();
    if (!text) {
      alert("Console buffer is empty.");
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const cleanName = (tab.title || 'console').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `terminal_${cleanName}_${dateStr}.txt`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatMB = (mb) => {
    if (!mb) return '0 GB';
    if (mb < 1024) return `${mb} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  };

  const formatSpeed = (bytesPerSec) => {
    if (bytesPerSec === undefined || bytesPerSec === null) return '0 B/s';
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  return (
    <div className="terminal-wrapper">
      {status === 'connected' && (
        <div className="terminal-mode-selector">
          <div className="mode-selector-left">
            <button 
              className={`mode-btn ${viewMode === 'terminal' ? 'active' : ''}`}
              onClick={() => setViewMode('terminal')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Console
            </button>
            <button 
              className={`mode-btn ${viewMode === 'files' ? 'active' : ''}`}
              onClick={() => setViewMode('files')}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Files (SFTP)
            </button>
          </div>
          <div className="mode-selector-right">
            {viewMode === 'terminal' && (
              <>
                <button 
                  className="mode-btn action-btn-zoom-in"
                  onClick={() => setFontSize(prev => Math.min(32, prev + 1))}
                  title="Zoom In (Increase text size)"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                  </svg>
                  {!isSplit && <span>Zoom In</span>}
                </button>
                <button 
                  className="mode-btn action-btn-zoom-out"
                  onClick={() => setFontSize(prev => Math.max(9, prev - 1))}
                  title="Zoom Out (Decrease text size)"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" />
                  </svg>
                  {!isSplit && <span>Zoom Out</span>}
                </button>
                <button 
                  className="mode-btn action-btn-save"
                  onClick={handleSaveOutput}
                  title="Save terminal console buffer output to a file"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20" />
                  </svg>
                  <span>Save Output</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div 
        className="terminal-canvas" 
        ref={containerRef} 
        style={{ display: viewMode === 'terminal' ? 'block' : 'none' }} 
      />

      {viewMode === 'terminal' && status === 'connected' && stats && !isSplit && (
        <div className="terminal-metrics-bar">
          {/* CPU / Load Average */}
          <div className="metric-item load-metric">
            <span className="metric-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Load Avg
            </span>
            <span className="metric-val">{stats.load.load1.toFixed(2)} / {stats.load.load5.toFixed(2)} / {stats.load.load15.toFixed(2)}</span>
          </div>

          {/* Memory Usage */}
          <div className="metric-item memory-metric">
            <span className="metric-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 5h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2 2V7a2 2 0 012-2z" />
              </svg>
              RAM
            </span>
            <div className="metric-progress-wrapper">
              <div className="metric-progress-track">
                <div 
                  className="metric-progress-fill" 
                  style={{ width: `${Math.min(100, (stats.memory.used / stats.memory.total) * 100)}%` }} 
                />
              </div>
              <span className="metric-val">
                {formatMB(stats.memory.used)} / {formatMB(stats.memory.total)} ({((stats.memory.used / stats.memory.total) * 100).toFixed(1)}%)
              </span>
            </div>
          </div>

          {/* Disk Usage */}
          <div className="metric-item disk-metric">
            <span className="metric-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              Disk
            </span>
            <div className="metric-progress-wrapper">
              <div className="metric-progress-track">
                <div 
                  className="metric-progress-fill warning" 
                  style={{ width: `${Math.min(100, (stats.disk.used / stats.disk.total) * 100)}%` }} 
                />
              </div>
              <span className="metric-val">
                {formatMB(stats.disk.used)} / {formatMB(stats.disk.total)} ({((stats.disk.used / stats.disk.total) * 100).toFixed(1)}%)
              </span>
            </div>
          </div>

          {/* Network Usage */}
          <div className="metric-item network-metric">
            <span className="metric-label">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Net
            </span>
            <div className="metric-net-speeds">
              <span className="net-speed down">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                {formatSpeed(speeds.rxSpeed)}
              </span>
              <span className="net-speed up">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                {formatSpeed(speeds.txSpeed)}
              </span>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'files' && status === 'connected' && (
        <SftpExplorer tabId={tab.id} />
      )}
      
      {status === 'connecting' && (
        <div className="terminal-overlay">
          <div className="terminal-overlay-spinner" />
          <div className="terminal-overlay-title">Establishing Connection...</div>
          <div className="terminal-overlay-desc">
            Connecting to {tab.quickConnectDetails ? tab.quickConnectDetails.host : tab.title}
          </div>
        </div>
      )}

      {status === 'disconnected' && (
        <div className="terminal-overlay">
          <svg className="terminal-overlay-error-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="terminal-overlay-title">Connection Disconnected</div>
          {errorMsg && <div className="terminal-overlay-desc">{errorMsg}</div>}
          <button className="terminal-reconnect-btn" onClick={connectSSH}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 15H19" />
            </svg>
            Reconnect Session
          </button>
        </div>
      )}
    </div>
  );
}

const colorizeText = (text) => {
  if (!text) return text;
  
  const ansiRegex = /(\x1b\[[0-9;?]*[a-zA-Z])/g;
  const parts = text.split(ansiRegex);
  
  return parts.map((part) => {
    if (ansiRegex.test(part)) {
      return part;
    }
    
    let modified = part;
    
    // 1. Red keywords (Error, Fail, Failed, Failure, Critical) - matched anywhere
    modified = modified.replace(/(error|fail|critical)/gi, (match) => {
      return `\x1b[1;31m${match}\x1b[22;39m`;
    });
    
    // 2. Orange keywords (Warning, Worning) - matched anywhere, (warn, warned) - matched as whole words
    modified = modified.replace(/(warning|worning)/gi, (match) => {
      return `\x1b[38;5;208;1m${match}\x1b[22;39m`;
    });
    modified = modified.replace(/\b(warn|warned)\b/gi, (match) => {
      return `\x1b[38;5;208;1m${match}\x1b[22;39m`;
    });
    
    // 3. Green keywords (Success) - matched anywhere, (ok) - matched as whole word
    modified = modified.replace(/(success)/gi, (match) => {
      return `\x1b[1;32m${match}\x1b[22;39m`;
    });
    modified = modified.replace(/\b(ok)\b/gi, (match) => {
      return `\x1b[1;32m${match}\x1b[22;39m`;
    });
    
    return modified;
  }).join('');
};
