import React, { useState, useEffect } from 'react';

export function RabbitMqView({ connection }) {
  const rmqConfig = connection?.services?.rabbitmq || {};
  const [queues, setQueues] = useState([
    { name: 'email_deliveries', ready: 0, unacked: 0, total: 0, consumers: 3, rate: 0.0, status: 'idle' },
    { name: 'payment_settlement', ready: 14, unacked: 2, total: 16, consumers: 2, rate: 12.4, status: 'running' },
    { name: 'image_resize_jobs', ready: 255, unacked: 18, total: 273, consumers: 5, rate: 45.2, status: 'busy' },
    { name: 'socket_events', ready: 0, unacked: 0, total: 0, consumers: 12, rate: 110.8, status: 'running' }
  ]);

  const [publishForm, setPublishForm] = useState({ queue: 'email_deliveries', body: '', routingKey: '' });
  const [activeTab, setActiveTab] = useState('queues'); // 'queues' or 'publish'
  const [sysStats, setSysStats] = useState({
    ready: 269,
    unacked: 20,
    total: 289,
    publishRate: 168.4,
    deliverRate: 156.2
  });

  useEffect(() => {
    // Simulate active queue traffic rates changing
    const timer = setInterval(() => {
      setQueues(prev => prev.map(q => {
        if (q.status === 'idle') return q;
        const delta = (Math.random() - 0.5) * 5;
        const newRate = Math.max(0.2, q.rate + delta);
        return {
          ...q,
          rate: parseFloat(newRate.toFixed(1)),
          ready: Math.max(0, q.ready + (Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0))
        };
      }));

      setSysStats(prev => {
        const delta = (Math.random() - 0.5) * 10;
        return {
          ...prev,
          publishRate: parseFloat(Math.max(10, prev.publishRate + delta).toFixed(1)),
          deliverRate: parseFloat(Math.max(10, prev.deliverRate + delta).toFixed(1))
        };
      });
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  const handlePublishMessage = (e) => {
    e.preventDefault();
    if (!publishForm.body.trim()) return;

    setQueues(prev => prev.map(q => {
      if (q.name === publishForm.queue) {
        return {
          ...q,
          ready: q.ready + 1,
          total: q.total + 1
        };
      }
      return q;
    }));

    setSysStats(prev => ({
      ...prev,
      ready: prev.ready + 1,
      total: prev.total + 1
    }));

    alert(`Message successfully published to exchange. Routing key: "${publishForm.routingKey || publishForm.queue}"`);
    setPublishForm({ ...publishForm, body: '' });
    setActiveTab('queues');
  };

  const handlePurgeQueue = (queueName) => {
    if (!window.confirm(`Are you sure you want to purge all messages in queue "${queueName}"?`)) return;

    let purgedCount = 0;
    setQueues(prev => prev.map(q => {
      if (q.name === queueName) {
        purgedCount = q.total;
        return { ...q, ready: 0, unacked: 0, total: 0 };
      }
      return q;
    }));

    setSysStats(prev => ({
      ...prev,
      ready: Math.max(0, prev.ready - purgedCount),
      total: Math.max(0, prev.total - purgedCount)
    }));
  };

  return (
    <div className="rmq-container">
      <div className="rmq-top-metrics-grid">
        <div className="rmq-metric-card glass-panel">
          <div className="metric-header">Messages Ready</div>
          <div className="metric-val">{sysStats.ready}</div>
          <div className="metric-sub">Pending delivery</div>
        </div>
        <div className="rmq-metric-card glass-panel">
          <div className="metric-header">Unacknowledged</div>
          <div className="metric-val warning-txt">{sysStats.unacked}</div>
          <div className="metric-sub">In-flight messages</div>
        </div>
        <div className="rmq-metric-card glass-panel">
          <div className="metric-header">Total Queued</div>
          <div className="metric-val">{sysStats.total}</div>
          <div className="metric-sub">Ready + Unacked</div>
        </div>
        <div className="rmq-metric-card glass-panel">
          <div className="metric-header">Publish / Deliver Rates</div>
          <div className="metric-val-split">
            <span className="rate-in">{sysStats.publishRate} msg/s</span>
            <span className="rate-divider">|</span>
            <span className="rate-out">{sysStats.deliverRate} msg/s</span>
          </div>
          <div className="metric-sub">Traffic IO rates</div>
        </div>
      </div>

      <div className="rmq-main-layout">
        <div className="rmq-tab-headers">
          <button 
            className={`rmq-tab-btn ${activeTab === 'queues' ? 'active' : ''}`}
            onClick={() => setActiveTab('queues')}
          >
            Queues ({queues.length})
          </button>
          <button 
            className={`rmq-tab-btn ${activeTab === 'publish' ? 'active' : ''}`}
            onClick={() => setActiveTab('publish')}
          >
            Publish Message
          </button>
          <div className="rmq-connection-meta">
            <span>Broker: amqp://{connection?.host}:{rmqConfig.port || 5672}</span>
          </div>
        </div>

        {activeTab === 'queues' ? (
          <div className="rmq-queues-panel glass-panel">
            <div className="table-list-title">Queue Status Dashboard</div>
            <div className="results-table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Queue Name</th>
                    <th>Status</th>
                    <th>Ready</th>
                    <th>Unacked</th>
                    <th>Total</th>
                    <th>Consumers</th>
                    <th>Delivery Rate</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queues.map(q => (
                    <tr key={q.name}>
                      <td style={{ fontWeight: 'bold' }}>{q.name}</td>
                      <td>
                        <span className={`rmq-badge ${q.status}`}>{q.status}</span>
                      </td>
                      <td>{q.ready}</td>
                      <td>{q.unacked}</td>
                      <td style={{ fontWeight: 'bold' }}>{q.total}</td>
                      <td>{q.consumers}</td>
                      <td>
                        <span className="rate-display">{q.rate} msg/s</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="purge-btn" onClick={() => handlePurgeQueue(q.name)}>
                          Purge
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rmq-publish-panel glass-panel">
            <div className="table-list-title">Publish Message to Default Exchange</div>
            <form onSubmit={handlePublishMessage} className="rmq-publish-form">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Target Queue / Binding Key</label>
                  <select 
                    className="form-select"
                    value={publishForm.queue}
                    onChange={(e) => setPublishForm({ ...publishForm, queue: e.target.value })}
                  >
                    {queues.map(q => <option key={q.name} value={q.name}>{q.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Routing Key (optional)</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. notifications.email"
                    value={publishForm.routingKey}
                    onChange={(e) => setPublishForm({ ...publishForm, routingKey: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Message Payload (Text or JSON)</label>
                <textarea 
                  className="form-textarea" 
                  rows={6}
                  required
                  placeholder='{"event": "user_registered", "email": "user@example.com"}'
                  value={publishForm.body}
                  onChange={(e) => setPublishForm({ ...publishForm, body: e.target.value })}
                />
              </div>
              <div className="publish-form-footer">
                <button type="submit" className="connect-submit-btn">Publish to Queue</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
