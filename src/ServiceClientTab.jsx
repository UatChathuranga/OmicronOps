import React from 'react';
import { PostgreSqlView } from './PostgresClientTab.jsx';
import { MongoDbView } from './MongoClientTab.jsx';
import { RedisView } from './RedisClientTab.jsx';
import { RabbitMqView } from './RabbitMqClientTab.jsx';
import { HaProxyView } from './HaProxyClientTab.jsx';

export { PostgreSqlView } from './PostgresClientTab.jsx';
export { MongoDbView } from './MongoClientTab.jsx';
export { RedisView } from './RedisClientTab.jsx';
export { RabbitMqView } from './RabbitMqClientTab.jsx';
export { HaProxyView } from './HaProxyClientTab.jsx';

// ==========================================
// MAIN SERVICE CLIENT WRAPPER COMPONENT
// ==========================================
export default function ServiceClientTab({ connection, type, tabId }) {
  switch (type) {
    case 'postgres':
      return <PostgreSqlView connection={connection} tabId={tabId} />;
    case 'mongo':
      return <MongoDbView connection={connection} tabId={tabId} />;
    case 'redis':
      return <RedisView connection={connection} tabId={tabId} />;
    case 'rabbitmq':
      return <RabbitMqView connection={connection} />;
    case 'haproxy':
      return <HaProxyView connection={connection} />;
    default:
      return (
        <div style={{ padding: '20px', color: 'var(--text-secondary)' }}>
          Unknown service type: {type}
        </div>
      );
  }
}
