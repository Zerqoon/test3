import pino from 'pino';
import { config } from './config.js';
export const logger = pino({ level: config.LOG_LEVEL, redact: ['token','DISCORD_TOKEN','authorization','headers.authorization'] });
