import nodemailer, { Transporter } from 'nodemailer';
import { createLogger } from '@nexus/shared';
import { config } from '../config';

const logger = createLogger({ serviceName: 'auth-service:email' });

export class EmailService {
  private transporter: Transporter;

  constructor() {
    // Log SMTP configuration on startup (hide password)
    logger.info({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      user: config.email.user || '(not set)',
      from: config.email.from,
    }, 'Email service initialized with SMTP config');

    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: config.email.user ? {
        user: config.email.user,
        pass: config.email.password,
      } : undefined,
    });
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    const mailOptions = {
      from: config.email.from,
      to,
      subject: 'Your verification code - Nexus',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td style="padding: 48px 48px 24px; text-align: center;">
                      <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: #18181b;">Welcome to Nexus</h1>
                      <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #52525b;">
                        Thanks for signing up! Use this code to verify your email:
                      </p>
                      <div style="background-color: #f4f4f5; border-radius: 8px; padding: 24px; margin: 24px 0;">
                        <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #6366f1;">${code}</span>
                      </div>
                      <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #71717a;">
                        Enter this code in the app to verify your email address.
                      </p>
                      <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                        This code expires in 24 hours. If you didn't create an account, you can safely ignore this email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `Welcome to Nexus! Your verification code is: ${code}. Enter this code in the app to verify your email.`,
    };

    try {
      logger.info({ to, subject: mailOptions.subject, from: mailOptions.from }, 'Sending verification email...');
      const startTime = Date.now();
      const result = await this.transporter.sendMail(mailOptions);
      const duration = Date.now() - startTime;
      logger.info({ 
        to, 
        messageId: result.messageId,
        response: result.response,
        duration: `${duration}ms`
      }, '✓ Verification email sent successfully');
    } catch (error: any) {
      logger.error({ 
        to,
        errorCode: error.code,
        errorMessage: error.message,
        errorResponse: error.response,
        smtpHost: config.email.host,
        smtpPort: config.email.port,
      }, '✗ Failed to send verification email');
      // Don't throw - email failures shouldn't block registration
    }
  }

  async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    const mailOptions = {
      from: config.email.from,
      to,
      subject: 'Your password reset code - Nexus',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td style="padding: 48px 48px 24px; text-align: center;">
                      <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: #18181b;">Reset Your Password</h1>
                      <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #52525b;">
                        We received a request to reset your password. Use this code:
                      </p>
                      <div style="background-color: #f4f4f5; border-radius: 8px; padding: 24px; margin: 24px 0;">
                        <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #6366f1;">${code}</span>
                      </div>
                      <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #71717a;">
                        Enter this code in the app to reset your password.
                      </p>
                      <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                        This code expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `Your password reset code is: ${code}. Enter this code in the app to reset your password. This code expires in 1 hour.`,
    };

    try {
      logger.info({ to, subject: mailOptions.subject }, 'Sending password reset email...');
      const startTime = Date.now();
      const result = await this.transporter.sendMail(mailOptions);
      const duration = Date.now() - startTime;
      logger.info({ 
        to, 
        messageId: result.messageId,
        response: result.response,
        duration: `${duration}ms`
      }, '✓ Password reset email sent successfully');
    } catch (error: any) {
      logger.error({ 
        to,
        errorCode: error.code,
        errorMessage: error.message,
        errorResponse: error.response,
      }, '✗ Failed to send password reset email');
    }
  }

  async sendWelcomeEmail(to: string, displayName: string): Promise<void> {
    const mailOptions = {
      from: config.email.from,
      to,
      subject: 'Welcome to Nexus!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Nexus</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td style="padding: 48px 48px 24px;">
                      <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: #18181b;">Welcome, ${displayName}!</h1>
                      <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #52525b;">
                        Your account is now active. Here's what you can do with Nexus:
                      </p>
                      <ul style="margin: 0 0 24px; padding-left: 20px; font-size: 16px; line-height: 28px; color: #52525b;">
                        <li>Make HD video and audio calls</li>
                        <li>Chat with individuals or groups</li>
                        <li>Share your screen in meetings</li>
                        <li>Split expenses with friends</li>
                      </ul>
                      <a href="${config.frontendUrl}" style="display: inline-block; padding: 14px 28px; background-color: #6366f1; color: #ffffff; text-decoration: none; font-weight: 500; border-radius: 8px; font-size: 16px;">
                        Get Started
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `Welcome to Nexus, ${displayName}! Your account is now active.`,
    };

    try {
      logger.info({ to, subject: mailOptions.subject, displayName }, 'Sending welcome email...');
      const startTime = Date.now();
      const result = await this.transporter.sendMail(mailOptions);
      const duration = Date.now() - startTime;
      logger.info({ 
        to, 
        messageId: result.messageId,
        response: result.response,
        duration: `${duration}ms`
      }, '✓ Welcome email sent successfully');
    } catch (error: any) {
      logger.error({ 
        to,
        errorCode: error.code,
        errorMessage: error.message,
        errorResponse: error.response,
      }, '✗ Failed to send welcome email');
    }
  }
}
