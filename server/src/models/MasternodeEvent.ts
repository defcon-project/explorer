import mongoose, { Schema, Document } from 'mongoose';

export type MasternodeEventType = 'status' | 'ban' | 'recovery';
export type MasternodeEventStatus = 'banned' | 'recovered' | 'observed';

export interface MasternodeEventDocument extends Document {
  nodeId: string;
  service: string;
  previousStatus: string;
  currentStatus: string;
  detectedAt: Date;
  eventKey?: string;
  eventType?: MasternodeEventType;
  eventStatus?: MasternodeEventStatus;
  proTxHash?: string | null;
  ip?: string | null;
  port?: number | null;
  provider?: string | null;
  providerSource?: string | null;
  providerTagCidr?: string | null;
  providerTagSource?: string | null;
  providerConfidence?: number | null;
  countryCode?: string | null;
  countryName?: string | null;
  operatorPubkey?: string | null;
  payoutAddress?: string | null;
  poseBanHeight?: number | null;
  detectedHeight?: number | null;
  recoveredAt?: Date | null;
  recoveredHeight?: number | null;
  recoveryTransition?: string | null;
  updatedAt?: Date;
}

const masternodeEventSchema = new Schema<MasternodeEventDocument>({
  nodeId: { type: String, required: true, index: true },
  // service may be empty string for REMOVED events (node no longer in RPC list)
  service: { type: String, required: false, default: '' },
  previousStatus: { type: String, required: true },
  currentStatus: { type: String, required: true, index: true },
  detectedAt: { type: Date, required: true, default: () => new Date() },
  eventKey: { type: String, required: false, index: true, unique: true, sparse: true },
  eventType: { type: String, required: false, index: true, default: 'status' },
  eventStatus: { type: String, required: false, index: true, default: 'observed' },
  proTxHash: { type: String, required: false, default: null, index: true },
  ip: { type: String, required: false, default: null },
  port: { type: Number, required: false, default: null },
  provider: { type: String, required: false, default: null },
  providerSource: { type: String, required: false, default: null },
  providerTagCidr: { type: String, required: false, default: null },
  providerTagSource: { type: String, required: false, default: null },
  providerConfidence: { type: Number, required: false, default: null },
  countryCode: { type: String, required: false, default: null },
  countryName: { type: String, required: false, default: null },
  operatorPubkey: { type: String, required: false, default: null },
  payoutAddress: { type: String, required: false, default: null },
  poseBanHeight: { type: Number, required: false, default: null, index: true },
  detectedHeight: { type: Number, required: false, default: null },
  recoveredAt: { type: Date, required: false, default: null, index: true },
  recoveredHeight: { type: Number, required: false, default: null },
  recoveryTransition: { type: String, required: false, default: null },
  updatedAt: { type: Date, required: false, default: () => new Date() },
});

masternodeEventSchema.index({ nodeId: 1, detectedAt: -1 });
masternodeEventSchema.index({ detectedAt: -1 });
masternodeEventSchema.index({ currentStatus: 1, detectedAt: -1 });
masternodeEventSchema.index({ eventType: 1, detectedAt: -1 });
masternodeEventSchema.index({ eventType: 1, eventStatus: 1, detectedAt: -1 });
masternodeEventSchema.index({ proTxHash: 1, poseBanHeight: 1 });
// Auto-prune events older than 90 days. Historical ban docs are still retained
// for the same rolling window, but recovery metadata is attached to the original doc.
masternodeEventSchema.index({ detectedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const MasternodeEvent = mongoose.model<MasternodeEventDocument>(
  'MasternodeEvent',
  masternodeEventSchema
);
