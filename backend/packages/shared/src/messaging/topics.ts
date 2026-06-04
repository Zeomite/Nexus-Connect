// Kafka Topics Definition
export const KafkaTopics = {
  // User domain events
  USER_EVENTS: 'nexus.user.events',
  USER_STATUS: 'nexus.user.status',

  // Chat domain events
  CHAT_MESSAGES: 'nexus.chat.messages',
  CHAT_EVENTS: 'nexus.chat.events',

  // Call domain events
  CALL_EVENTS: 'nexus.call.events',
  CALL_SIGNALING: 'nexus.call.signaling',

  // Group domain events
  GROUP_EVENTS: 'nexus.group.events',

  // Expense domain events
  EXPENSE_EVENTS: 'nexus.expense.events',

  // Notification events
  NOTIFICATIONS: 'nexus.notifications',
  EMAIL_QUEUE: 'nexus.notifications.email',
  PUSH_QUEUE: 'nexus.notifications.push',

  // Dead letter queues
  DLQ_CHAT: 'nexus.dlq.chat',
  DLQ_CALLS: 'nexus.dlq.calls',
  DLQ_NOTIFICATIONS: 'nexus.dlq.notifications',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

// Topic configurations for production
export const TopicConfigurations = [
  {
    topic: KafkaTopics.USER_EVENTS,
    numPartitions: 6,
    replicationFactor: 3,
    config: {
      'retention.ms': '604800000', // 7 days
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.USER_STATUS,
    numPartitions: 12,
    replicationFactor: 3,
    config: {
      'retention.ms': '86400000', // 1 day
      'cleanup.policy': 'compact',
    },
  },
  {
    topic: KafkaTopics.CHAT_MESSAGES,
    numPartitions: 24,
    replicationFactor: 3,
    config: {
      'retention.ms': '2592000000', // 30 days
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.CHAT_EVENTS,
    numPartitions: 12,
    replicationFactor: 3,
    config: {
      'retention.ms': '604800000', // 7 days
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.CALL_EVENTS,
    numPartitions: 12,
    replicationFactor: 3,
    config: {
      'retention.ms': '604800000', // 7 days
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.CALL_SIGNALING,
    numPartitions: 24,
    replicationFactor: 3,
    config: {
      'retention.ms': '3600000', // 1 hour (signaling is ephemeral)
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.GROUP_EVENTS,
    numPartitions: 6,
    replicationFactor: 3,
    config: {
      'retention.ms': '604800000', // 7 days
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.EXPENSE_EVENTS,
    numPartitions: 6,
    replicationFactor: 3,
    config: {
      'retention.ms': '2592000000', // 30 days
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.NOTIFICATIONS,
    numPartitions: 12,
    replicationFactor: 3,
    config: {
      'retention.ms': '86400000', // 1 day
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.EMAIL_QUEUE,
    numPartitions: 6,
    replicationFactor: 3,
    config: {
      'retention.ms': '604800000', // 7 days
      'cleanup.policy': 'delete',
    },
  },
  {
    topic: KafkaTopics.PUSH_QUEUE,
    numPartitions: 6,
    replicationFactor: 3,
    config: {
      'retention.ms': '86400000', // 1 day
      'cleanup.policy': 'delete',
    },
  },
];

// Consumer group IDs
export const ConsumerGroups = {
  AUTH_SERVICE: 'nexus-auth-service',
  USER_SERVICE: 'nexus-user-service',
  CHAT_SERVICE: 'nexus-chat-service',
  CALL_SERVICE: 'nexus-call-service',
  CALL_HISTORY_SERVICE: 'nexus-call-history-service',
  GROUP_SERVICE: 'nexus-group-service',
  EXPENSE_SERVICE: 'nexus-expense-service',
  NOTIFICATION_SERVICE: 'nexus-notification-service',
  MEDIA_SERVICE: 'nexus-media-service',
} as const;

export type ConsumerGroup = (typeof ConsumerGroups)[keyof typeof ConsumerGroups];
