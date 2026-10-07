import { Schema, model, type InferSchemaType } from 'mongoose';

const penaltyStateSchema = new Schema({
  proTxHash: { type: String, required: true }, penalty: { type: Number, required: true },
  banHeight: { type: Number, required: true }, revivedHeight: { type: Number, required: true },
  dslBanHeight: { type: Number, required: true },
}, { _id: false });
const penaltyApplicationSchema = new Schema({
  txid: { type: String, required: true }, proTxHash: { type: String, required: true },
  previousBlockPenalty: { type: Number, required: true }, beforePenalty: { type: Number, required: true },
  afterPenalty: { type: Number, required: true }, penaltyAmount: { type: Number, required: true },
  appliedDelta: { type: Number, required: true }, maxPenalty: { type: Number, required: true },
  previousBanHeight: { type: Number, required: true }, banHeight: { type: Number, required: true },
  causedBan: { type: Boolean, required: true },
}, { _id: false });
const penaltyAttributionSchema = new Schema({
  status: { type: String, required: true, enum: ['disabled', 'verified', 'state_unavailable', 'unsupported_context', 'inconsistent', 'not_applicable'] },
  reason: { type: String, default: null }, rule: { type: String, required: true },
  registeredCount: { type: Number, default: null }, maxPenalty: { type: Number, default: null },
  before: { type: [penaltyStateSchema], default: [] }, after: { type: [penaltyStateSchema], default: [] },
  applications: { type: [penaltyApplicationSchema], default: [] },
}, { _id: false });

const memberSchema = new Schema({
  proTxHash: { type: String, required: true }, valid: { type: Boolean, required: true },
}, { _id: false });
const commitmentSchema = new Schema({
  txid: { type: String, required: true }, rawPayload: { type: String, required: true },
  quorumType: { type: Number, default: null }, quorumHash: { type: String, default: null },
  quorumIndex: { type: Number, default: null }, version: { type: Number, default: null },
  status: { type: String, required: true, enum: ['verified', 'null', 'membership_unavailable', 'unsupported_payload'] },
  error: { type: String, default: null },
  memberSlots: { type: Number, default: null }, invalidSlots: { type: Number, default: null },
  members: { type: [memberSchema], default: [] },
}, { _id: false });
const poseChainBlockSchema = new Schema({
  height: { type: Number, required: true },
  hash: { type: String, required: true, unique: true },
  previousHash: { type: String, required: true },
  time: { type: Date, required: true, index: true },
  canonical: { type: Boolean, required: true, default: false },
  checkedAt: { type: Date, required: true },
  membershipCheckedAt: { type: Date, default: null },
  transactionTypes: { type: [Number], default: null },
  attributionCheckedAt: { type: Date, default: null },
  penaltyAttribution: { type: penaltyAttributionSchema, default: null },
  commitments: { type: [commitmentSchema], default: [] },
}, { timestamps: true });
poseChainBlockSchema.index({ height: 1 }, { name: 'canonical_height_unique', unique: true, partialFilterExpression: { canonical: true } });
poseChainBlockSchema.index({ canonical: 1, 'commitments.status': 1, membershipCheckedAt: 1 });
poseChainBlockSchema.index({ canonical: 1, 'penaltyAttribution.status': 1, attributionCheckedAt: 1 });
// No TTL: keep canonical history and fork evidence for before/after comparisons.
export type PoseChainBlockDocument = InferSchemaType<typeof poseChainBlockSchema>;
export const PoseChainBlock = model<PoseChainBlockDocument>('PoseChainBlock', poseChainBlockSchema);
