import mongoose from 'mongoose';
import { config } from './index';
import { logger } from '../utils/logger';

// Defense-in-depth: pin Mongoose strict modes explicitly so that a future
// upgrade or stray `mongoose.set('strict', false)` cannot silently allow
// unknown fields from user input to be persisted or queried.
mongoose.set('strict', true);
mongoose.set('strictQuery', true);

export async function connectDatabase(): Promise<void> {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await mongoose.connect(config.mongodb.uri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: config.nodeEnv === 'production' ? 30 : 10,
        minPoolSize: 2,
        socketTimeoutMS: 45000,
      });
      logger.info('MongoDB connected successfully');
      break;
    } catch (error) {
      retries++;
      logger.error(`MongoDB connection attempt ${retries}/${maxRetries} failed:`, error);
      if (retries >= maxRetries) {
        logger.error('Max retries reached. Starting server without DB (health check will show degraded).');
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
}
