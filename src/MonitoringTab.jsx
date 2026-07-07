import React, { useEffect, useState, useRef } from 'react';
import { getSession, registerSession, destroySession } from './sessionRegistry';
import './App.css'; // Relies on shared styles
import './MonitoringTab.css'; // Monitoring specific styles

function MetricChart({ data, metricKey, color, label }) {
  if (!data || data.length === 0) {
    return <div className="no-data" style={{ padding: '10px', fontSize: '0.75rem' }}>No historical data available</div>;
  }

  const values = data.map(d => d[metricKey] !== undefined ? d[metricKey] : 0);
  const maxVal = 100;
  const points = values.map((val, idx) => {
    const x = (idx / Math.max(1, values.length - 1)) * 100;
    const y = 40 - (val / maxVal) * 40;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = points.length > 0 ? `M ${points[0]} ` + points.slice(1).map(p => `L ${p}`).join(' ') : '';
  const areaD = points.length > 0 ? `${pathD} L 100,40 L 0,40 Z` : '';

  return (
    <div className="metric-chart-container">
      <div className="chart-label">{label} History (Last {values.length}s)</div>
      <svg viewBox="0 0 100 40" className="metric-svg-chart" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${metricKey}-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="10" x2="100" y2="10" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
        <line x1="0" y1="20" x2="100" y2="20" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
        <line x1="0" y1="30" x2="100" y2="30" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
        {areaD && <path d={areaD} fill={`url(#grad-${metricKey}-${label})`} />}
        {pathD && <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </div>
  );
}

export default function MonitoringTab({ tab, connections, isActive, onOpenTerminal, onRefreshConnections }) {
  const existingSession = getSession(tab.id);
  const [status, setStatus] = useState(existingSession ? existingSession.status : 'connecting');
  const [errorMsg, setErrorMsg] = useState(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [deployLogs, setDeployLogs] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [agentStatus, setAgentStatus] = useState('connecting'); // connecting, connected, failed
  const [agentVersion, setAgentVersion] = useState('');
  const [spikes, setSpikes] = useState([]);
  const [spikeSearch, setSpikeSearch] = useState('');
  const [history, setHistory] = useState([]);
  const [dockerInstalled, setDockerInstalled] = useState(false);
  const [dockerContainers, setDockerContainers] = useState([]);
  const [showDeployContainerModal, setShowDeployContainerModal] = useState(false);
  const [deployName, setDeployName] = useState('');
  const [deployImage, setDeployImage] = useState('');
  const [deployPorts, setDeployPorts] = useState('');
  const [dockerSearch, setDockerSearch] = useState('');

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [tempKeywords, setTempKeywords] = useState('');
  const [tempShowAlertNotifications, setTempShowAlertNotifications] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  
  const [metrics, setMetrics] = useState({
    cpu: { usage: 0, load: '' },
    memory: { total: 0, used: 0, free: 0, percent: 0 },
    disk: { total: '', used: '', free: '', percent: 0, mount: '/' },
    services: []
  });

  const socketRef = useRef(null);
  const pollingTimerRef = useRef(null);

  const connection = (connections || []).find(c => c.id === tab.connectionId);

  // Parse commands output
  const parseMetrics = (results) => {
    if (!results || results.length < 4) return;
    
    // results[0]: top output or loadavg + cpu usage
    // Using simple command: top -b -n 1 | head -n 5
    // or better: mpstat if available, but let's use standard POSIX:
    // Command 1: cat /proc/stat (easier to parse for CPU%) + cat /proc/loadavg
    const cpuRaw = results[0];
    
    // Command 2: free -m
    const memRaw = results[1];
    let memData = { total: 0, used: 0, free: 0, percent: 0 };
    const memMatch = memRaw.match(/Mem:\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (memMatch) {
      memData.total = parseInt(memMatch[1], 10);
      memData.used = parseInt(memMatch[2], 10);
      memData.free = parseInt(memMatch[3], 10);
      if (memData.total > 0) {
        memData.percent = Math.round((memData.used / memData.total) * 100);
      }
    }

    // Command 3: df -h /
    const diskRaw = results[2];
    let diskData = { total: '0G', used: '0G', free: '0G', percent: 0, mount: '/' };
    const diskLines = diskRaw.split('\n');
    if (diskLines.length > 1) {
      const diskParts = diskLines[1].trim().split(/\s+/);
      if (diskParts.length >= 5) {
        diskData.total = diskParts[1];
        diskData.used = diskParts[2];
        diskData.free = diskParts[3];
        diskData.percent = parseInt(diskParts[4].replace('%', ''), 10);
        diskData.mount = diskParts[5];
      }
    }

    // Command 4: systemctl list-units --type=service --state=running --no-pager
    const svcRaw = results[3];
    const svcLines = svcRaw.split('\n').filter(l => l.includes('.service') && !l.includes('●'));
    const services = svcLines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0]?.replace('.service', ''),
        load: parts[1],
        active: parts[2],
        sub: parts[3],
        description: parts.slice(4).join(' ')
      };
    }).filter(s => s.name);

    // CPU calculations from /proc/stat
    const cpuLines = cpuRaw.split('\n');
    let cpuPercent = 0;
    let loadAvg = '';
    
    const loadAvgLine = cpuLines.find(l => l.includes('loadavg') || l.match(/^\d+\.\d+\s+\d+\.\d+/));
    if (loadAvgLine) {
       loadAvg = loadAvgLine.split(/\s+/).slice(0, 3).join(', ');
    }

    // Rough CPU % using top -b -n 1 if included
    const topCpuLine = cpuLines.find(l => l.includes('%Cpu(s):') || l.includes('Cpu(s):'));
    if (topCpuLine) {
       const cpuUsageMatch = topCpuLine.match(/(\d+\.\d+)\s*us/);
       const cpuSysMatch = topCpuLine.match(/(\d+\.\d+)\s*sy/);
       if (cpuUsageMatch && cpuSysMatch) {
         cpuPercent = Math.round(parseFloat(cpuUsageMatch[1]) + parseFloat(cpuSysMatch[1]));
       }
    }

    setMetrics({
      cpu: { usage: cpuPercent, load: loadAvg },
      memory: memData,
      disk: diskData,
      services: services
    });

    setHistory(prev => {
      const next = [...prev, { cpu: cpuPercent, mem: memData.percent, disk: diskData.percent, timestamp: new Date().toLocaleTimeString() }];
      if (next.length > 60) return next.slice(1);
      return next;
    });
  };

  const fetchMetrics = async () => {
    if (status !== 'connected') return;
    try {
      const cmds = [
        `cat /proc/loadavg; echo ""; top -b -n 1 | head -n 5`,
        `free -m`,
        `df -h /`,
        `systemctl list-units --type=service --state=running --no-pager | head -n 20`
      ];
      
      const res = await fetch('/api/monitoring/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: tab.id, connectionId: tab.connectionId, commands: cmds })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          parseMetrics(data.results);
          if (data.source) setDataSource(data.source);
        }
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  };

  const deployAgent = async () => {
    setIsDeploying(true);
    setShowDeployModal(true);
    setDeployLogs('');
    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.host;
      const wsUrl = `${wsProtocol}//${wsHost}`;
      
      const deployAsRoot = window.confirm(
        "Do you want to deploy the agent as a system-wide root service?\n\n" +
        "It will be installed to /opt/omicron-ops/.\n" +
        "(Note: Your active SSH session must have root privileges for this to work)."
      );

      const res = await fetch('/api/agent/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: tab.id, connectionId: tab.connectionId, wsUrl, deployAsRoot })
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setDeployLogs(prev => prev + chunk);
        if (chunk.includes('DONE')) {
          break;
        }
      }
    } catch (err) {
      setDeployLogs(prev => prev + `\nRequest failed: ${err.message}`);
    } finally {
      setIsDeploying(false);
      // Wait a moment then retry connecting to the agent
      setTimeout(connectAgent, 2000);
    }
  };

  const connectAgent = async () => {
    if (!connection) return;
    setAgentStatus('connecting');
    try {
      const res = await fetch('/api/agent/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: connection.host, connectionId: tab.connectionId })
      });
      const data = await res.json();
      if (data.success) {
        setAgentStatus('connected');
      } else {
        setAgentStatus('failed');
      }
    } catch (e) {
      setAgentStatus('failed');
    }
  };

  const connectSSH = () => {
    const existing = getSession(tab.id);
    if (existing) {
      if (existing.status !== 'disconnected') {
        socketRef.current = existing.socket;
        setStatus(existing.status);
        return;
      }
    }

    setStatus('connecting');
    setErrorMsg(null);

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    registerSession(tab.id, {
      socket,
      status: 'connecting'
    });

    socket.onopen = () => {
      const initPayload = {
        type: 'init',
        tabId: tab.id,
        connectionId: tab.connectionId,
        cols: 80,
        rows: 24,
        hideStats: true
      };
      socket.send(JSON.stringify(initPayload));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status') {
          setStatus(msg.status);
          const sess = getSession(tab.id);
          if (sess) sess.status = msg.status;
          if (msg.error) setErrorMsg(msg.error);
        } else if (msg.type === 'vm-resource-utilization-info' && msg.source === 'agent') {
          setDataSource('agent');
          const d = msg.data;
          if (d && d.version) {
            setAgentVersion(d.version);
          }
          setMetrics(prev => ({
            ...prev,
            cpu: { usage: Math.round(d.cpu_usage || 0), load: `${(d.load_avg_1 || 0).toFixed(2)}, ${(d.load_avg_5 || 0).toFixed(2)}, ${(d.load_avg_15 || 0).toFixed(2)}` },
            memory: { total: d.mem_total, used: d.mem_used, free: d.mem_free, percent: Math.round(d.mem_percent || 0) },
            disk: { total: `${d.disk_total}G`, used: `${d.disk_used}G`, free: `${d.disk_free}G`, percent: Math.round(d.disk_percent || 0), mount: '/' },
            // services: Keep previous services array for now
          }));
          setHistory(prev => {
            const next = [...prev, { cpu: d.cpu_usage || 0, mem: d.mem_percent || 0, disk: d.disk_percent || 0, timestamp: new Date().toLocaleTimeString() }];
            if (next.length > 60) return next.slice(1);
            return next;
          });
          if (fetchSpikesRef.current) {
            fetchSpikesRef.current();
          }
        } else if (msg.type === 'vm-docker-status') {
          const d = msg.data;
          if (d) {
            setDockerInstalled(d.installed);
            setDockerContainers(d.list || []);
          }
        }
      } catch (err) {
        // ignore data messages
      }
    };

    socket.onerror = (err) => {
      setStatus('disconnected');
    };

    socket.onclose = () => {
      setStatus('disconnected');
    };
  };

  const fetchSpikesRef = useRef();

  const fetchSpikes = async () => {
    if (!tab.connectionId) return;
    try {
      const res = await fetch(`/api/monitoring/spikes?connectionId=${tab.connectionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSpikes(data.spikes || []);
        }
      }
    } catch (e) {
      console.error('Failed to fetch spikes:', e);
    }
  };

  const fetchHistory = async () => {
    if (!tab.connectionId) return;
    try {
      const res = await fetch(`/api/monitoring/history?connectionId=${tab.connectionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setHistory(data.history || []);
        }
      }
    } catch (e) {
      console.error('Failed to fetch metrics history:', e);
    }
  };

  const fetchDockerStatus = async () => {
    if (!tab.connectionId) return;
    try {
      const res = await fetch(`/api/monitoring/docker?connectionId=${tab.connectionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setDockerInstalled(data.installed);
          setDockerContainers(data.list || []);
        }
      }
    } catch (e) {
      console.error('Failed to fetch Docker status:', e);
    }
  };

  const handleDockerAction = (action, containerId) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'docker-action',
        action,
        containerId,
        connectionId: tab.connectionId
      }));
    }
  };

  const handleDockerDeploy = (name, image, ports) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'docker-deploy',
        name,
        image,
        ports,
        connectionId: tab.connectionId
      }));
    }
  };

  useEffect(() => {
    fetchSpikesRef.current = fetchSpikes;
  });

  useEffect(() => {
    if (status === 'connected') {
      fetchSpikes();
      fetchHistory();
      fetchDockerStatus();
      
      const interval = setInterval(() => {
        fetchSpikes();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [status, tab.connectionId]);

  useEffect(() => {
    if (agentStatus === 'connected') {
      fetchDockerStatus();
    }
  }, [agentStatus]);

  useEffect(() => {
    connectSSH();
    connectAgent();
    return () => {
       // Do not destroy session on unmount, let App.jsx handle it on close tab
       if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    // Only fetch once as fallback if SSH is connected and agent is not active yet
    if (status === 'connected' && isActive && dataSource !== 'agent') {
      fetchMetrics();
    }
  }, [status, isActive, dataSource]);

  useEffect(() => {
    if (connection) {
      setTempKeywords(connection.syslogKeywords || 'error,critical,panic,fatal,failed');
      setTempShowAlertNotifications(connection.showAlertNotifications !== false);
    }
  }, [connection, showSettingsModal]);

  const handleSaveSettings = async () => {
    if (!connection) return;
    setIsSavingSettings(true);
    try {
      const res = await fetch(`/api/connections/${connection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syslogKeywords: tempKeywords, showAlertNotifications: tempShowAlertNotifications })
      });
      if (res.ok) {
        if (onRefreshConnections) {
          await onRefreshConnections();
        }
        setShowSettingsModal(false);
      } else {
        const errData = await res.json();
        alert(errData.error || 'Failed to save settings');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save settings: ' + e.message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const getColorClass = (percent) => {
    if (percent < 50) return 'progress-good';
    if (percent < 80) return 'progress-warn';
    return 'progress-danger';
  };

  return (
    <div className="monitoring-tab">
      {status === 'connecting' && (
        <div className="monitoring-overlay">
          <div className="spinner"></div>
          <p>Establishing Secure Connection...</p>
        </div>
      )}
      {status === 'disconnected' && (
        <div className="monitoring-overlay error">
          <p>Connection Lost.</p>
          {errorMsg && <p className="error-text">{errorMsg}</p>}
          <button className="btn primary" onClick={connectSSH}>Reconnect</button>
        </div>
      )}

      {status === 'connected' && (
        <div className="monitoring-dashboard">
          <div className={`agent-status-bar ${agentStatus}`}>
            <div className="status-text">
              {agentStatus === 'connecting' && <span><span className="spinner small" style={{display: 'inline-block', width: '12px', height: '12px', marginRight: '8px', borderWidth: '2px'}}></span> Connecting to Agent...</span>}
              {agentStatus === 'connected' && <span><span className="dot pulse"></span> Agent Live on {connection?.host}:44333 {agentVersion ? `(v${agentVersion})` : ''}</span>}
              {agentStatus === 'failed' && <span>⚠️ Agent Offline or Unreachable.</span>}
            </div>
          </div>
          <div className="dashboard-header">
            <div>
              <h2>{connection?.name || 'Server'} Monitoring</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Connected to {connection?.host}:{connection?.port}
              </span>
            </div>
            <div className="live-indicator">
              <span className="dot pulse"></span> Live {dataSource ? `(${dataSource === 'agent' ? 'Agent' : 'SSH'})` : ''}
              <button 
                className="console-btn" 
                onClick={() => onOpenTerminal && connection && onOpenTerminal(connection)}
              >
                Open Terminal
              </button>
              <button 
                className="console-btn settings-btn" 
                onClick={() => setShowSettingsModal(true)}
                style={{ marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Settings
              </button>
            </div>
          </div>

          <div className="metrics-grid">
            {/* CPU Card */}
            <div className="metric-card glass-panel">
              <div className="metric-header">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
                <h3>CPU Usage</h3>
              </div>
              <div className="metric-body">
                <div className="metric-large">{metrics.cpu.usage}%</div>
                <div className="progress-track">
                  <div className={`progress-fill ${getColorClass(metrics.cpu.usage)}`} style={{ width: `${metrics.cpu.usage}%` }}></div>
                </div>
                <MetricChart data={history} metricKey="cpu" color="#a855f7" label="CPU" />
                <div className="metric-footer">
                  <span>Load Avg: {metrics.cpu.load || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* RAM Card */}
            <div className="metric-card glass-panel">
              <div className="metric-header">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="12" x2="2" y2="12"></line><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" y1="16" x2="6.01" y2="16"></line><line x1="10" y1="16" x2="10.01" y2="16"></line></svg>
                <h3>Memory (RAM)</h3>
              </div>
              <div className="metric-body">
                <div className="metric-large">{metrics.memory.percent}%</div>
                <div className="progress-track">
                  <div className={`progress-fill ${getColorClass(metrics.memory.percent)}`} style={{ width: `${metrics.memory.percent}%` }}></div>
                </div>
                <MetricChart data={history} metricKey="mem" color="#06b6d4" label="Memory" />
                <div className="metric-footer">
                  <span>{metrics.memory.used} MB / {metrics.memory.total} MB</span>
                </div>
              </div>
            </div>

            {/* Disk Card */}
            <div className="metric-card glass-panel">
              <div className="metric-header">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12H2"></path><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" y1="16" x2="6.01" y2="16"></line><line x1="10" y1="16" x2="10.01" y2="16"></line></svg>
                <h3>Root Disk (/)</h3>
              </div>
              <div className="metric-body">
                <div className="metric-large">{metrics.disk.percent}%</div>
                <div className="progress-track">
                  <div className={`progress-fill ${getColorClass(metrics.disk.percent)}`} style={{ width: `${metrics.disk.percent}%` }}></div>
                </div>
                <MetricChart data={history} metricKey="disk" color="#10b981" label="Disk" />
                <div className="metric-footer">
                  <span>{metrics.disk.used} / {metrics.disk.total}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="dashboard-columns">
            {/* Left Column: Spikes Log */}
            <div className="spikes-section glass-panel">
              <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <h3>Utilization Spikes & Anomalies</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="text"
                    className="spikes-search-input"
                    placeholder="Search spikes..."
                    value={spikeSearch}
                    onChange={(e) => setSpikeSearch(e.target.value)}
                  />
                  <span className="badge danger">
                    {spikes.filter(s => {
                      const t = spikeSearch.toLowerCase();
                      return s.description.toLowerCase().includes(t) || s.spike_type.toLowerCase().includes(t) || s.timestamp.toLowerCase().includes(t);
                    }).length} / {spikes.length}
                  </span>
                </div>
              </div>
              <div className="spikes-list">
                {spikes.length === 0 ? (
                  <div className="no-data">No spikes or anomalies recorded.</div>
                ) : spikes.filter(s => {
                  const t = spikeSearch.toLowerCase();
                  return s.description.toLowerCase().includes(t) || s.spike_type.toLowerCase().includes(t) || s.timestamp.toLowerCase().includes(t);
                }).length === 0 ? (
                  <div className="no-data">No matching spikes found.</div>
                ) : (
                  <div className="spikes-scroll-area">
                    {spikes.filter(s => {
                      const t = spikeSearch.toLowerCase();
                      return s.description.toLowerCase().includes(t) || s.spike_type.toLowerCase().includes(t) || s.timestamp.toLowerCase().includes(t);
                    }).map((spike) => (
                      <div key={spike.id} className={`spike-item ${spike.spike_type}`}>
                        <div className="spike-time">{spike.timestamp}</div>
                        <div className="spike-desc">{spike.description}</div>
                        {spike.spike_type !== 'syslog_alert' ? (
                          <div className="spike-metrics">
                            <span>CPU: {Math.round(spike.cpu_usage)}%</span>
                            <span>Mem: {Math.round(spike.mem_percent)}%</span>
                            <span>Disk: {Math.round(spike.disk_percent)}%</span>
                          </div>
                        ) : (
                          <div className="spike-metrics">
                            <span style={{ color: '#fbbf24', fontSize: '0.75rem', fontWeight: 'bold' }}>Source: System Logs</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Active Services */}
            <div className="services-section glass-panel">
              <div className="section-header">
                <h3>Active Services (Systemd)</h3>
                <span className="badge">{metrics.services.length} Running</span>
              </div>
              <div className="services-list">
                {metrics.services.length === 0 ? (
                  <div className="no-data">Fetching services...</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Service Name</th>
                        <th>Status</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.services.map((svc, idx) => (
                        <tr key={idx}>
                          <td className="svc-name">{svc.name}</td>
                          <td><span className="status-badge running">{svc.sub}</span></td>
                          <td className="svc-desc">{svc.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Docker Containers Section */}
          <div className="services-section glass-panel" style={{ marginTop: '20px' }}>
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3>Docker Containers</h3>
                {dockerInstalled && (
                  <span className="badge">{dockerContainers.length} total</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {dockerInstalled && dockerContainers.length > 0 && (
                  <input
                    type="text"
                    className="docker-search-input"
                    placeholder="Search containers..."
                    value={dockerSearch}
                    onChange={(e) => setDockerSearch(e.target.value)}
                  />
                )}
                {dockerInstalled && (
                  <button 
                    className="monitoring-action-btn accent" 
                    onClick={() => setShowDeployContainerModal(true)}
                  >
                    + Deploy
                  </button>
                )}
              </div>
            </div>
            
            {!dockerInstalled ? (
              <div className="no-data" style={{ padding: '20px 0', color: 'var(--text-muted)' }}>
                Docker is not installed on this VM.
              </div>
            ) : (
              <div className="services-list" style={{ marginTop: '10px', maxHeight: '400px', overflowY: 'auto' }}>
                {dockerContainers.length === 0 ? (
                  <div className="no-data">No containers found.</div>
                ) : (() => {
                  const term = dockerSearch.toLowerCase();
                  const filtered = dockerContainers.filter(c =>
                    c.name.toLowerCase().includes(term) ||
                    c.image.toLowerCase().includes(term) ||
                    c.id.toLowerCase().includes(term) ||
                    c.status.toLowerCase().includes(term)
                  );
                  return filtered.length === 0 ? (
                    <div className="no-data">No containers match &quot;{dockerSearch}&quot;</div>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Name</th>
                          <th>Image</th>
                          <th>Status</th>
                          <th>Ports</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((c) => {
                          const isRunning = c.state === 'running';
                          return (
                            <tr key={c.id}>
                              <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.id.slice(0, 12)}</td>
                              <td style={{ fontWeight: '600' }}>{c.name}</td>
                              <td>{c.image}</td>
                              <td>
                                <span className={`status-badge ${isRunning ? 'running' : 'failed'}`}>
                                  {c.status}
                                </span>
                              </td>
                              <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.ports || '-'}</td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                  {!isRunning ? (
                                    <button className="monitoring-action-btn success" onClick={() => handleDockerAction('start', c.id)}>Start</button>
                                  ) : (
                                    <button className="monitoring-action-btn" onClick={() => handleDockerAction('stop', c.id)}>Stop</button>
                                  )}
                                  <button className="monitoring-action-btn" onClick={() => handleDockerAction('restart', c.id)}>Restart</button>
                                  <button 
                                    className="monitoring-action-btn danger" 
                                    onClick={() => {
                                      if (window.confirm(`Are you sure you want to remove container ${c.name}?`)) {
                                        handleDockerAction('remove', c.id);
                                      }
                                    }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deploy Container Modal */}
      {showDeployContainerModal && (
        <div className="modal-overlay open" style={{ zIndex: 110 }}>
          <div className="modal-container glass-panel" style={{ width: '450px', maxWidth: '90%' }}>
            <div className="modal-header">
              <div className="modal-title">Deploy New Docker Container</div>
              <button className="modal-close-btn" onClick={() => setShowDeployContainerModal(false)}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '15px', padding: '10px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontWeight: '600', fontSize: '0.85rem', color: 'var(--text-primary)' }}>Image Name *</label>
                <input type="text" className="monitoring-input" value={deployImage} onChange={(e) => setDeployImage(e.target.value)} placeholder="e.g., nginx:alpine" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontWeight: '600', fontSize: '0.85rem', color: 'var(--text-primary)' }}>Container Name</label>
                <input type="text" className="monitoring-input" value={deployName} onChange={(e) => setDeployName(e.target.value)} placeholder="e.g., my-web-app" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontWeight: '600', fontSize: '0.85rem', color: 'var(--text-primary)' }}>Port Mappings</label>
                <input type="text" className="monitoring-input" value={deployPorts} onChange={(e) => setDeployPorts(e.target.value)} placeholder="e.g., 8080:80" />
              </div>
            </div>
            <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="monitoring-action-btn" onClick={() => setShowDeployContainerModal(false)}>Cancel</button>
              <button 
                className="monitoring-action-btn accent" 
                onClick={() => {
                  if (!deployImage) { alert('Image Name is required'); return; }
                  handleDockerDeploy(deployName, deployImage, deployPorts);
                  setShowDeployContainerModal(false);
                  setDeployName(''); setDeployImage(''); setDeployPorts('');
                }}
              >
                Deploy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deploy Agent Console Modal */}
      {showDeployModal && (
        <div className="modal-overlay open" style={{ zIndex: 100 }}>
          <div className="modal-container glass-panel" style={{ width: '600px', maxWidth: '90%' }}>
            <div className="modal-header">
              <div className="modal-title">Deploying Agent...</div>
              {!isDeploying && (
                <button className="modal-close-btn" onClick={() => setShowDeployModal(false)}>
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="modal-body" style={{ background: '#000', padding: '16px', borderRadius: '8px', minHeight: '300px', maxHeight: '500px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem', color: '#a5b4fc', whiteSpace: 'pre-wrap' }}>
              {deployLogs || 'Initializing...'}
            </div>
            <div className="modal-footer" style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                className="btn primary" 
                onClick={() => setShowDeployModal(false)}
                disabled={isDeploying}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="modal-overlay open" style={{ zIndex: 90 }}>
          <div className="modal-container glass-panel" style={{ width: '500px', maxWidth: '95%' }}>
            <div className="modal-header">
              <div className="modal-title">Monitoring Settings</div>
              <button className="modal-close-btn" onClick={() => setShowSettingsModal(false)}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px 0' }}>
              
              {/* Syslog Monitoring Settings */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  Syslog Alerting Keywords
                </label>
                <input 
                  type="text" 
                  className="monitoring-input"
                  value={tempKeywords} 
                  onChange={(e) => setTempKeywords(e.target.value)}
                  placeholder="error,critical,panic,fatal,failed"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Comma-separated keywords to scan in the VM's syslog. Matched entries will trigger persistent global notifications.
                </span>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '0' }} />

              {/* Alert Notifications Toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    Show Alert Notifications
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Display spike and syslog alerts as toast notifications on the right side of the screen.
                  </span>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={tempShowAlertNotifications} 
                    onChange={(e) => setTempShowAlertNotifications(e.target.checked)} 
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '0' }} />

              {/* Agent Operations */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    Agent Operations
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Status: <strong style={{ color: agentStatus === 'connected' ? '#10b981' : '#f59e0b' }}>
                      {agentStatus === 'connected' ? `Connected (v${agentVersion || '1.0.0'})` : 'Offline'}
                    </strong>
                  </span>
                </div>
                
                <div style={{ display: 'flex', gap: '10px' }}>
                  {agentStatus === 'connected' ? (
                    <button 
                      className="monitoring-action-btn" 
                      onClick={() => {
                        setShowSettingsModal(false);
                        deployAgent();
                      }} 
                      disabled={isDeploying}
                      style={{ flex: 1 }}
                    >
                      {isDeploying ? 'Deploying...' : 'Re-deploy Agent'}
                    </button>
                  ) : (
                    <button 
                      className="monitoring-action-btn accent" 
                      onClick={() => {
                        setShowSettingsModal(false);
                        deployAgent();
                      }} 
                      disabled={isDeploying}
                      style={{ flex: 1 }}
                    >
                      {isDeploying ? 'Deploying...' : 'Copy Latest Client and Start Service'}
                    </button>
                  )}
                </div>
              </div>

            </div>
            
            <div className="modal-footer" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button 
                className="monitoring-action-btn" 
                onClick={() => setShowSettingsModal(false)}
                disabled={isSavingSettings}
              >
                Cancel
              </button>
              <button 
                className="monitoring-action-btn accent" 
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
              >
                {isSavingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
