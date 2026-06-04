import Fastify from 'fastify';
import nodemailer, { Transporter } from 'nodemailer';
import {
  createLogger,
  createKafkaClient,
  createPostgresClient,
  KafkaTopics,
  ConsumerGroups,
  CallEventTypes,
  NotificationEventTypes,
} from '@nexus/shared';
import { EachMessagePayload, Consumer } from 'kafkajs';

const logger = createLogger({ serviceName: 'notification-service' });

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

const emailConfig: EmailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  password: process.env.SMTP_PASSWORD || '',
  from: process.env.EMAIL_FROM || 'noreply@nexus.com',
};

const createEmailTransporter = (): Transporter => {
  return nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: {
      user: emailConfig.user,
      pass: emailConfig.password,
    },
  });
};

const start = async (): Promise<void> => {
  const server = Fastify({ logger: false });

  const kafka = createKafkaClient('notification-service');
  const postgres = createPostgresClient('notification-service');
  const emailTransporter = createEmailTransporter();

  let consumer: Consumer | null = null;

  // Initialize Kafka consumer
  consumer = await kafka.initConsumer(ConsumerGroups.NOTIFICATION_SERVICE);

  await kafka.subscribe(
    consumer,
    [KafkaTopics.NOTIFICATIONS, KafkaTopics.EMAIL_QUEUE, KafkaTopics.CALL_EVENTS],
    async (payload: EachMessagePayload) => {
      const event = kafka.parseEvent(payload);
      if (!event) return;

      logger.debug({ eventType: event.eventType }, 'Processing notification event');

      try {
        switch (event.eventType) {
          case NotificationEventTypes.SEND_EMAIL:
            await handleSendEmail(emailTransporter, event.payload as {
              to: string;
              subject: string;
              template: string;
              templateData: Record<string, unknown>;
            });
            break;

          case CallEventTypes.CALL_MISSED:
            await handleMissedCall(postgres, emailTransporter, event.payload as {
              callId: string;
              initiatorId: string;
              missedByUserId: string;
              callType: string;
            });
            break;

          default:
            logger.debug({ eventType: event.eventType }, 'Unhandled notification event');
        }
      } catch (error) {
        logger.error({ error, eventType: event.eventType }, 'Failed to process notification');
      }
    }
  );

  logger.info('Notification consumer started');

  // Health endpoint
  server.get('/health', async () => ({
    status: 'ok',
    service: 'notification-service',
  }));

  const port = parseInt(process.env.PORT || '3008', 10);
  await server.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Notification service started');

  const shutdown = async (): Promise<void> => {
    await server.close();
    if (consumer) await consumer.disconnect();
    await postgres.close();
    await kafka.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

async function handleSendEmail(
  transporter: Transporter,
  payload: { to: string; subject: string; template: string; templateData: Record<string, unknown> }
): Promise<void> {
  const { to, subject, template, templateData } = payload;

  // Simple template rendering
  let html = template;
  for (const [key, value] of Object.entries(templateData)) {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }

  try {
    await transporter.sendMail({
      from: emailConfig.from,
      to,
      subject,
      html,
    });
    logger.info({ to, subject }, 'Email sent');
  } catch (error) {
    logger.error({ error, to, subject }, 'Failed to send email');
  }
}

async function handleMissedCall(
  postgres: ReturnType<typeof createPostgresClient>,
  transporter: Transporter,
  payload: { callId: string; initiatorId: string; missedByUserId: string; callType: string }
): Promise<void> {
  // Get user info
  const [initiator, missedBy] = await Promise.all([
    postgres.queryOne<{ display_name: string }>(
      'SELECT display_name FROM users WHERE id = $1',
      [payload.initiatorId]
    ),
    postgres.queryOne<{ email: string; display_name: string }>(
      'SELECT email, display_name FROM users WHERE id = $1',
      [payload.missedByUserId]
    ),
  ]);

  if (!initiator || !missedBy) return;

  await transporter.sendMail({
    from: emailConfig.from,
    to: missedBy.email,
    subject: `Missed ${payload.callType} call from ${initiator.display_name}`,
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Missed Call</h2>
        <p>You missed a ${payload.callType} call from <strong>${initiator.display_name}</strong>.</p>
        <p>Open Nexus to call them back.</p>
      </div>
    `,
  });

  logger.info({ userId: payload.missedByUserId, initiatorId: payload.initiatorId }, 'Missed call notification sent');
}

start().catch((error) => {
  logger.error({ error }, 'Failed to start notification service');
  process.exit(1);
});
