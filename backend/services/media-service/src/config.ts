import os from 'os';

export const config = {
  port: parseInt(process.env.PORT || '3005', 10),
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],

  mediasoup: {
    // Number of workers (typically number of CPUs)
    numWorkers: parseInt(process.env.MEDIASOUP_NUM_WORKERS || String(os.cpus().length), 10),

    // Worker settings
    workerSettings: {
      logLevel: 'warn' as const,
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'] as const,
      rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '40000', 10),
      rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '49999', 10),
    },

    // Router media codecs
    routerMediaCodecs: [
      {
        kind: 'audio' as const,
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video' as const,
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video' as const,
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video' as const,
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ],

    // WebRTC transport settings
    webRtcTransportOptions: {
      listenIps: [
        {
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
      maxIncomingBitrate: 1500000,
    },
  },
} as const;
