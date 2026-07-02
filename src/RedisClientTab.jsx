import React, { useState, useEffect, useRef } from 'react';

function parseSlaves(serverInfo) {
  if (!serverInfo) return [];
  const slaves = [];
  const slaveKeyRegex = /^slave\d+$/;
  const ipRegex = /ip=([^,]+)/;
  const portRegex = /port=([^,]+)/;
  const stateRegex = /state=([^,]+)/;

  Object.keys(serverInfo).forEach(k => {
    if (slaveKeyRegex.test(k)) {
      const val = serverInfo[k];
      const ipMatch = val.match(ipRegex);
      const portMatch = val.match(portRegex);
      const stateMatch = val.match(stateRegex);
      if (ipMatch) {
        slaves.push(`${ipMatch[1]}:${portMatch ? portMatch[1] : '6379'} (${stateMatch ? stateMatch[1] : '?'})`);
      }
    }
  });
  return slaves;
}

export function RedisView({ connection, tabId }) {
  const redisConfig = connection?.services?.redis || {};
  
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  const initialDatabases = {};
  for (let i = 0; i < 16; i++) {
    initialDatabases[`db${i}`] = {};
  }
  const [databases, setDatabases] = useState(initialDatabases);
  const [keyspaceCounts, setKeyspaceCounts] = useState({});

  const [activeDb, setActiveDb] = useState('db0');
  const [expandedDbs, setExpandedDbs] = useState(new Set());
  const [dbFilters, setDbFilters] = useState({});

  const [selectedKey, setSelectedKey] = useState(null);
  const [selectedDb, setSelectedDb] = useState('db0');
  const [selectedKeyInfo, setSelectedKeyInfo] = useState(null);
  const [isValueLoading, setIsValueLoading] = useState(false);
  const [keyFetchError, setKeyFetchError] = useState(null);

  // Key actions / additions
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newKeyData, setNewKeyData] = useState({ name: '', type: 'string', value: '', ttl: '-1' });
  const [newHashField, setNewHashField] = useState({ field: '', value: '' });
  const [editingHashField, setEditingHashField] = useState(null); // { originalField: string, field: string, value: string }
  const [hashSearchQuery, setHashSearchQuery] = useState('');
  const [newListItem, setNewListItem] = useState('');
  const [newZSetItem, setNewZSetItem] = useState({ member: '', score: '0' });
  const [localStringValue, setLocalStringValue] = useState('');

  // CLI State
  const [cmdText, setCmdText] = useState('');
  const [cliOutput, setCliOutput] = useState([
    { type: 'info', text: 'Connected to Redis server.' },
    { type: 'info', text: 'Type HELP for a list of supported CLI commands...' }
  ]);

  const cliEndRef = useRef(null);

  // Resizing and tree states
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [expandedNamespaces, setExpandedNamespaces] = useState(new Set());
  const [serverInfo, setServerInfo] = useState(null);
  const [isCliExpanded, setIsCliExpanded] = useState(true);
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(true);

  const handleSidebarMouseDown = (e) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingSidebar) return;
      const newWidth = e.clientX;
      if (newWidth > 180 && newWidth < 600) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };

    if (isResizingSidebar) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  const toggleNamespace = (dbName, path) => {
    const nsId = `${dbName}:${path}`;
    setExpandedNamespaces(prev => {
      const next = new Set(prev);
      if (next.has(nsId)) {
        next.delete(nsId);
      } else {
        next.add(nsId);
      }
      return next;
    });
  };

  const fetchServerInfo = async () => {
    if (!tabId) return;
    try {
      const res = await fetch('/api/db/redis/server-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setServerInfo(data.info);
      }
    } catch (err) {
      console.error('Failed to fetch Redis server info:', err);
    }
  };

  useEffect(() => {
    if (cliEndRef.current) {
      cliEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cliOutput]);

  const handleConnect = async () => {
    if (!tabId) {
      setConnectionError('No active SSH session. Please open a terminal tab session first.');
      return;
    }
    setIsConnecting(true);
    setConnectionError(null);
    try {
      const res = await fetch('/api/db/redis/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Connection failed');
      }
      setIsConnected(true);
      if (data.keyspace) {
        setKeyspaceCounts(data.keyspace);
      }
      
      // Fetch server info
      fetchServerInfo();
    } catch (err) {
      console.error(err);
      setConnectionError(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setSelectedKey(null);
    setSelectedKeyInfo(null);
    setKeyspaceCounts({});
    setExpandedDbs(new Set());
    setExpandedNamespaces(new Set());
    setServerInfo(null);
    setDatabases(initialDatabases);
    setConnectionError(null);
  };

  const fetchDbKeys = async (dbName, filter = '') => {
    if (!tabId) return;
    const dbIndex = parseInt(dbName.replace('db', ''), 10);
    try {
      const res = await fetch('/api/db/redis/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection, dbIndex, filter })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDatabases(prev => ({
          ...prev,
          [dbName]: data.keys || {}
        }));
        setKeyspaceCounts(prev => ({
          ...prev,
          [dbName]: Object.keys(data.keys || {}).length
        }));
      }
    } catch (err) {
      console.error(`Failed to fetch keys for ${dbName}:`, err);
    }
  };

  const fetchKeyspaceInfo = async () => {
    if (!tabId) return;
    try {
      const res = await fetch('/api/db/redis/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setKeyspaceCounts(data.keyspace || {});
      }
    } catch (err) {
      console.error('Failed to fetch keyspace info:', err);
    }
  };

  const fetchKeyValue = async (dbName, keyName, type) => {
    if (!tabId) return;
    setIsValueLoading(true);
    setKeyFetchError(null);
    const dbIndex = parseInt(dbName.replace('db', ''), 10);
    try {
      const res = await fetch('/api/db/redis/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId, connection, dbIndex, key: keyName, type })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch key value');
      }
      
      const ttlVal = databases[dbName]?.[keyName]?.ttl ?? -1;
      
      setSelectedKeyInfo({
        type,
        ttl: ttlVal,
        value: data.value
      });
      
      if (type === 'string') {
        setLocalStringValue(data.value);
      }
    } catch (err) {
      console.error(err);
      setKeyFetchError(err.message);
    } finally {
      setIsValueLoading(false);
    }
  };

  useEffect(() => {
    setEditingHashField(null);
    setHashSearchQuery('');
    if (selectedKey && selectedDb) {
      const dbKeys = databases[selectedDb] || {};
      const keyInfo = dbKeys[selectedKey];
      if (keyInfo) {
        fetchKeyValue(selectedDb, selectedKey, keyInfo.type);
        // Collapse both panels to prioritize value showing panel
        setIsCliExpanded(false);
        setIsOverviewExpanded(false);
      }
    }
  }, [selectedKey, selectedDb]);

  const toggleDbExpanded = (dbName) => {
    setExpandedDbs(prev => {
      const next = new Set(prev);
      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
        fetchDbKeys(dbName, dbFilters[dbName] || '');
      }
      return next;
    });
  };

  const handleDbFilterChange = (dbName, val) => {
    setDbFilters(prev => ({ ...prev, [dbName]: val }));
    fetchDbKeys(dbName, val);
  };

  const executeRedisUpdate = async (dbName, action, key, payload = {}) => {
    if (!tabId) return { success: false };
    const dbIndex = parseInt(dbName.replace('db', ''), 10);
    try {
      const res = await fetch('/api/db/redis/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId,
          connection,
          dbIndex,
          action,
          key,
          ...payload
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Update failed');
      }
      
      // Refresh database keys tree
      fetchDbKeys(dbName, dbFilters[dbName] || '');
      
      if (selectedKey === key && selectedDb === dbName) {
        if (action === 'delete-key') {
          setSelectedKey(null);
          setSelectedKeyInfo(null);
        } else {
          const type = selectedKeyInfo?.type || databases[dbName]?.[key]?.type;
          if (type) {
            fetchKeyValue(dbName, key, type);
          }
        }
      }
      return { success: true };
    } catch (err) {
      console.error('Redis Update Error:', err);
      alert(`Error: ${err.message}`);
      return { success: false, error: err.message };
    }
  };

  const handleUpdateTtl = async (newTtlStr) => {
    const ttlVal = parseInt(newTtlStr, 10);
    if (isNaN(ttlVal)) return;
    const res = await executeRedisUpdate(selectedDb, 'set-ttl', selectedKey, { ttl: ttlVal });
    if (res.success) {
      setSelectedKeyInfo(prev => prev ? { ...prev, ttl: ttlVal } : null);
    }
  };

  const handleUpdateStringValue = (newValue) => {
    executeRedisUpdate(selectedDb, 'set-string', selectedKey, { value: newValue });
  };

  const handleRenameHashField = async (oldField, newField) => {
    if (oldField === newField) return;
    const val = selectedKeyInfo?.value?.[oldField];
    await executeRedisUpdate(selectedDb, 'hash-del', selectedKey, { field: oldField });
    await executeRedisUpdate(selectedDb, 'hash-set', selectedKey, { field: newField, value: val });
  };

  const handleSaveHashField = async (originalField, newField, newValue) => {
    if (!newField.trim()) {
      alert("Field name cannot be empty.");
      return;
    }
    const cleanNewField = newField.trim();
    if (originalField !== cleanNewField) {
      const delRes = await executeRedisUpdate(selectedDb, 'hash-del', selectedKey, { field: originalField });
      if (delRes.success) {
        await executeRedisUpdate(selectedDb, 'hash-set', selectedKey, { field: cleanNewField, value: newValue });
      }
    } else {
      await executeRedisUpdate(selectedDb, 'hash-set', selectedKey, { field: cleanNewField, value: newValue });
    }
    setEditingHashField(null);
  };

  const handleUpdateHashField = (field, value) => {
    executeRedisUpdate(selectedDb, 'hash-set', selectedKey, { field, value });
  };

  const handleAddHashField = (e) => {
    e.preventDefault();
    if (!newHashField.field.trim()) return;
    executeRedisUpdate(selectedDb, 'hash-set', selectedKey, { field: newHashField.field.trim(), value: newHashField.value });
    setNewHashField({ field: '', value: '' });
  };

  const handleDeleteHashField = (field) => {
    if (window.confirm(`Delete field "${field}"?`)) {
      executeRedisUpdate(selectedDb, 'hash-del', selectedKey, { field });
    }
  };

  const handleUpdateListItem = (index, value) => {
    executeRedisUpdate(selectedDb, 'list-set', selectedKey, { index, value });
  };

  const handleAddListItem = (e) => {
    e.preventDefault();
    if (!newListItem.trim()) return;
    const action = selectedKeyInfo.type === 'list' ? 'list-push' : 'set-add';
    executeRedisUpdate(selectedDb, action, selectedKey, { value: newListItem.trim() });
    setNewListItem('');
  };

  const handleDeleteListItem = (indexOrItem) => {
    if (selectedKeyInfo.type === 'list') {
      executeRedisUpdate(selectedDb, 'list-del', selectedKey, { index: indexOrItem });
    } else {
      const memberVal = selectedKeyInfo.value[indexOrItem];
      executeRedisUpdate(selectedDb, 'set-rem', selectedKey, { value: memberVal });
    }
  };

  const handleUpdateZSetItem = async (index, changeType, newVal) => {
    const item = selectedKeyInfo?.value?.[index];
    if (!item) return;
    
    if (changeType === 'score') {
      const scoreNum = parseFloat(newVal);
      if (isNaN(scoreNum)) return;
      executeRedisUpdate(selectedDb, 'zset-add', selectedKey, { score: scoreNum, value: item.member });
    } else {
      if (newVal.trim() === item.member) return;
      await executeRedisUpdate(selectedDb, 'zset-rem', selectedKey, { value: item.member });
      await executeRedisUpdate(selectedDb, 'zset-add', selectedKey, { score: item.score, value: newVal.trim() });
    }
  };

  const handleAddZSetItem = (e) => {
    e.preventDefault();
    if (!newZSetItem.member.trim()) return;
    const scoreNum = parseFloat(newZSetItem.score) || 0;
    executeRedisUpdate(selectedDb, 'zset-add', selectedKey, { score: scoreNum, value: newZSetItem.member.trim() });
    setNewZSetItem({ member: '', score: '0' });
  };

  const handleDeleteZSetItem = (index) => {
    const item = selectedKeyInfo?.value?.[index];
    if (item) {
      executeRedisUpdate(selectedDb, 'zset-rem', selectedKey, { value: item.member });
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    const name = newKeyData.name.trim();
    const type = newKeyData.type;
    const value = newKeyData.value;
    const ttlVal = parseInt(newKeyData.ttl, 10) || -1;
    
    if (!name) return;
    
    let action = 'set-string';
    let payload = { value };
    
    if (type === 'hash') {
      action = 'hash-set';
      let field = 'data';
      let val = value;
      try {
        const obj = JSON.parse(value);
        if (typeof obj === 'object' && obj !== null) {
          const keys = Object.keys(obj);
          if (keys.length > 0) {
            field = keys[0];
            val = typeof obj[field] === 'object' ? JSON.stringify(obj[field]) : String(obj[field]);
          }
        }
      } catch (err) {
        // Fallback to simple values
      }
      payload = { field, value: val };
    } else if (type === 'list') {
      action = 'list-push';
      payload = { value };
    } else if (type === 'set') {
      action = 'set-add';
      payload = { value };
    } else if (type === 'zset') {
      action = 'zset-add';
      payload = { score: 0, value };
    }
    
    const res = await executeRedisUpdate(activeDb, action, name, payload);
    if (res.success) {
      if (ttlVal !== -1) {
        await executeRedisUpdate(activeDb, 'set-ttl', name, { ttl: ttlVal });
      }
      
      setIsAddOpen(false);
      setNewKeyData({ name: '', type: 'string', value: '', ttl: '-1' });
      setSelectedDb(activeDb);
      setSelectedKey(name);
      fetchKeyValue(activeDb, name, type);
    }
  };

  const handleDeleteKey = async (dbName, keyName) => {
    if (window.confirm(`Are you sure you want to delete key "${keyName}"?`)) {
      await executeRedisUpdate(dbName, 'delete-key', keyName);
    }
  };

  const handleCliSubmit = async (e) => {
    e.preventDefault();
    const cmd = cmdText.trim();
    if (!cmd) return;
    setCmdText('');
    
    setCliOutput(prev => [...prev, { type: 'input', text: `127.0.0.1:6379[${activeDb.replace('db', '')}]> ${cmd}` }]);
    
    if (!tabId) return;
    try {
      const res = await fetch('/api/db/redis/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId,
          connection,
          dbIndex: parseInt(activeDb.replace('db', ''), 10),
          command: cmd
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'CLI Command execution failed');
      }
      
      // Clean warning messages from stderr
      let cleanStderr = (data.stderr || '').trim();
      if (cleanStderr.includes("Warning: Using a password")) {
        cleanStderr = cleanStderr.split('\n').filter(line => !line.includes("Warning: Using a password")).join('\n').trim();
      }

      let outText = '';
      let outType = 'response';
      if (cleanStderr) {
        outText = cleanStderr;
        outType = 'error';
      } else {
        outText = data.stdout || '(nil)';
      }
      
      setCliOutput(prev => [...prev, { type: outType, text: outText }]);
      
      fetchDbKeys(activeDb, dbFilters[activeDb] || '');
      fetchKeyspaceInfo();
      fetchServerInfo();
    } catch (err) {
      setCliOutput(prev => [...prev, { type: 'error', text: `Error: ${err.message}` }]);
    }
  };

  const buildKeyTree = (keysObj) => {
    const root = { name: 'root', children: {}, keys: [] };
    
    Object.keys(keysObj).forEach(keyName => {
      const keyInfo = keysObj[keyName];
      const parts = keyName.split(':');
      let current = root;
      
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            path: parts.slice(0, index + 1).join(':'),
            children: {},
            isLeaf: isLast,
            keyName: isLast ? keyName : null,
            type: isLast ? keyInfo.type : null
          };
        } else if (isLast) {
          current.children[part].isLeaf = true;
          current.children[part].keyName = keyName;
          current.children[part].type = keyInfo.type;
        }
        current = current.children[part];
      });
    });
    
    return root;
  };

  const renderTreeNode = (dbName, node, depth = 0) => {
    const hasChildren = Object.keys(node.children).length > 0;
    const isLeaf = node.isLeaf;
    const path = node.path;
    const nsId = `${dbName}:${path}`;
    const isExpanded = expandedNamespaces.has(nsId);
    const isKeySelected = isLeaf && selectedKey === node.keyName && selectedDb === dbName;

    return (
      <div key={node.path || node.name} style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          className={`redis-tree-node-row ${isKeySelected ? 'active' : ''}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 6px',
            paddingLeft: `${depth * 10 + 8}px`,
            cursor: 'pointer',
            borderRadius: '4px',
            fontSize: '0.74rem',
            background: isKeySelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
            color: isKeySelected ? '#fff' : 'var(--text-secondary)',
            minHeight: '26px'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (isLeaf) {
              setSelectedDb(dbName);
              setSelectedKey(node.keyName);
            } else if (hasChildren) {
              toggleNamespace(dbName, path);
            }
          }}
        >
          {hasChildren ? (
            <span 
              className="db-arrow-icon"
              onClick={(e) => {
                e.stopPropagation();
                toggleNamespace(dbName, path);
              }}
              style={{
                marginRight: '6px',
                fontSize: '0.62rem',
                display: 'inline-block',
                width: '12px',
                textAlign: 'center',
                transition: 'transform 0.2s',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                color: 'var(--text-muted)'
              }}
            >
              ▶
            </span>
          ) : (
            <span style={{ width: '18px' }} />
          )}

          {isLeaf ? (
            <span 
              className={`key-type-badge ${node.type}`} 
              style={{ 
                marginRight: '8px', 
                fontSize: '0.58rem', 
                padding: '2px 4px', 
                borderRadius: '3px', 
                textTransform: 'uppercase', 
                fontWeight: 'bold',
                lineHeight: 1
              }}
            >
              {node.type ? node.type.substring(0, 3) : 'key'}
            </span>
          ) : (
            <span style={{ marginRight: '6px', fontSize: '0.8rem', color: 'var(--accent-primary)' }}>📁</span>
          )}

          <span 
            style={{ 
              fontFamily: isLeaf ? 'monospace' : 'inherit', 
              fontWeight: hasChildren ? '600' : 'normal',
              textOverflow: 'ellipsis', 
              overflow: 'hidden', 
              whiteSpace: 'nowrap',
              flexGrow: 1
            }}
          >
            {node.name}
          </span>
        </div>

        {hasChildren && isExpanded && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {Object.keys(node.children)
              .sort()
              .map(childKey => renderTreeNode(dbName, node.children[childKey], depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderKeyTree = (dbName) => {
    const dbKeysObj = databases[dbName] || {};
    const filterText = (dbFilters[dbName] || '').toLowerCase();
    
    const filteredKeysList = Object.keys(dbKeysObj).filter(keyName => {
      if (!filterText) return true;
      return keyName.toLowerCase().includes(filterText);
    });
    
    if (filteredKeysList.length === 0) {
      return (
        <div className="no-keys-msg" style={{ padding: '8px 16px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          No keys found
        </div>
      );
    }

    const filteredKeysObj = {};
    filteredKeysList.forEach(k => {
      filteredKeysObj[k] = dbKeysObj[k];
    });

    const root = buildKeyTree(filteredKeysObj);
    
    return (
      <div className="redis-db-keys-list" style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px' }}>
        {Object.keys(root.children)
          .sort()
          .map(childKey => renderTreeNode(dbName, root.children[childKey], 0))}
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="db-connect-splash">
        <div className="db-connect-card glass-panel" style={{ maxWidth: '480px', width: '100%' }}>
          <div className="db-connect-icon" style={{ color: '#ef4444' }}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
          </div>
          <h2>Redis Client Manager</h2>
          <p>Connect to the server's Redis instance to explore databases, perform CRUD updates, and query raw CLI commands.</p>
          {connectionError && (
            <div className="query-status-banner error" style={{ margin: '12px 0', borderRadius: '4px', textAlign: 'left', padding: '10px 14px' }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.75rem' }}>{connectionError}</pre>
            </div>
          )}
          <div className="db-connect-details">
            <div className="db-detail-row">
              <span className="label">Redis Host:</span>
              <span className="val">{connection?.host || '127.0.0.1'}:{redisConfig.port || 6379}</span>
            </div>
            <div className="db-detail-row">
              <span className="label">Authentication:</span>
              <span className="val">{redisConfig.password ? 'Password Protected' : 'No Authentication Required'}</span>
            </div>
          </div>
          <button 
            className="db-connect-btn" 
            onClick={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <span className="spinner-small"></span>
                <span>Connecting...</span>
              </div>
            ) : 'Connect Redis Server'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="redis-explorer-container" style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Left Navigation Panel - Databases & Keys List */}
      <div className="redis-left-panel glass-panel" style={{ width: `${sidebarWidth}px`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="sidebar-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--panel-border)', flexShrink: 0 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Redis Browser</span>
          <button 
            className="add-key-btn" 
            onClick={() => setIsAddOpen(true)} 
            title="Create new key in active database"
            style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
              e.currentTarget.style.color = '#34d399';
            }}
          >
            + Key
          </button>
        </div>

        <div className="redis-db-list" style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {Object.keys(databases).map(dbName => {
            const dbKeys = databases[dbName] || {};
            const keyCount = keyspaceCounts[dbName] !== undefined ? keyspaceCounts[dbName] : (Object.keys(dbKeys).length || 0);
            const isDbExpanded = expandedDbs.has(dbName);
            const isDbActive = activeDb === dbName;

            return (
              <div key={dbName} className="redis-db-node" style={{ display: 'flex', flexDirection: 'column' }}>
                <div 
                  className={`redis-db-header ${isDbActive ? 'active' : ''}`}
                  onClick={() => {
                    setActiveDb(dbName);
                    toggleDbExpanded(dbName);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderLeft: isDbActive ? '3px solid var(--accent-primary)' : '3px solid transparent',
                    background: isDbActive ? 'rgba(255,255,255,0.02)' : 'transparent',
                    userSelect: 'none'
                  }}
                >
                  <span className="db-arrow-icon" style={{ marginRight: '8px', fontSize: '0.65rem', transition: 'transform 0.2s', transform: isDbExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                  <svg className="db-svg-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: '8px', color: isDbActive ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                  <span className="db-name" style={{ fontSize: '0.78rem', fontWeight: isDbActive ? '600' : 'normal', color: isDbActive ? '#fff' : 'var(--text-secondary)', flexGrow: 1 }}>{dbName.toUpperCase()}</span>
                  <span className="db-count-badge" style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '10px', color: 'var(--text-muted)' }}>{keyCount}</span>
                  <div className="redis-db-actions" onClick={e => e.stopPropagation()}>
                    <button 
                      className="redis-db-action-btn refresh" 
                      title="Refresh keys"
                      onClick={() => {
                        fetchDbKeys(dbName, dbFilters[dbName] || '');
                        fetchKeyspaceInfo();
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.73-.73" />
                      </svg>
                    </button>
                    <button 
                      className="redis-db-action-btn flush" 
                      title="Flush database"
                      onClick={async () => {
                        if (window.confirm(`Are you sure you want to flush all keys from ${dbName.toUpperCase()}?`)) {
                          await executeRedisUpdate(dbName, 'flush-db', null);
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                </div>

                {isDbExpanded && (
                  <div className="redis-db-keys-tree" style={{ paddingLeft: '12px', background: 'rgba(0,0,0,0.1)' }}>
                    <div className="redis-tree-filter-wrapper" style={{ display: 'flex', padding: '6px 8px', position: 'relative' }}>
                      <input 
                        type="text" 
                        placeholder="Filter keys..." 
                        className="redis-tree-filter-input"
                        value={dbFilters[dbName] || ''}
                        onClick={e => e.stopPropagation()}
                        onChange={e => handleDbFilterChange(dbName, e.target.value)}
                        style={{
                          width: '100%',
                          padding: '4px 24px 4px 8px',
                          background: 'rgba(0,0,0,0.2)',
                          border: '1px solid var(--panel-border)',
                          borderRadius: '4px',
                          color: '#fff',
                          fontSize: '0.7rem',
                          outline: 'none'
                        }}
                      />
                      {dbFilters[dbName] && (
                        <button 
                          className="redis-tree-filter-clear" 
                          onClick={(e) => { e.stopPropagation(); handleDbFilterChange(dbName, ''); }}
                          style={{
                            position: 'absolute',
                            right: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.8rem'
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>

                    {renderKeyTree(dbName)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Disconnect Panel */}
        <div className="pg-config-info" style={{ padding: '12px', borderTop: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.1)', flexShrink: 0 }}>
          <div className="config-info-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Status:</span>
            <span style={{ color: '#10b981', fontWeight: 'bold' }}>Connected</span>
          </div>
          <button 
            onClick={handleDisconnect} 
            className="haproxy-control-btn" 
            style={{ width: '100%', marginTop: '6px', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Horizontal resizer bar */}
      <div 
        className={`grid-resizer-v ${isResizingSidebar ? 'dragging' : ''}`}
        onMouseDown={handleSidebarMouseDown}
        style={{
          width: '6px',
          background: 'transparent',
          cursor: 'col-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          flexShrink: 0,
          borderLeft: '1px solid var(--panel-border)',
          borderRight: '1px solid var(--panel-border)',
          userSelect: 'none',
          position: 'relative'
        }}
      >
        <div style={{
          width: '2px',
          height: '24px',
          background: isResizingSidebar ? 'var(--accent-primary)' : 'rgba(255,255,255,0.15)',
          borderRadius: '1px',
          transition: 'background 0.2s'
        }} />
      </div>

      {/* Right Content Panel - Key Details & CLI */}
      <div className="redis-right-panel" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: '14px', height: '100%', overflowY: 'auto', minWidth: 0 }}>
        
        {isAddOpen ? (
          /* Create Key Form */
          <div className="redis-key-edit-panel glass-panel" style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#fff' }}>Create New Key</span>
              <button 
                className="panel-close-btn" 
                onClick={() => setIsAddOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer', outline: 'none' }}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateKey} className="redis-add-form" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label className="form-label" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Key Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  required
                  placeholder="e.g. cache:config"
                  value={newKeyData.name}
                  onChange={(e) => setNewKeyData({ ...newKeyData, name: e.target.value })}
                />
              </div>
              <div className="form-row" style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label className="form-label" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Key Type</label>
                  <select 
                    className="form-select"
                    value={newKeyData.type}
                    onChange={(e) => setNewKeyData({ ...newKeyData, type: e.target.value })}
                  >
                    <option value="string">String</option>
                    <option value="hash">Hash</option>
                    <option value="list">List</option>
                    <option value="set">Set</option>
                    <option value="zset">Sorted Set</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label className="form-label" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>TTL (seconds)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="-1 for permanent"
                    value={newKeyData.ttl}
                    onChange={(e) => setNewKeyData({ ...newKeyData, ttl: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label className="form-label" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Value</label>
                <textarea 
                  className="form-textarea" 
                  rows={4}
                  required
                  placeholder={newKeyData.type === 'hash' ? '{"field1": "val1"}' : 'Value'}
                  value={newKeyData.value}
                  onChange={(e) => setNewKeyData({ ...newKeyData, value: e.target.value })}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div className="add-form-footer" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button 
                  type="submit" 
                  className="db-connect-btn" 
                  style={{ 
                    width: 'auto', 
                    padding: '8px 20px', 
                    background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)'
                  }}
                >
                  Save Key
                </button>
              </div>
            </form>
          </div>
        ) : selectedKeyInfo ? (
          /* Key Details & Type-specific Editor */
          <div className="redis-key-edit-panel glass-panel" style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
              <div className="key-details-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={`key-type-badge ${selectedKeyInfo.type}`}>{selectedKeyInfo.type}</span>
                <span className="key-details-name" style={{ fontSize: '0.85rem', fontWeight: '700', color: '#fff', fontFamily: 'monospace' }}>{selectedKey}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>({selectedDb.toUpperCase()})</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  className="haproxy-control-btn"
                  onClick={() => fetchKeyValue(selectedDb, selectedKey, selectedKeyInfo.type)}
                  title="Reload Key Value"
                  style={{ 
                    background: 'rgba(255, 255, 255, 0.05)', 
                    borderColor: 'rgba(255, 255, 255, 0.15)', 
                    color: 'var(--text-secondary)', 
                    padding: '6px', 
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.73-.73" />
                  </svg>
                </button>
                <button 
                  className="haproxy-control-btn" 
                  onClick={() => handleDeleteKey(selectedDb, selectedKey)}
                  style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '4px 10px', fontSize: '0.7rem' }}
                >
                  Delete Key
                </button>
              </div>
            </div>
            
            <div className="redis-key-meta-rows" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div className="meta-row" style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>TTL (seconds):</span>
                <input 
                  type="number"
                  className="redis-editor-input"
                  value={selectedKeyInfo.ttl}
                  onChange={(e) => setSelectedKeyInfo({ ...selectedKeyInfo, ttl: parseInt(e.target.value, 10) || -1 })}
                  onBlur={(e) => handleUpdateTtl(e.target.value)}
                  style={{ width: '80px', padding: '2px 6px', background: '#131520', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  ({selectedKeyInfo.ttl === -1 ? 'persistent' : 'expires soon'})
                </span>
              </div>
            </div>

            {isValueLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '140px', background: '#050811', border: '1px solid var(--panel-border)', borderRadius: '4px' }}>
                <span className="spinner-small" style={{ width: '20px', height: '20px', borderTopColor: 'var(--accent-primary)', marginBottom: '8px' }}></span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Loading key value...</span>
              </div>
            ) : keyFetchError ? (
              <div style={{ color: '#f87171', fontSize: '0.75rem', padding: '12px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '4px' }}>
                {keyFetchError}
              </div>
            ) : (
              <div className="redis-value-explorer">
                {/* 1. STRING Type Editor */}
                {selectedKeyInfo.type === 'string' && (
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px' }}>Value Content</label>
                    <textarea 
                      className="form-textarea"
                      rows={6}
                      value={localStringValue}
                      onChange={(e) => setLocalStringValue(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', background: '#131520', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', fontFamily: 'monospace', resize: 'vertical', outline: 'none' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                      <button 
                        onClick={() => handleUpdateStringValue(localStringValue)}
                        className="db-connect-btn"
                        style={{ width: 'auto', padding: '6px 14px', background: 'var(--accent-primary)', border: 'none', color: '#fff', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', cursor: 'pointer' }}
                      >
                        Save Value
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. HASH Type Editor */}
                {selectedKeyInfo.type === 'hash' && (
                  <div className="redis-type-editor">
                    <div className="redis-hash-search-wrapper" style={{ marginBottom: '10px', position: 'relative' }}>
                      <input 
                        type="text" 
                        placeholder="Search fields by name..." 
                        value={hashSearchQuery}
                        onChange={(e) => setHashSearchQuery(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 30px 6px 10px',
                          background: '#131520',
                          border: '1px solid var(--panel-border)',
                          borderRadius: '4px',
                          color: '#fff',
                          fontSize: '0.75rem',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                      {hashSearchQuery && (
                        <button 
                          onClick={() => setHashSearchQuery('')}
                          onMouseOver={(e) => e.currentTarget.style.color = '#fff'}
                          onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                          style={{
                            position: 'absolute',
                            right: '8px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            padding: '2px'
                          }}
                        >
                          ❌
                        </button>
                      )}
                    </div>

                    <table className="redis-editor-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '30%', padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>Field</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>Value</th>
                          <th style={{ width: '60px', padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center', color: 'var(--text-muted)' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!selectedKeyInfo.value || Object.keys(selectedKeyInfo.value).length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>No fields found</td>
                          </tr>
                        ) : (
                          (() => {
                            const filteredFields = Object.keys(selectedKeyInfo.value).filter(field =>
                              field.toLowerCase().includes(hashSearchQuery.toLowerCase())
                            );
                            if (filteredFields.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>No matching fields found</td>
                                </tr>
                              );
                            }
                            return filteredFields.map((field) => {
                              const isEditing = editingHashField?.originalField === field;
                              return (
                                <tr key={field}>
                                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)' }}>
                                    {isEditing ? (
                                      <input 
                                        type="text" 
                                        className="redis-editor-input" 
                                        value={editingHashField.field}
                                        onChange={(e) => setEditingHashField({ ...editingHashField, field: e.target.value })}
                                        style={{ width: '100%', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(99, 102, 241, 0.4)', borderRadius: '4px', color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem', outline: 'none', padding: '3px 6px' }}
                                        autoFocus
                                      />
                                    ) : (
                                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#818cf8', fontWeight: '600' }}>
                                        {field}
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)' }}>
                                    {isEditing ? (
                                      <input 
                                        type="text" 
                                        className="redis-editor-input" 
                                        value={editingHashField.value}
                                        onChange={(e) => setEditingHashField({ ...editingHashField, value: e.target.value })}
                                        style={{ width: '100%', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(99, 102, 241, 0.4)', borderRadius: '4px', color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem', outline: 'none', padding: '3px 6px' }}
                                      />
                                    ) : (
                                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#e2e8f0', wordBreak: 'break-all' }}>
                                        {selectedKeyInfo.value[field] || ''}
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center' }}>
                                    {isEditing ? (
                                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                                        <button 
                                          className="redis-editor-action-btn save" 
                                          onClick={() => handleSaveHashField(field, editingHashField.field, editingHashField.value)}
                                          title="Save changes"
                                          style={{ background: 'transparent', border: 'none', color: '#34d399', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 4px' }}
                                        >
                                          💾
                                        </button>
                                        <button 
                                          className="redis-editor-action-btn cancel" 
                                          onClick={() => setEditingHashField(null)}
                                          title="Cancel"
                                          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 4px' }}
                                        >
                                          ❌
                                        </button>
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                                        <button 
                                          className="redis-editor-action-btn edit" 
                                          onClick={() => setEditingHashField({ originalField: field, field: field, value: selectedKeyInfo.value[field] || '' })}
                                          title="Edit field"
                                          style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 4px' }}
                                        >
                                          ✏️
                                        </button>
                                        <button 
                                          className="redis-editor-action-btn delete" 
                                          onClick={() => handleDeleteHashField(field)}
                                          title="Delete field"
                                          style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.85rem', padding: '2px 4px' }}
                                        >
                                          🗑️
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            });
                          })()
                        )}
                      </tbody>
                    </table>

                    <form onSubmit={handleAddHashField} className="redis-add-row-form" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                      <input 
                        type="text" 
                        placeholder="New field..." 
                        className="redis-add-row-input"
                        value={newHashField.field}
                        onChange={(e) => setNewHashField({ ...newHashField, field: e.target.value })}
                        style={{ flex: 1, padding: '6px 10px', background: '#131520', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
                      />
                      <input 
                        type="text" 
                        placeholder="Value..." 
                        className="redis-add-row-input"
                        value={newHashField.value}
                        onChange={(e) => setNewHashField({ ...newHashField, value: e.target.value })}
                        style={{ flex: 2, padding: '6px 10px', background: '#131520', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
                      />
                      <button type="submit" className="redis-add-row-btn" style={{ padding: '6px 12px', background: 'var(--accent-primary)', border: 'none', color: '#fff', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '600', cursor: 'pointer' }}>
                        Add
                      </button>
                    </form>
                  </div>
                )}

                {/* 3. LIST or SET Type Editor */}
                {(selectedKeyInfo.type === 'list' || selectedKeyInfo.type === 'set') && (
                  <div className="redis-type-editor">
                    <table className="redis-editor-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '60px', padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center', color: 'var(--text-muted)' }}>Index</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>Value</th>
                          <th style={{ width: '60px', padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center', color: 'var(--text-muted)' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!selectedKeyInfo.value || selectedKeyInfo.value.length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>No items found</td>
                          </tr>
                        ) : (
                          selectedKeyInfo.value.map((item, idx) => (
                            <tr key={idx}>
                              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center', color: 'var(--text-muted)' }}>{idx}</td>
                              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)' }}>
                                {selectedKeyInfo.type === 'list' ? (
                                  <input 
                                    type="text" 
                                    className="redis-editor-input" 
                                    defaultValue={item}
                                    onBlur={(e) => {
                                      if (e.target.value !== item) {
                                        handleUpdateListItem(idx, e.target.value);
                                      }
                                    }}
                                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem', outline: 'none' }}
                                  />
                                ) : (
                                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', paddingLeft: '8px' }}>{item}</span>
                                )}
                              </td>
                              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center' }}>
                                <button 
                                  className="redis-editor-action-btn delete" 
                                  onClick={() => handleDeleteListItem(idx)}
                                  title="Remove item"
                                  style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.85rem' }}
                                >
                                  🗑️
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>

                    <form onSubmit={handleAddListItem} className="redis-add-row-form" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                      <input 
                        type="text" 
                        placeholder={selectedKeyInfo.type === 'list' ? "Push new item..." : "Add to set..."}
                        className="redis-add-row-input"
                        value={newListItem}
                        onChange={(e) => setNewListItem(e.target.value)}
                        style={{ flex: 1, padding: '6px 10px', background: '#131520', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
                      />
                      <button type="submit" className="redis-add-row-btn" style={{ padding: '6px 12px', background: 'var(--accent-primary)', border: 'none', color: '#fff', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '600', cursor: 'pointer' }}>
                        Add
                      </button>
                    </form>
                  </div>
                )}

                {/* 4. ZSET Type Editor */}
                {selectedKeyInfo.type === 'zset' && (
                  <div className="redis-type-editor">
                    <table className="redis-editor-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '25%', padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>Score</th>
                          <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>Member</th>
                          <th style={{ width: '60px', padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center', color: 'var(--text-muted)' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!selectedKeyInfo.value || selectedKeyInfo.value.length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>No members found</td>
                          </tr>
                        ) : (
                          selectedKeyInfo.value.map((item, idx) => (
                            <tr key={idx}>
                              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)' }}>
                                <input 
                                  type="number" 
                                  step="any"
                                  className="redis-editor-input" 
                                  defaultValue={item.score}
                                  onBlur={(e) => {
                                    if (parseFloat(e.target.value) !== item.score) {
                                      handleUpdateZSetItem(idx, 'score', e.target.value);
                                    }
                                  }}
                                  style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem', outline: 'none' }}
                                />
                              </td>
                              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)' }}>
                                <input 
                                  type="text" 
                                  className="redis-editor-input" 
                                  defaultValue={item.member}
                                  onBlur={(e) => {
                                    if (e.target.value.trim() && e.target.value.trim() !== item.member) {
                                      handleUpdateZSetItem(idx, 'member', e.target.value);
                                    }
                                  }}
                                  style={{ width: '100%', background: 'transparent', border: 'none', color: '#fff', fontFamily: 'monospace', fontSize: '0.75rem', outline: 'none' }}
                                />
                              </td>
                              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center' }}>
                                <button 
                                  className="redis-editor-action-btn delete" 
                                  onClick={() => handleDeleteZSetItem(idx)}
                                  title="Remove member"
                                  style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.85rem' }}
                                >
                                  🗑️
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>

                    <form onSubmit={handleAddZSetItem} className="redis-add-row-form" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                      <input 
                        type="number" 
                        step="any"
                        placeholder="Score..." 
                        className="redis-add-row-input"
                        value={newZSetItem.score}
                        onChange={(e) => setNewZSetItem({ ...newZSetItem, score: e.target.value })}
                        style={{ flex: 1, padding: '6px 10px', background: '#131520', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
                      />
                      <input 
                        type="text" 
                        placeholder="Member..." 
                        className="redis-add-row-input"
                        value={newZSetItem.member}
                        onChange={(e) => setNewZSetItem({ ...newZSetItem, member: e.target.value })}
                        style={{ flex: 2, padding: '6px 10px', background: '#131520', border: '1px solid var(--panel-border)', borderRadius: '4px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
                      />
                      <button type="submit" className="redis-add-row-btn" style={{ padding: '6px 12px', background: 'var(--accent-primary)', border: 'none', color: '#fff', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '600', cursor: 'pointer' }}>
                        Add
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Empty Selection State */
          <div className="redis-key-edit-panel glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '180px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
            <div className="no-keys-msg" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Select a key in the tree to view database values.</div>
          </div>
        )}

        {/* Interactive Redis CLI Terminal */}
        <div className="redis-cli-panel glass-panel" style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', height: isCliExpanded ? '240px' : '36px', marginTop: isCliExpanded ? 'auto' : '0', flexShrink: 0, transition: 'height 0.2s ease-in-out' }}>
          <div 
            className="panel-header" 
            onClick={() => setIsCliExpanded(!isCliExpanded)}
            style={{ padding: '8px 12px', borderBottom: isCliExpanded ? '1px solid var(--panel-border)' : 'none', fontSize: '0.74rem', fontWeight: 'bold', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
          >
            <span>Interactive Redis CLI Terminal ({activeDb.toUpperCase()})</span>
            <span style={{ fontSize: '0.65rem', transition: 'transform 0.2s', transform: isCliExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          </div>
          {isCliExpanded && (
            <>
              <div className="redis-cli-screen" style={{ flexGrow: 1, overflowY: 'auto', padding: '12px', background: '#050811', fontFamily: 'monospace', fontSize: '0.75rem', color: '#10b981', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {cliOutput.map((out, idx) => (
                  <div key={idx} className={`redis-cli-line ${out.type}`} style={{ whiteSpace: 'pre-wrap', color: out.type === 'input' ? '#3b82f6' : out.type === 'error' ? '#ef4444' : '#10b981' }}>
                    {out.text}
                  </div>
                ))}
                <div ref={cliEndRef} />
              </div>
              <form onSubmit={handleCliSubmit} className="redis-cli-input-form" style={{ display: 'flex', borderTop: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.4)', alignItems: 'center' }}>
                <span className="redis-cli-prompt" style={{ padding: '10px 0 10px 12px', color: '#3b82f6', fontFamily: 'monospace', fontSize: '0.78rem', userSelect: 'none' }}>
                  127.0.0.1:6379[{activeDb.replace('db', '')}]&gt;
                </span>
                <input
                  type="text"
                  className="redis-cli-input"
                  value={cmdText}
                  onChange={(e) => setCmdText(e.target.value)}
                  placeholder="Type HELP for a list of supported CLI commands..."
                  style={{ flexGrow: 1, background: 'transparent', border: 'none', color: '#fff', fontFamily: 'monospace', fontSize: '0.78rem', padding: '10px 12px', outline: 'none' }}
                />
              </form>
            </>
          )}
        </div>

        {/* Connected Server Info Stats Panel */}
        {serverInfo && (
          <div className="redis-server-info-panel glass-panel" style={{ borderRadius: '8px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', padding: '12px', background: 'rgba(0,0,0,0.1)', flexShrink: 0, transition: 'height 0.2s ease-in-out' }}>
            <div 
              className="panel-header" 
              onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
              style={{ paddingBottom: isOverviewExpanded ? '6px' : '0', borderBottom: isOverviewExpanded ? '1px solid rgba(255,255,255,0.05)' : 'none', fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: isOverviewExpanded ? '8px' : '0', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
            >
              <span>Server Overview: Redis v{serverInfo.redis_version || 'N/A'}</span>
              <span style={{ fontSize: '0.65rem', transition: 'transform 0.2s', transform: isOverviewExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            </div>
            
            {isOverviewExpanded && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                {/* Replication Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.72rem' }}>
                  <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Replication</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Role:</span>
                    <span style={{ color: serverInfo.role === 'master' ? '#34d399' : '#60a5fa', fontWeight: 'bold', textTransform: 'capitalize' }}>
                      {serverInfo.role || 'Unknown'}
                    </span>
                  </div>
                  {serverInfo.role === 'master' ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Slaves Count:</span>
                        <span style={{ color: '#fff', fontWeight: '600' }}>{serverInfo.connected_slaves || '0'}</span>
                      </div>
                      {/* Extract & Render Slave IPs */}
                      {(() => {
                        const slaves = parseSlaves(serverInfo);
                        if (slaves.length > 0) {
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '4px', marginTop: '2px' }}>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>Slave Nodes:</span>
                              {slaves.map((slaveStr, sIdx) => (
                                <span key={sIdx} style={{ fontFamily: 'monospace', color: '#cbd5e1', fontSize: '0.68rem' }}>• {slaveStr}</span>
                              ))}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Master IP:</span>
                        <span style={{ color: '#fff', fontWeight: '600', fontFamily: 'monospace' }}>
                          {`${serverInfo.master_host || 'N/A'}:${serverInfo.master_port || 'N/A'}`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Link Status:</span>
                        <span style={{ color: serverInfo.master_link_status === 'up' ? '#34d399' : '#f87171', fontWeight: 'bold' }}>
                          {serverInfo.master_link_status ? serverInfo.master_link_status.toUpperCase() : 'N/A'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Resource Usage Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.72rem' }}>
                  <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Resource Usage</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Used Memory:</span>
                    <span style={{ color: '#fff', fontWeight: '600' }}>{serverInfo.used_memory_human || 'N/A'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Peak Memory:</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{serverInfo.used_memory_peak_human || 'N/A'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Total Memory:</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{serverInfo.total_system_memory_human || 'N/A'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>CPU (Sys/User):</span>
                    <span style={{ color: '#fff', fontWeight: '600' }}>
                      {`${parseFloat(serverInfo.used_cpu_sys || 0).toFixed(2)}s / ${parseFloat(serverInfo.used_cpu_user || 0).toFixed(2)}s`}
                    </span>
                  </div>
                </div>

                {/* Server Stats Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.72rem' }}>
                  <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase' }}>Stats</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Clients:</span>
                    <span style={{ color: '#fff', fontWeight: '600' }}>{serverInfo.connected_clients || '0'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Uptime:</span>
                    <span style={{ color: '#fff', fontWeight: '600' }}>{serverInfo.uptime_in_days || '0'} days</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Port:</span>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{serverInfo.tcp_port || '6379'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

