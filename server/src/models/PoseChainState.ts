import { Schema, model, type InferSchemaType } from 'mongoose';

const poseChainStateSchema = new Schema({
  key: { type: String, required: true, unique: true },
  startHeight: { type: Number, required: true },
  lastHeight: { type: Number, required: true },
  lastHash: { type: String, default: null },
  targetHeight: { type: Number, default: null },
  checkedAt: { type: Date, default: null },
  status: { type: String, enum: ['collecting', 'ready', 'error'], default: 'collecting' },
  error: { type: String, default: null },
  lastReorgAt: { type: Date, default: null },
  // Monotonic collection generation; timestamps alone cannot detect an ABA read.
  revision: { type: Number, required: true, default: 0 },
}, { timestamps: true });
export type PoseChainStateDocument = InferSchemaType<typeof poseChainStateSchema>;
export const PoseChainState = model<PoseChainStateDocument>('PoseChainState', poseChainStateSchema);
