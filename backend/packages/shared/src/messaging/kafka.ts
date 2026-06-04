import {
  Kafka,
  Producer,
  Consumer,
  ConsumerConfig,
  ProducerConfig,
  EachMessagePayload,
  logLevel,
  Admin,
  SASLOptions,
} from 'kafkajs';
import { logger } from '../utils/logger';
import { generateUuid } from '../utils/id-generator';
import { BaseEvent, DomainEvent } from '../types/events';

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  connectionTimeout?: number;
  authenticationTimeout?: number;
  ssl?: boolean;
  sasl?: SASLOptions;
}

export class KafkaClient {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Map<string, Consumer> = new Map();
  private admin: Admin | null = null;
  private serviceName: string;

  constructor(config: KafkaConfig, serviceName: string = 'unknown') {
    this.serviceName = serviceName;

    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      connectionTimeout: config.connectionTimeout || 10000,
      authenticationTimeout: config.authenticationTimeout || 10000,
      ssl: config.ssl,
      sasl: config.sasl,
      logLevel: logLevel.WARN,
      logCreator: () => {
        return ({ level, log }) => {
          const { message, ...extra } = log;
          switch (level) {
            case logLevel.ERROR:
              logger.error({ ...extra, service: this.serviceName }, message);
              break;
            case logLevel.WARN:
              logger.warn({ ...extra, service: this.serviceName }, message);
              break;
            case logLevel.INFO:
              logger.info({ ...extra, service: this.serviceName }, message);
              break;
            case logLevel.DEBUG:
              logger.debug({ ...extra, service: this.serviceName }, message);
              break;
          }
        };
      },
    });
  }

  // Initialize producer
  async initProducer(config?: ProducerConfig): Promise<void> {
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: false,
      idempotent: true,
      maxInFlightRequests: 5,
      ...config,
    });

    await this.producer.connect();
    logger.info({ service: this.serviceName }, 'Kafka producer connected');
  }

  // Initialize consumer
  async initConsumer(groupId: string, config?: Partial<ConsumerConfig>): Promise<Consumer> {
    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 5000,
      ...config,
    });

    await consumer.connect();
    this.consumers.set(groupId, consumer);
    logger.info({ service: this.serviceName, groupId }, 'Kafka consumer connected');

    return consumer;
  }

  // Get admin client
  async getAdmin(): Promise<Admin> {
    if (!this.admin) {
      this.admin = this.kafka.admin();
      await this.admin.connect();
    }
    return this.admin;
  }

  // Create topics
  async createTopics(topics: Array<{ topic: string; numPartitions?: number; replicationFactor?: number }>): Promise<void> {
    const admin = await this.getAdmin();
    await admin.createTopics({
      topics: topics.map((t) => ({
        topic: t.topic,
        numPartitions: t.numPartitions || 3,
        replicationFactor: t.replicationFactor || 1,
      })),
    });
    logger.info({ topics: topics.map((t) => t.topic), service: this.serviceName }, 'Topics created');
  }

  // Publish event (non-blocking - won't throw on failure)
  async publish<T extends DomainEvent>(
    topic: string,
    event: Omit<T, 'eventId' | 'timestamp' | 'version' | 'source'>,
    key?: string
  ): Promise<void> {
    if (!this.producer) {
      logger.warn({ topic, service: this.serviceName }, 'Kafka producer not initialized, skipping publish');
      return;
    }

    const fullEvent: BaseEvent = {
      ...event,
      eventId: generateUuid(),
      timestamp: new Date().toISOString(),
      version: '1.0',
      source: this.serviceName,
    };

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: key || fullEvent.eventId,
            value: JSON.stringify(fullEvent),
            headers: {
              eventType: event.eventType,
              source: this.serviceName,
              correlationId: (event as BaseEvent).correlationId || '',
            },
          },
        ],
      });

      logger.debug(
        { topic, eventType: event.eventType, eventId: fullEvent.eventId, service: this.serviceName },
        'Event published'
      );
    } catch (error) {
      // Log but don't throw - Kafka failures shouldn't block operations
      logger.error(
        { error, topic, eventType: event.eventType, service: this.serviceName },
        'Failed to publish event to Kafka'
      );
    }
  }

  // Publish batch of events
  async publishBatch<T extends DomainEvent>(
    topic: string,
    events: Array<{ event: Omit<T, 'eventId' | 'timestamp' | 'version' | 'source'>; key?: string }>
  ): Promise<void> {
    if (!this.producer) {
      throw new Error('Producer not initialized');
    }

    const messages = events.map(({ event, key }) => {
      const fullEvent: BaseEvent = {
        ...event,
        eventId: generateUuid(),
        timestamp: new Date().toISOString(),
        version: '1.0',
        source: this.serviceName,
      };

      return {
        key: key || fullEvent.eventId,
        value: JSON.stringify(fullEvent),
        headers: {
          eventType: event.eventType,
          source: this.serviceName,
        },
      };
    });

    await this.producer.send({ topic, messages });
    logger.debug({ topic, count: events.length, service: this.serviceName }, 'Batch events published');
  }

  // Subscribe to topic
  async subscribe(
    consumer: Consumer,
    topics: string[],
    handler: (payload: EachMessagePayload) => Promise<void>,
    options?: { fromBeginning?: boolean }
  ): Promise<void> {
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: options?.fromBeginning || false });
    }

    await consumer.run({
      eachMessage: async (payload) => {
        const startTime = Date.now();
        try {
          await handler(payload);
          logger.debug(
            {
              topic: payload.topic,
              partition: payload.partition,
              offset: payload.message.offset,
              duration: Date.now() - startTime,
              service: this.serviceName,
            },
            'Message processed'
          );
        } catch (error) {
          logger.error(
            {
              error,
              topic: payload.topic,
              partition: payload.partition,
              offset: payload.message.offset,
              service: this.serviceName,
            },
            'Message processing failed'
          );
          throw error; // Re-throw to trigger retry
        }
      },
    });
  }

  // Parse event from message
  parseEvent<T extends DomainEvent>(payload: EachMessagePayload): T | null {
    try {
      if (!payload.message.value) return null;
      return JSON.parse(payload.message.value.toString()) as T;
    } catch {
      logger.error({ service: this.serviceName }, 'Failed to parse event');
      return null;
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const admin = await this.getAdmin();
      await admin.listTopics();
      return true;
    } catch {
      return false;
    }
  }

  // Close all connections
  async close(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
    }

    for (const [groupId, consumer] of this.consumers) {
      await consumer.disconnect();
      logger.info({ groupId, service: this.serviceName }, 'Consumer disconnected');
    }

    if (this.admin) {
      await this.admin.disconnect();
    }

    logger.info({ service: this.serviceName }, 'Kafka client closed');
  }
}

// Create Kafka client from environment variables
export const createKafkaClient = (serviceName: string): KafkaClient => {
  const saslMechanism = process.env.KAFKA_SASL_MECHANISM || 'plain';
  
  const config: KafkaConfig = {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: serviceName,
    ssl: process.env.KAFKA_SSL === 'true',
    sasl: process.env.KAFKA_SASL_USERNAME
      ? {
          mechanism: saslMechanism as 'plain',
          username: process.env.KAFKA_SASL_USERNAME,
          password: process.env.KAFKA_SASL_PASSWORD || '',
        }
      : undefined,
  };

  return new KafkaClient(config, serviceName);
};
