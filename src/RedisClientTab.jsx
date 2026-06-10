import React, { useState, useEffect, useRef } from 'react';

export function RedisView({ connection }) {
  const redisConfig = connection?.services?.redis || {};
  const [keys, setKeys] = useState({
    'session:1002': { type: 'string', value: 'userId_881a2f9811', ttl: 17200 },
    'active_connections': { type: 'string', value: '45', ttl: -1 },
    'rate_limit:192.168.1.15': { type: 'string', value: '4', ttl: 44 },
    'user:profile:1002': { type: 'hash', value: { name: 'John Doe', role: 'admin', org: 'omicron' }, ttl: -1 },
    'job_queue:email': { type: 'list', value: ['send_welcome_email', 'invoice_remind', 'reset_alert'], ttl: -1 }
  });

  const [selectedKey, setSelectedKey] = useState('session:1002');
  const [filterType, setFilterType] = useState('all');
  const [newKeyData, setNewKeyData] = useState({ name: '', type: 'string', value: '', ttl: '-1' });
  const [isAddOpen, setIsAddOpen] = useState(false);
  
  // CLI State
  const [cmdText, setCmdText] = useState('');
  const [cliOutput, setCliOutput] = useState([
    { type: 'info', text: `Connected to Redis server at ${connection?.host}:${redisConfig.port || 6379}` },
    { type: 'info', text: 'Type HELP for list of simulated commands.' }
  ]);

  const cliEndRef = useRef(null);

  useEffect(() => {
    if (cliEndRef.current) {
      cliEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cliOutput]);

  const handleCreateKey = (e) => {
    e.preventDefault();
    if (!newKeyData.name.trim()) return;

    let finalVal = newKeyData.value;
    if (newKeyData.type === 'hash') {
      try {
        finalVal = JSON.parse(newKeyData.value);
      } catch (err) {
        finalVal = { data: newKeyData.value };
      }
    } else if (newKeyData.type === 'list') {
      finalVal = newKeyData.value.split(',').map(s => s.trim());
    }

    setKeys({
      ...keys,
      [newKeyData.name.trim()]: {
        type: newKeyData.type,
        value: finalVal,
        ttl: parseInt(newKeyData.ttl, 10) || -1
      }
    });

    setSelectedKey(newKeyData.name.trim());
    setIsAddOpen(false);
    setNewKeyData({ name: '', type: 'string', value: '', ttl: '-1' });
  };

  const handleUpdateValue = (keyName, newValue) => {
    let parsedVal = newValue;
    if (keys[keyName].type === 'hash') {
      try {
        parsedVal = JSON.parse(newValue);
      } catch (e) {
        return; // invalid json
      }
    } else if (keys[keyName].type === 'list') {
      parsedVal = newValue.split(',').map(s => s.trim());
    }

    setKeys({
      ...keys,
      [keyName]: {
        ...keys[keyName],
        value: parsedVal
      }
    });
  };

  const handleDeleteKey = (keyName) => {
    const updated = { ...keys };
    delete updated[keyName];
    setKeys(updated);
    
    const remaining = Object.keys(updated);
    if (remaining.length > 0) {
      setSelectedKey(remaining[0]);
    } else {
      setSelectedKey(null);
    }
  };

  const handleCliSubmit = (e) => {
    e.preventDefault();
    if (!cmdText.trim()) return;

    const cmd = cmdText.trim();
    const parts = cmd.split(' ');
    const op = parts[0].toUpperCase();
    
    let result = '';
    let isError = false;

    switch (op) {
      case 'HELP':
        result = 'Supported commands:\n  PING\n  GET <key>\n  SET <key> <val>\n  KEYS *\n  DEL <key>\n  TTL <key>\n  FLUSHALL';
        break;
      case 'PING':
        result = 'PONG';
        break;
      case 'KEYS':
        result = Object.keys(keys).map((k, i) => `${i + 1}) "${k}"`).join('\n') || '(empty list or set)';
        break;
      case 'GET':
        if (parts.length < 2) {
          result = 'ERR wrong number of arguments for \'get\' command';
          isError = true;
        } else {
          const k = parts[1];
          if (keys[k]) {
            if (keys[k].type === 'string') {
              result = `"${keys[k].value}"`;
            } else {
              result = `WRONGTYPE Operation against a key holding the wrong kind of value (key is a ${keys[k].type})`;
              isError = true;
            }
          } else {
            result = '(nil)';
          }
        }
        break;
      case 'SET':
        if (parts.length < 3) {
          result = 'ERR wrong number of arguments for \'set\' command';
          isError = true;
        } else {
          const k = parts[1];
          const val = parts.slice(2).join(' ').replace(/^"(.*)"$/, '$1'); // Strip outer quotes if any
          setKeys(prev => ({
            ...prev,
            [k]: { type: 'string', value: val, ttl: -1 }
          }));
          result = 'OK';
        }
        break;
      case 'DEL':
        if (parts.length < 2) {
          result = 'ERR wrong number of arguments for \'del\' command';
          isError = true;
        } else {
          const k = parts[1];
          if (keys[k]) {
            handleDeleteKey(k);
            result = '(integer) 1';
          } else {
            result = '(integer) 0';
          }
        }
        break;
      case 'TTL':
        if (parts.length < 2) {
          result = 'ERR wrong number of arguments for \'ttl\' command';
          isError = true;
        } else {
          const k = parts[1];
          if (keys[k]) {
            result = `(integer) ${keys[k].ttl}`;
          } else {
            result = '(integer) -2';
          }
        }
        break;
      case 'FLUSHALL':
        setKeys({});
        setSelectedKey(null);
        result = 'OK';
        break;
      default:
        result = `ERR unknown command \`${op}\`, with args beginning with: ` + parts.slice(1).join(' ');
        isError = true;
    }

    setCliOutput(prev => [
      ...prev,
      { type: 'input', text: `127.0.0.1:6379> ${cmd}` },
      { type: isError ? 'error' : 'response', text: result }
    ]);
    setCmdText('');
  };

  const filteredKeys = Object.keys(keys).filter(k => {
    if (filterType === 'all') return true;
    return keys[k].type === filterType;
  });

  const selectedKeyInfo = selectedKey ? keys[selectedKey] : null;

  return (
    <div className="redis-explorer-container">
      <div className="redis-left-panel glass-panel">
        <div className="sidebar-section-title">
          <span>Redis Explorer</span>
          <button className="add-key-btn" onClick={() => setIsAddOpen(true)} title="Add Redis Key">
            + Key
          </button>
        </div>

        <div className="redis-filter-tabs">
          {['all', 'string', 'hash', 'list'].map(type => (
            <button
              key={type}
              className={`filter-tab ${filterType === type ? 'active' : ''}`}
              onClick={() => setFilterType(type)}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="redis-key-list">
          {filteredKeys.length === 0 ? (
            <div className="no-keys-msg">No keys found</div>
          ) : (
            filteredKeys.map(k => (
              <div
                key={k}
                className={`redis-key-item ${selectedKey === k ? 'active' : ''}`}
                onClick={() => setSelectedKey(k)}
              >
                <span className={`key-type-badge ${keys[k].type}`}>{keys[k].type.substring(0, 3)}</span>
                <span className="key-name-txt">{k}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="redis-right-panel">
        {isAddOpen ? (
          <div className="redis-key-edit-panel glass-panel">
            <div className="panel-header">
              <span>Create New Key</span>
              <button className="panel-close-btn" onClick={() => setIsAddOpen(false)}>×</button>
            </div>
            <form onSubmit={handleCreateKey} className="redis-add-form">
              <div className="form-group">
                <label className="form-label">Key Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  required
                  placeholder="e.g. cache:config"
                  value={newKeyData.name}
                  onChange={(e) => setNewKeyData({ ...newKeyData, name: e.target.value })}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Key Type</label>
                  <select 
                    className="form-select"
                    value={newKeyData.type}
                    onChange={(e) => setNewKeyData({ ...newKeyData, type: e.target.value })}
                  >
                    <option value="string">String</option>
                    <option value="hash">Hash (JSON)</option>
                    <option value="list">List (Comma-separated)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">TTL (seconds)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="-1 for permanent"
                    value={newKeyData.ttl}
                    onChange={(e) => setNewKeyData({ ...newKeyData, ttl: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Value</label>
                <textarea 
                  className="form-textarea" 
                  rows={4}
                  required
                  placeholder={newKeyData.type === 'hash' ? '{"field1": "val1"}' : 'Value'}
                  value={newKeyData.value}
                  onChange={(e) => setNewKeyData({ ...newKeyData, value: e.target.value })}
                />
              </div>
              <div className="add-form-footer">
                <button type="submit" className="connect-submit-btn">Save Key</button>
              </div>
            </form>
          </div>
        ) : selectedKeyInfo ? (
          <div className="redis-key-edit-panel glass-panel" style={{ marginBottom: '14px' }}>
            <div className="panel-header">
              <div className="key-details-title">
                <span className={`key-type-badge ${selectedKeyInfo.type}`}>{selectedKeyInfo.type}</span>
                <span className="key-details-name">{selectedKey}</span>
              </div>
              <button className="key-delete-btn" onClick={() => handleDeleteKey(selectedKey)}>
                Delete Key
              </button>
            </div>
            
            <div className="redis-key-meta-rows">
              <div className="meta-row">
                <span>TTL:</span>
                <span>{selectedKeyInfo.ttl === -1 ? 'no expiration (-1)' : `${selectedKeyInfo.ttl} seconds`}</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Value Explorer / Editor</label>
              {selectedKeyInfo.type === 'string' ? (
                <input 
                  type="text" 
                  className="form-input"
                  value={selectedKeyInfo.value}
                  onChange={(e) => handleUpdateValue(selectedKey, e.target.value)}
                />
              ) : selectedKeyInfo.type === 'hash' ? (
                <textarea 
                  className="form-textarea" 
                  rows={5}
                  value={JSON.stringify(selectedKeyInfo.value, null, 2)}
                  onChange={(e) => handleUpdateValue(selectedKey, e.target.value)}
                />
              ) : (
                <textarea 
                  className="form-textarea" 
                  rows={3}
                  value={selectedKeyInfo.value.join(', ')}
                  onChange={(e) => handleUpdateValue(selectedKey, e.target.value)}
                  placeholder="Comma-separated items"
                />
              )}
            </div>
          </div>
        ) : (
          <div className="redis-key-edit-panel glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '180px' }}>
            <div className="no-keys-msg">Select a key to view or modify database values</div>
          </div>
        )}

        {/* CLI Console */}
        <div className="redis-cli-panel glass-panel">
          <div className="panel-header">
            <span>Interactive Redis CLI Terminal</span>
          </div>
          <div className="redis-cli-screen">
            {cliOutput.map((out, idx) => (
              <div key={idx} className={`cli-line ${out.type}`}>
                <pre>{out.text}</pre>
              </div>
            ))}
            <div ref={cliEndRef} />
          </div>
          <form onSubmit={handleCliSubmit} className="redis-cli-form">
            <span className="cli-prompt">127.0.0.1:6379&gt;</span>
            <input
              type="text"
              className="redis-cli-input"
              value={cmdText}
              onChange={(e) => setCmdText(e.target.value)}
              placeholder="Type PING or KEYS * and press Enter..."
            />
          </form>
        </div>
      </div>
    </div>
  );
}
